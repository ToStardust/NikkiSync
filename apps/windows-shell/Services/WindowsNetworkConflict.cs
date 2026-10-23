using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

namespace NikkiSync.WindowsShell.Services;

public sealed record NetworkConflictStatus(int Profile,int Conflicts,int Repairable,bool PolicyAllowsChange);

public sealed class WindowsConflictRules(object policy):IConflictRules
{
    private static string Text(object? value)=>Convert.ToString(value)??"";
    private static ConflictRule Snapshot(dynamic rule)
    {
        var program=Environment.ExpandEnvironmentVariables(Text(rule.ApplicationName));
        if(Path.IsPathFullyQualified(program))program=Path.GetFullPath(program).ToLowerInvariant();
        object? interfaces=rule.Interfaces;
        var restricted=interfaces is Array list?list.Length>0:interfaces is not null&&interfaces is not DBNull&&Text(interfaces)!="";
        // Rules with IPsec/package/user restrictions are not suitable for automatic repair.
        try{restricted|=Text(rule.LocalAppPackageId)!=""||Text(rule.LocalUserAuthorizedList)!=""||Text(rule.RemoteUserAuthorizedList)!=""||Text(rule.RemoteMachineAuthorizedList)!=""||(int)rule.EdgeTraversalOptions!=0;}
        catch{restricted=true;}
        int protocol=rule.Protocol;
        return new(Text(rule.Name),program,protocol,protocol==6?Text(rule.LocalPorts):"*",protocol==6?Text(rule.RemotePorts):"*",
            Text(rule.LocalAddresses),Text(rule.RemoteAddresses),Text(rule.InterfaceTypes),restricted,Text(rule.ServiceName),
            (int)rule.Direction,(int)rule.Action,(int)rule.Profiles,(bool)rule.Enabled,Text(rule.Grouping),Text(rule.Description),(bool)rule.EdgeTraversal);
    }
    public IReadOnlyList<ConflictRule> Read()
    {
        var result=new List<ConflictRule>();object? collection=null;
        try
        {
            collection=((dynamic)policy).Rules;
            foreach(var item in (System.Collections.IEnumerable)collection)
                try{result.Add(Snapshot((dynamic)item));}finally{WindowsNetworkConflict.Release(item);}
            return result;
        }
        finally{WindowsNetworkConflict.Release(collection);}
    }
    public void Change(ConflictRule expected,bool enabled,int profiles)
    {
        object? collection=null;object? selected=null;
        try
        {
            collection=((dynamic)policy).Rules;var count=0;
            foreach(var item in (System.Collections.IEnumerable)collection)
            {
                bool keep=false;
                try{if(Text(((dynamic)item).Name)==expected.Name){count++;if(selected is null){selected=item;keep=true;}}}
                finally{if(!keep)WindowsNetworkConflict.Release(item);}
            }
            if(count!=1||selected is null||Snapshot((dynamic)selected)!=expected)throw new IOException("Rule changed; no overwrite.");
            dynamic rule=selected!;
            if(expected.Profiles!=profiles)rule.Profiles=profiles;
            if(expected.Enabled!=enabled)rule.Enabled=enabled;
            if(Snapshot(rule)!=expected with{Enabled=enabled,Profiles=profiles})throw new IOException("Firewall did not retain the change.");
        }
        finally{WindowsNetworkConflict.Release(selected);WindowsNetworkConflict.Release(collection);}
    }
}

public static class WindowsNetworkConflict
{
    // GUID return values are not Automation-compatible; use the SDK vtable rather
    // than dynamic IDispatch for INetworkConnection.GetAdapterId (netlistmgr.idl).
    [ComImport, Guid("DCB00005-570F-4A9B-8D69-199FDBA5723B"), InterfaceType(ComInterfaceType.InterfaceIsDual)]
    private interface INetworkConnection
    {
        [return: MarshalAs(UnmanagedType.Interface)] object GetNetwork();
        [return: MarshalAs(UnmanagedType.VariantBool)] bool IsConnectedToInternet();
        [return: MarshalAs(UnmanagedType.VariantBool)] bool IsConnected();
        int GetConnectivity();
        Guid GetConnectionId();
        Guid GetAdapterId();
        int GetDomainType();
    }

    public static int ProfileForHost(string host)
    {
        if(!IPAddress.TryParse(host,out var address)||address.AddressFamily!=System.Net.Sockets.AddressFamily.InterNetwork||IPAddress.IsLoopback(address))return 0;
        var adapters=NetworkInterface.GetAllNetworkInterfaces().Where(nic=>nic.OperationalStatus==OperationalStatus.Up&&nic.GetIPProperties().UnicastAddresses.Any(ip=>ip.Address.Equals(address))).Select(nic=>nic.Id).ToArray();
        if(adapters.Length!=1||!Guid.TryParse(adapters[0],out var adapterId))return 0;
        object? manager=null;object? connections=null;var categories=new HashSet<int>();
        try
        {
            manager=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("DCB00C01-570F-4A9B-8D69-199FDBA5723B"))!);
            connections=((dynamic)manager!).GetNetworkConnections();
            foreach(var connection in (System.Collections.IEnumerable)connections)
            {
                object? network=null;
                try
                {
                    var typed=(INetworkConnection)connection;
                    if(typed.GetAdapterId()!=adapterId)continue;
                    network=typed.GetNetwork();int category=((dynamic)network).GetCategory();
                    categories.Add(category switch{0=>4,1=>2,2=>1,_=>0});
                }
                finally{Release(network);Release(connection);}
            }
        }
        catch{return 0;}
        finally{Release(connections);Release(manager);}
        return categories.Count==1?categories.Single():0;
    }
    public static NetworkConflictStatus Inspect(NetworkAuthorizationPlan plan,string host)
    {
        var profile=ProfileForHost(host);if(profile is not (2 or 4))return new(profile,0,0,false);
        var policy=Activator.CreateInstance(Type.GetTypeFromProgID("HNetCfg.FwPolicy2")!)!;
        try
        {
            var summary=NetworkConflictRepair.Inspect(new WindowsConflictRules(policy).Read(),plan,profile);
            bool writable=(int)((dynamic)policy).LocalPolicyModifyState==0&&!(bool)((dynamic)policy).BlockAllInboundTraffic[profile];
            return new(profile,summary.Conflicts,writable?summary.Repairable:0,writable);
        }
        finally{Release(policy);}
    }
    public static ProcessStartInfo Elevation(string executable,NetworkAuthorizationPlan plan,string host,bool restore)
    {
        var info=new ProcessStartInfo(executable){UseShellExecute=true,Verb="runas",WorkingDirectory=Path.GetDirectoryName(executable)!};
        foreach(var value in new[]{"--repair-network",plan.Program,plan.LocalPorts,host,restore?"restore":"repair"})info.ArgumentList.Add(value);
        return info;
    }
    public static int RunHelper(string program,string port,string host,string operation)
    {
        if(operation is not ("repair" or "restore")||!int.TryParse(port,out var number))return 3;
        object? policy=null;
        try
        {
            var plan=NetworkAuthorizationPlan.Create(program,number);
            using var metadata=Assembly.GetExecutingAssembly().GetManifestResourceStream(RuntimePayload.ManifestResource)??throw new InvalidDataException();
            var manifest=JsonSerializer.Deserialize<PayloadManifest>(metadata)??throw new InvalidDataException();
            using var verified=NetworkAuthorization.ValidateBackend(plan.Program,manifest.Files.Single(file=>file.Path=="runtime/NikkiSync-PC-service.exe"));
            var profile=ProfileForHost(host);if(profile is not (2 or 4))return 411;
            policy=Activator.CreateInstance(Type.GetTypeFromProgID("HNetCfg.FwPolicy2")!)!;
            if((int)((dynamic)policy).LocalPolicyModifyState!=0||(bool)((dynamic)policy).BlockAllInboundTraffic[profile])return 412;
            var rules=new WindowsConflictRules(policy);var journal=new ProtectedConflictJournal(plan);
            if(operation=="restore")
            {
                var restored=NetworkConflictRepair.Restore(rules,journal,plan);
                return journal.Load().Count>0?415:restored>0?414:416;
            }
            var authorization=NetworkAuthorization.RunHelper(program,port,"allow");if(authorization is not (0 or 8))return authorization;
            var count=NetworkConflictRepair.Repair(rules,journal,plan,profile);
            var remaining=NetworkConflictRepair.Inspect(rules.Read(),plan,profile).Conflicts;
            return remaining>0?413:count>0?410:417;
        }
        catch(UnauthorizedAccessException){return 5;}
        catch(InvalidDataException){return 3;}
        catch(COMException error) when(error.HResult==unchecked((int)0x80070005)){return 412;}
        catch{return 418;}
        finally{Release(policy);}
    }
    internal static void Release(object? value){if(value is not null&&Marshal.IsComObject(value))Marshal.FinalReleaseComObject(value);}
    public static string ResultMessage(int code)=>code switch
    {
        410=>"已处理当前后台在此网络配置下的冲突阻止，并保留恢复记录。请回手机重新连接；需要恢复时点击“撤销上次修复”。",
        411=>"无法确定当前连接的网络类型，或这是受管理的域网络；未修改阻止规则，请导出诊断报告。",
        412=>"电脑策略限制此项操作，未绕过管理策略。请联系电脑管理员或反馈诊断报告。",
        413=>"已检查并处理可安全恢复的规则，仍有复杂限制规则，需继续诊断；不会自动更改它们。",
        414=>"已恢复本次修复前的阻止规则。原有连接限制可能重新生效。",
        415=>"部分规则已被其他操作改动，为避免覆盖没有恢复。其余记录已保留，请反馈诊断报告。",
        416=>"没有待恢复的冲突修复记录，网络规则未修改。",
        417=>"已检查当前后台并确认本地网络授权，未发现需要处理的冲突阻止。仍连接失败时请反馈诊断报告。",
        418=>"冲突处理未完成，已尝试回滚并保留恢复记录。可点击“撤销上次修复”，并反馈 NET-REPAIR-418。",
        _=>NetworkAuthorization.ResultMessage(code)
    };
}
