using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace NikkiSync.WindowsShell.Services;

public sealed record NetworkAuthorizationPlan(string Program, int Port, string RuleName)
{
    public const string Group = "MomoCamera LAN Authorization v1";
    public int Protocol => 6;
    public int Direction => 1;
    public int Profiles => 6; // Private + Public. Never alter managed Domain rules.
    public string RemoteAddresses => "LocalSubnet";
    public string LocalPorts => Port.ToString(CultureInfo.InvariantCulture);
    public bool EdgeTraversal => false;

    public static NetworkAuthorizationPlan Create(string program, int port)
    {
        if (!Path.IsPathFullyQualified(program) || program.StartsWith(@"\\") || port is < 1 or > 65535
            || !Path.GetFileName(program).Equals("NikkiSync-PC-service.exe",StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Invalid network authorization target.");
        var canonical = Path.GetFullPath(program).ToLowerInvariant();
        var identity = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical+"\n"+port.ToString(CultureInfo.InvariantCulture))))[..24];
        return new(canonical,port,"MomoCamera-LAN-TCP-"+identity);
    }
}

public sealed record NetworkRulePresence(bool Owned,bool Matches);
public interface INetworkAuthorizationRules
{
    NetworkRulePresence? Find(NetworkAuthorizationPlan plan);
    void Add(NetworkAuthorizationPlan plan);
    void Remove(string name);
}

// Only the explicitly requested elevated helper writes firewall rules. The normal UI and
// isolated acceptance mode never elevate on startup. No shell scripts or web-supplied paths.
public static class NetworkAuthorization
{
    private sealed class RuleOperationException(int code,Exception inner):Exception("Network rule operation failed.",inner)
    { public int Code=>code; }

    public static NetworkRulePresence? ReadRulePresence(NetworkAuthorizationPlan plan)
    {
        var policy=Activator.CreateInstance(Type.GetTypeFromProgID("HNetCfg.FwPolicy2")!)!;
        try { return new WindowsRules(policy).Find(plan); }
        finally { Release(policy); }
    }
    public static ProcessStartInfo CreateElevationStartInfo(string executable, NetworkAuthorizationPlan plan, bool remove)
    {
        var info = new ProcessStartInfo(executable){UseShellExecute=true,Verb="runas",WorkingDirectory=Path.GetDirectoryName(executable)!};
        foreach(var argument in new[]{"--authorize-network",plan.Program,plan.LocalPorts,remove?"remove":"allow"}) info.ArgumentList.Add(argument);
        return info;
    }

    public static FileStream ValidateBackend(string program, PayloadFile expected)
    {
        _ = NetworkAuthorizationPlan.Create(program,28080);
        if(expected.Path!="runtime/NikkiSync-PC-service.exe" || expected.Length<1 || expected.Sha256.Length!=64)
            throw new InvalidDataException("Invalid embedded backend manifest.");
        var current=Path.GetFullPath(program);
        while(current is not null)
        {
            if((File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0) throw new InvalidDataException("Linked backend path.");
            current=Path.GetDirectoryName(current);
        }
        var stream=new FileStream(program,FileMode.Open,FileAccess.Read,FileShare.Read);
        try
        {
            if(stream.Length!=expected.Length || !Convert.ToHexString(SHA256.HashData(stream)).Equals(expected.Sha256,StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Backend checksum mismatch.");
            stream.Position=0;
            return stream; // Keep the exact verified file locked against replacement while authorizing.
        }
        catch { stream.Dispose();throw; }
    }

    public static int RunHelper(string program,string portText,string operation)
    {
        if(operation is not ("allow" or "remove") || !int.TryParse(portText,NumberStyles.None,CultureInfo.InvariantCulture,out var port)) return 3;
        object? policy=null;
        try
        {
            var plan=NetworkAuthorizationPlan.Create(program,port);
            using var metadata=Assembly.GetExecutingAssembly().GetManifestResourceStream(RuntimePayload.ManifestResource)
                ?? throw new InvalidDataException("An embedded portable package is required.");
            var manifest=JsonSerializer.Deserialize<PayloadManifest>(metadata) ?? throw new InvalidDataException();
            var expected=manifest.Files.Single(file=>file.Path=="runtime/NikkiSync-PC-service.exe");
            using var verified=ValidateBackend(plan.Program,expected);
            policy=Activator.CreateInstance(Type.GetTypeFromProgID("HNetCfg.FwPolicy2")!);
            return ApplyRules(new WindowsRules(policy!),plan,operation=="remove");
        }
        catch(InvalidDataException) { return 3; }
        catch(UnauthorizedAccessException) { return 5; }
        catch(COMException error) when(error.HResult==unchecked((int)0x80070005)) { return 5; }
        catch(RuleOperationException error) { return error.InnerException?.HResult==unchecked((int)0x80070005)?5:error.Code; }
        catch { return 6; }
        finally { Release(policy); }
    }

    public static int ApplyRules(INetworkAuthorizationRules rules,NetworkAuthorizationPlan plan,bool remove)
    {
        var existing=rules.Find(plan);
        if(existing is {Owned:false}) return 6;
        if(remove)
        {
            if(existing is not null) rules.Remove(plan.RuleName);
            return rules.Find(plan) is null?9:6;
        }
        if(existing is {Matches:true}) return 8;
        // Leave unexpected preexisting settings untouched instead of silently replacing them.
        if(existing is not null) return 6;
        rules.Add(plan);
        return rules.Find(plan) is {Owned:true,Matches:true}?0:6;
    }

    private sealed class WindowsRules(object policy):INetworkAuthorizationRules
    {
        public NetworkRulePresence? Find(NetworkAuthorizationPlan plan)
        {
            object? existing=null;
            try
            {
                try { existing=((dynamic)policy).Rules.Item(plan.RuleName); }
                catch(FileNotFoundException) { return null; }
                catch(COMException error) when(error.HResult==unchecked((int)0x80070002)) { return null; }
                return new(IsOwned(existing!,plan),Matches(existing!,plan));
            }
            catch(Exception error) { throw new RuleOperationException(202,error); }
            finally { Release(existing); }
        }
        public void Add(NetworkAuthorizationPlan plan)
        {
            object? raw=null;
            try { raw=CreateRule(plan);((dynamic)policy).Rules.Add((dynamic)raw); }
            catch(Exception error) { throw new RuleOperationException(203,error); }
            finally { Release(raw); }
        }
        public void Remove(string name)
        {
            try { ((dynamic)policy).Rules.Remove(name); }
            catch(Exception error) { throw new RuleOperationException(204,error); }
        }
    }

    private static object CreateRule(NetworkAuthorizationPlan plan)
    {
        object raw=Activator.CreateInstance(Type.GetTypeFromProgID("HNetCfg.FWRule")!)!;
        try
        {
            dynamic rule=raw;
            rule.Name=plan.RuleName;rule.Grouping=NetworkAuthorizationPlan.Group;
            rule.Description="MomoCamera phone sync; exact backend, TCP port and local subnet only.";
            rule.ApplicationName=plan.Program;rule.Protocol=plan.Protocol;rule.LocalPorts=plan.LocalPorts;
            rule.RemotePorts="*";rule.LocalAddresses="*";rule.RemoteAddresses=plan.RemoteAddresses;
            rule.Direction=plan.Direction;rule.Profiles=plan.Profiles;rule.Action=1;
            rule.InterfaceTypes="All";rule.EdgeTraversal=plan.EdgeTraversal;rule.Enabled=true;
            return raw;
        }
        catch { Release(raw);throw; }
    }

    // Construct an unattached COM rule for acceptance: deliberately no policy object or Rules.Add.
    public static bool VerifyRuleConstruction(NetworkAuthorizationPlan plan)
    {
        var rule=CreateRule(plan);
        try { return Matches(rule,plan); }
        finally { Release(rule); }
    }

    private static bool IsOwned(dynamic rule,NetworkAuthorizationPlan plan) =>
        string.Equals((string)rule.Grouping,NetworkAuthorizationPlan.Group,StringComparison.Ordinal)
        && string.Equals((string)rule.ApplicationName,plan.Program,StringComparison.OrdinalIgnoreCase);
    private static bool Matches(dynamic rule,NetworkAuthorizationPlan plan) => IsOwned(rule,plan)
        && (bool)rule.Enabled && (int)rule.Action==1 && (int)rule.Direction==plan.Direction
        && (int)rule.Protocol==plan.Protocol && (string)rule.LocalPorts==plan.LocalPorts
        && (string)rule.RemoteAddresses==plan.RemoteAddresses && (string)rule.LocalAddresses=="*"
        && (string)rule.RemotePorts=="*" && (int)rule.Profiles==plan.Profiles
        && !(bool)rule.EdgeTraversal && string.IsNullOrEmpty((string)rule.ServiceName)
        && (string)rule.InterfaceTypes=="All";
    private static void Release(object? value) { if(value is not null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value); }

    public static string ResultMessage(int code) => code switch
    {
        0=>"已添加本地网络连接权限，请回到手机重新扫码连接。若仍失败，请反馈连接诊断报告。",
        8=>"当前后台服务已经有本工具添加的网络权限，请在手机重试；仍失败时需继续检查网络或其他安全软件。",
        9=>"已撤销本工具为当前后台服务添加的网络权限。",
        3=>"后台服务校验未通过，请退出后重新打开此测试版，再重试网络授权。",
        5=>"没有获得修改防火墙的权限，或被电脑管理策略限制。请联系电脑管理员。",
        202=>"网络授权未完成：读取规则失败（NET-AUTH-202）。请反馈此代码和诊断报告。",
        203=>"网络授权未完成：添加规则失败（NET-AUTH-203）。请反馈此代码和诊断报告。",
        204=>"网络授权未完成：撤销规则失败（NET-AUTH-204）。请反馈此代码和诊断报告。",
        _=>$"网络授权未完成（NET-AUTH-{code}）。这只是授权操作结果，不代表当前手机连接状态；请反馈此代码和诊断报告。"
    };
}
