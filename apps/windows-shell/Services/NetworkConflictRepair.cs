using System.IO;

namespace NikkiSync.WindowsShell.Services;

public sealed record ConflictRule(string Name,string Program,int Protocol,string LocalPorts,string RemotePorts,
    string LocalAddresses,string RemoteAddresses,string InterfaceTypes,bool RestrictedInterfaces,string Service,
    int Direction,int Action,int Profiles,bool Enabled,string Grouping,string Description,bool EdgeTraversal);
public sealed record ConflictChange(ConflictRule Before,ConflictRule After);
public sealed record ConflictSummary(int Conflicts,int Repairable);
public interface IConflictRules
{
    IReadOnlyList<ConflictRule> Read();
    void Change(ConflictRule expected,bool enabled,int profiles);
}
public interface IConflictJournal
{
    IReadOnlyList<ConflictChange> Load();
    void Save(IReadOnlyList<ConflictChange> changes);
}

/// <summary>Only state/profile edits to exact-backend TCP blocks. Never deletes or recreates rules.</summary>
public static class NetworkConflictRepair
{
    public static bool MatchesPort(string text,int port)
    {
        if(text is "*" or "Any" or "")return true;
        foreach(var item in text.Split(','))
        {
            var range=item.Trim().Split('-');
            if(range.Length==1&&int.TryParse(range[0],out var single)&&single==port)return true;
            if(range.Length==2&&int.TryParse(range[0],out var low)&&int.TryParse(range[1],out var high)&&low>=1&&high<=65535&&low<=port&&port<=high)return true;
        }
        return false;
    }
    private static bool Target(ConflictRule rule,NetworkAuthorizationPlan plan)=>
        string.Equals(rule.Program,plan.Program,StringComparison.OrdinalIgnoreCase)&&rule.Direction==1&&rule.Action==0
        &&rule.Protocol is 6 or 256&&MatchesPort(rule.LocalPorts,plan.Port);
    private static bool Simple(ConflictRule rule)=>rule.Protocol==6&&rule.LocalAddresses is "*" or "Any"
        &&rule.RemoteAddresses is "*" or "Any"&&rule.RemotePorts is "*" or "Any"
        &&rule.InterfaceTypes=="All"&&!rule.RestrictedInterfaces&&rule.Service==""&&rule.Grouping==""&&!rule.EdgeTraversal;
    private static void CheckProfile(int profile){if(profile is not (2 or 4))throw new InvalidDataException("Unknown or managed network profile.");}
    public static ConflictSummary Inspect(IReadOnlyList<ConflictRule> rules,NetworkAuthorizationPlan plan,int profile)
    {
        CheckProfile(profile);
        var candidates=rules.Where(rule=>Target(rule,plan)&&rule.Enabled&&(rule.Profiles&profile)!=0).ToArray();
        return new(candidates.Length,candidates.Count(rule=>Simple(rule)&&rules.Count(other=>other.Name==rule.Name)==1));
    }
    private static void ValidateJournal(IReadOnlyList<ConflictChange> changes,NetworkAuthorizationPlan plan)
    {
        if(changes.Count>32||changes.Select(change=>change.Before.Name).Distinct(StringComparer.Ordinal).Count()!=changes.Count)throw new InvalidDataException("Invalid repair journal.");
        foreach(var change in changes)
        {
            var a=change.Before;var b=change.After;
            if(!Target(a,plan)||!Simple(a)||!a.Enabled||!(a.Profiles is >=1 and <=7 or int.MaxValue)||b.Profiles is <1 or >7
                ||a with{Enabled=b.Enabled,Profiles=b.Profiles}!=b||(a.Profiles&1)!=(b.Profiles&1)
                ||(b.Enabled?b.Profiles==(a.Profiles&7)||(b.Profiles&a.Profiles)!=b.Profiles:(b.Profiles&a.Profiles)!=b.Profiles||(a.Profiles&1)!=0))
                throw new InvalidDataException("Invalid repair journal scope.");
        }
    }
    public static int Repair(IConflictRules rules,IConflictJournal journal,NetworkAuthorizationPlan plan,int profile)
    {
        CheckProfile(profile);
        var before=rules.Read();var previous=journal.Load().ToList();ValidateJournal(previous,plan);
        var changes=before.Where(rule=>Target(rule,plan)&&rule.Enabled&&(rule.Profiles&profile)!=0&&Simple(rule)&&before.Count(other=>other.Name==rule.Name)==1)
            .Select(rule=>{var remaining=(rule.Profiles&7)&~profile;return new ConflictChange(rule,remaining==0?rule with{Enabled=false}:rule with{Profiles=remaining});}).ToArray();
        if(changes.Length==0)return 0;
        if(changes.Length>16)throw new InvalidDataException("Too many conflicts.");
        var pending=previous.ToList();
        foreach(var change in changes)
        {
            var index=pending.FindIndex(item=>item.Before.Name==change.Before.Name);
            if(index<0)pending.Add(change);
            else if(pending[index].After==change.Before)pending[index]=pending[index] with{After=change.After};
            else throw new InvalidDataException("Rule changed since previous repair.");
        }
        ValidateJournal(pending,plan);journal.Save(pending); // Durable BEFORE the first change.
        try
        {
            foreach(var change in changes)rules.Change(change.Before,change.After.Enabled,change.After.Profiles);
            if(changes.Any(change=>!rules.Read().Contains(change.After)))throw new IOException("Rule readback failed.");
            return changes.Length;
        }
        catch
        {
            // Also consider a setter that took effect before reporting an error.
            foreach(var change in changes.Reverse())
                try{if(rules.Read().Count(rule=>rule.Name==change.After.Name)==1&&rules.Read().Contains(change.After))rules.Change(change.After,change.Before.Enabled,change.Before.Profiles);}catch{}
            var unresolved=pending.Where(change=>!rules.Read().Contains(change.Before)).ToList();
            foreach(var old in previous){unresolved.RemoveAll(change=>change.Before.Name==old.Before.Name);unresolved.Add(old);}
            journal.Save(unresolved);throw;
        }
    }
    public static int Restore(IConflictRules rules,IConflictJournal journal,NetworkAuthorizationPlan plan)
    {
        var saved=journal.Load();ValidateJournal(saved,plan);var pending=saved.ToList();var restored=0;
        foreach(var change in saved)
        {
            var current=rules.Read().Where(rule=>rule.Name==change.Before.Name).ToArray();
            if(current.Length!=1)continue;
            if(current[0]==change.Before){pending.Remove(change);journal.Save(pending);continue;}
            if(current[0]!=change.After)continue; // An administrator's later edit wins.
            rules.Change(change.After,change.Before.Enabled,change.Before.Profiles);
            if(!rules.Read().Contains(change.Before))throw new IOException("Restore readback failed.");
            pending.Remove(change);journal.Save(pending);restored++;
        }
        return restored;
    }
}
