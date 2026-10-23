using NikkiSync.WindowsShell.Services;
using System.IO;
using System.Runtime.InteropServices;

namespace NikkiSync.WindowsShell.Tests;

public class NetworkConflictRepairTests
{
    private static readonly NetworkAuthorizationPlan Plan=NetworkAuthorizationPlan.Create(@"C:\momo\runtime\NikkiSync-PC-service.exe",28080);
    private static ConflictRule Block(string name="block",int profiles=4)=>new(name,Plan.Program,6,"*","*","*","*","All",false,"",1,0,profiles,true,"","",false);
    private sealed class Rules(params ConflictRule[] initial):IConflictRules
    {
        public List<ConflictRule> Values=initial.ToList();public int Writes;public int? FailAt;
        public IReadOnlyList<ConflictRule> Read()=>Values.ToArray();
        public void Change(ConflictRule expected,bool enabled,int profiles){if(++Writes==FailAt)throw new IOException();var index=Values.FindIndex(rule=>rule==expected);if(index<0)throw new IOException();Values[index]=expected with{Enabled=enabled,Profiles=profiles};}
    }
    private sealed class Journal:IConflictJournal
    {
        public List<ConflictChange> Value=[];public bool FailSave;
        public IReadOnlyList<ConflictChange> Load()=>Value.ToArray();
        public void Save(IReadOnlyList<ConflictChange> value){if(FailSave)throw new IOException();Value=value.ToList();}
    }
    [Fact] public void OnlyThisBackendTcpPortAndSelectedProfileAreRepairedAndRestored()
    {
        var target=Block(profiles:7);
        var untouched=new[]{Block("other") with{Program=@"C:\other\NikkiSync-PC-service.exe"},Block("udp") with{Protocol=17},Block("other-port") with{LocalPorts="443"},Block("private",2),Block("out") with{Direction=2},Block("off") with{Enabled=false},Block("allow") with{Action=1},Block("domain",1)};
        var rules=new Rules([target,..untouched]);var journal=new Journal();
        Assert.Equal(1,NetworkConflictRepair.Repair(rules,journal,Plan,4));
        Assert.Equal(target with{Profiles=3},rules.Values[0]);Assert.Equal(untouched,rules.Values.Skip(1));
        Assert.Single(journal.Value);Assert.Equal(0,NetworkConflictRepair.Repair(rules,journal,Plan,4));
        Assert.Equal(1,NetworkConflictRepair.Restore(rules,journal,Plan));Assert.Equal(target,rules.Values[0]);Assert.Empty(journal.Value);
    }
    [Fact] public void ALastProfileIsDisabledNotDeletedAndTheOriginalRuleReturns()
    {
        var original=Block();var rules=new Rules(original);var journal=new Journal();
        Assert.Equal(1,NetworkConflictRepair.Repair(rules,journal,Plan,4));Assert.Equal(original with{Enabled=false},rules.Values.Single());
        Assert.Equal(1,NetworkConflictRepair.Restore(rules,journal,Plan));Assert.Equal(original,rules.Values.Single());
    }
    [Fact] public void WindowsAllProfilesSentinelPreservesDomainAndCanBeRestoredExactly()
    {
        var original=Block(profiles:int.MaxValue);var rules=new Rules(original);var journal=new Journal();
        Assert.Equal(1,NetworkConflictRepair.Repair(rules,journal,Plan,4));
        Assert.Equal(original with{Profiles=3},rules.Values.Single());
        Assert.Equal(1,NetworkConflictRepair.Repair(rules,journal,Plan,2));
        Assert.Equal(original with{Profiles=1},rules.Values.Single());
        Assert.Equal(1,NetworkConflictRepair.Restore(rules,journal,Plan));
        Assert.Equal(original,rules.Values.Single());Assert.Empty(journal.Value);
    }
    [Fact] public void RestrictedAndAmbiguousRulesAreReportedButNotChanged()
    {
        var restricted=new[]{Block("range") with{RemoteAddresses="10.0.0.0/8"},Block("service") with{Service="ManagedService"},Block("interfaces") with{RestrictedInterfaces=true},Block("any-protocol") with{Protocol=256},Block("group") with{Grouping="Organization policy"},Block("unknown-ports") with{LocalPorts="RPC"},Block("same"),Block("same")};
        var rules=new Rules(restricted);var summary=NetworkConflictRepair.Inspect(rules.Read(),Plan,4);
        Assert.Equal(7,summary.Conflicts);Assert.Equal(0,summary.Repairable);
        Assert.Equal(0,NetworkConflictRepair.Repair(rules,new Journal(),Plan,4));Assert.Equal(0,rules.Writes);
    }
    [Fact] public void BackupMustPersistBeforeAnyRuleChanges()
    {
        var rules=new Rules(Block());Assert.Throws<IOException>(()=>NetworkConflictRepair.Repair(rules,new Journal{FailSave=true},Plan,4));Assert.Equal(0,rules.Writes);
    }
    [Fact] public void APartialFailureRollsBackChangesAndDoesNotTouchOthers()
    {
        var first=Block("first");var second=Block("second");var rules=new Rules(first,second){FailAt=2};var journal=new Journal();
        Assert.Throws<IOException>(()=>NetworkConflictRepair.Repair(rules,journal,Plan,4));Assert.Equal(new[]{first,second},rules.Values);Assert.Empty(journal.Value);
    }
    [Fact] public void RestoreNeverOverwritesAnAdministratorsLaterEditOrAnotherProgram()
    {
        var original=Block();var rules=new Rules(original);var journal=new Journal();NetworkConflictRepair.Repair(rules,journal,Plan,4);
        rules.Values[0]=rules.Values[0] with{RemoteAddresses="10.0.0.0/8"};Assert.Equal(0,NetworkConflictRepair.Restore(rules,journal,Plan));Assert.False(rules.Values[0].Enabled);Assert.Single(journal.Value);
        rules.Values[0]=original with{Enabled=false,Program=@"C:\other\other.exe"};Assert.Equal(0,NetworkConflictRepair.Restore(rules,journal,Plan));Assert.Single(journal.Value);
    }
    [Theory] [InlineData(0)] [InlineData(1)] [InlineData(3)] [InlineData(7)]
    public void UnknownOrDomainNetworkIsNeverModified(int profiles)=>Assert.Throws<InvalidDataException>(()=>NetworkConflictRepair.Repair(new Rules(Block()),new Journal(),Plan,profiles));
    [Theory] [InlineData("28000-28100",true)] [InlineData("443,28080",true)] [InlineData("443",false)] [InlineData("RPC",false)]
    public void PortMatchingIsExplicit(string ports,bool expected)=>Assert.Equal(expected,NetworkConflictRepair.MatchesPort(ports,28080));
    [Fact] public void RepairsOnTwoNetworksKeepOneOriginalBackup()
    {
        var original=Block(profiles:6);var rules=new Rules(original);var journal=new Journal();
        NetworkConflictRepair.Repair(rules,journal,Plan,4);NetworkConflictRepair.Repair(rules,journal,Plan,2);
        Assert.Single(journal.Value);Assert.False(rules.Values.Single().Enabled);
        Assert.Equal(1,NetworkConflictRepair.Restore(rules,journal,Plan));Assert.Equal(original,rules.Values.Single());
    }
    [Fact] public void ActualWindowsProfileLookupIsBoundToALocalAddress()
    {
        Assert.Equal(0,WindowsNetworkConflict.ProfileForHost("203.0.113.77"));Assert.Equal(0,WindowsNetworkConflict.ProfileForHost("127.0.0.1"));
        foreach(var nic in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces().Where(n=>n.OperationalStatus==System.Net.NetworkInformation.OperationalStatus.Up))
            foreach(var ip in nic.GetIPProperties().UnicastAddresses.Where(ip=>ip.Address.AddressFamily==System.Net.Sockets.AddressFamily.InterNetwork))
                Assert.Contains(WindowsNetworkConflict.ProfileForHost(ip.Address.ToString()),new[]{0,1,2,4});
        if(Environment.GetEnvironmentVariable("MOMO_NETWORK_PROFILE_HOST") is {Length:>0} host)
        {
            var expected=int.Parse(Environment.GetEnvironmentVariable("MOMO_NETWORK_PROFILE_FLAG")!);
            Assert.Equal(expected,WindowsNetworkConflict.ProfileForHost(host));
            var inspected=WindowsNetworkConflict.Inspect(Plan,host);Assert.Equal(expected,inspected.Profile);
        }
    }
    [Fact] public void OptInRealConflictRuleRoundTripOnlyChangesItsOwnFixtureAndEncryptedJournal()
    {
        if(Environment.GetEnvironmentVariable("MOMO_NETWORK_RULE_WRITE_TEST")!="1")return;
        var plan=NetworkAuthorizationPlan.Create(Path.Combine(Path.GetTempPath(),"MomoConflict-"+Guid.NewGuid().ToString("N"),"NikkiSync-PC-service.exe"),28080);
        var name="MomoConflictFixture-"+Guid.NewGuid().ToString("N");var other=name+"-other";
        var policy=Activator.CreateInstance(Type.GetTypeFromProgID("HNetCfg.FwPolicy2")!)!;
        var journalPath=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"MomoCamera-NetworkRepair-v1",plan.RuleName+".bin");
        Assert.False(File.Exists(journalPath));
        void Add(string id,string program)
        {
            var raw=Activator.CreateInstance(Type.GetTypeFromProgID("HNetCfg.FWRule")!)!;
            try{dynamic rule=raw;rule.Name=id;rule.ApplicationName=program;rule.Direction=1;rule.Action=0;rule.Protocol=6;rule.LocalPorts="*";rule.RemotePorts="*";rule.LocalAddresses="*";rule.RemoteAddresses="*";rule.InterfaceTypes="All";rule.Profiles=7;rule.Enabled=true;rule.EdgeTraversal=false;((dynamic)policy).Rules.Add(rule);}
            finally{Marshal.FinalReleaseComObject(raw);}
        }
        try
        {
            Add(name,plan.Program);Add(other,plan.Program+".other");
            var rules=new WindowsConflictRules(policy);var original=rules.Read().Single(rule=>rule.Name==name);var sentinel=rules.Read().Single(rule=>rule.Name==other);
            Assert.False(original.RestrictedInterfaces);
            var journal=new ProtectedConflictJournal(plan);
            Assert.Equal(1,NetworkConflictRepair.Repair(rules,journal,plan,4));Assert.Equal(original with{Profiles=3},rules.Read().Single(rule=>rule.Name==name));
            Assert.Equal(sentinel,rules.Read().Single(rule=>rule.Name==other));
            Assert.DoesNotContain(plan.Program,System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(journalPath)));
            Assert.Equal(1,NetworkConflictRepair.Restore(rules,journal,plan));Assert.Equal(original,rules.Read().Single(rule=>rule.Name==name));Assert.Empty(journal.Load());
        }
        finally
        {
            ((dynamic)policy).Rules.Remove(name);((dynamic)policy).Rules.Remove(other);Marshal.FinalReleaseComObject(policy);
            if(File.Exists(journalPath))File.Delete(journalPath);
        }
    }
}
