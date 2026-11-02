using System.IO;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace NikkiSync.WindowsShell.Services;

/// <summary>Machine-local, administrator-owned, encrypted write-ahead backup. Never shipped or uploaded.</summary>
public sealed class ProtectedConflictJournal(NetworkAuthorizationPlan plan):IConflictJournal
{
    private string DirectoryPath=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"MomoCamera-NetworkRepair-v1");
    private string FilePath=>Path.Combine(DirectoryPath,plan.RuleName+".bin");
    private byte[] Entropy=>SHA256.HashData(Encoding.UTF8.GetBytes(plan.Program+"\n"+plan.Port));
    private static void CheckPath(string path)
    {
        for(string? current=path;current is not null;current=Path.GetDirectoryName(current))
            if((Directory.Exists(current)||File.Exists(current))&&(File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new InvalidDataException("Linked repair journal.");
    }
    private void EnsureProtectedDirectory()
    {
        CheckPath(DirectoryPath);
        var security=new DirectorySecurity();security.SetAccessRuleProtection(true,false);
        var administrators=new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null);
        security.SetOwner(administrators);
        foreach(var sid in new[]{administrators,new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null)})
            security.AddAccessRule(new FileSystemAccessRule(sid,FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
        var directory=new DirectoryInfo(DirectoryPath);directory.Create(security);directory.SetAccessControl(security);CheckPath(DirectoryPath);
    }
    public IReadOnlyList<ConflictChange> Load()
    {
        CheckPath(FilePath);if(!File.Exists(FilePath))return [];
        if(new FileInfo(FilePath).Length>262144)throw new InvalidDataException("Oversized repair journal.");
        var bytes=ProtectedData.Unprotect(File.ReadAllBytes(FilePath),Entropy,DataProtectionScope.LocalMachine);
        return JsonSerializer.Deserialize<ConflictChange[]>(bytes)??throw new InvalidDataException();
    }
    public void Save(IReadOnlyList<ConflictChange> changes)
    {
        EnsureProtectedDirectory();CheckPath(FilePath);
        var bytes=ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(changes),Entropy,DataProtectionScope.LocalMachine);
        var temporary=FilePath+"."+Guid.NewGuid().ToString("N")+".tmp";
        try{using(var stream=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None,4096,FileOptions.WriteThrough)){stream.Write(bytes);stream.Flush(true);}File.Move(temporary,FilePath,true);}
        finally{if(File.Exists(temporary))File.Delete(temporary);}
    }
}
