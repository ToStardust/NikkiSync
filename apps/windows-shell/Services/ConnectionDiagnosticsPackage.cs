using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.Json;

namespace NikkiSync.WindowsShell.Services;

public sealed record DiagnosticContext(string Version,long Build,int? LastRepairCode=null,string? LastRepairOperation=null,string? LastRepairState=null,bool? ServiceProcessRunning=null);
public sealed record DiagnosticCollection(string Status,string? Report=null,int? ExitCode=null,int? NativeErrorCode=null);
public interface IConnectionDiagnosticCollector
{
    Task<DiagnosticCollection> CollectAsync(int desktopPort,CancellationToken cancellationToken);
}

/// <summary>Explicit user export; fixed files and parsed allowlisted fields only.</summary>
public static class ConnectionDiagnosticsPackage
{
    private const int MaxLogBytes=65536;
    private static readonly string[] Logs=["startup-timings.json","startup-service-timings.json","startup-error.log","startup-diagnostics.log","game-discovery.log","scan-status.json"];
    private static readonly string[] Stages=["configuration","database-and-tls","scanner","lan-listen","cached-metadata","dictionary-enrichment","background-services","runtime-ready","desktop-control","dashboard-ready"];
    private static readonly string[] Codes=["GAME_NOT_FOUND","NO_LAN","PORT_IN_USE","FILE_ACCESS","MISSING_FILE","DATABASE_ERROR","CPU_INSTRUCTION","NATIVE_DEPENDENCY","WRONG_ARCHITECTURE","SERVICE_TIMEOUT","WEBVIEW_MISSING","STARTUP_ERROR","SERVICE_EXIT","FILE_BUSY","DISK_FULL","PATH_TOO_LONG","FILE_VALIDATION"];
    public static void RejectLinks(string path)
    {
        for(string? current=Path.GetFullPath(path);current is not null;current=Path.GetDirectoryName(current))
            if((File.Exists(current)||Directory.Exists(current))&&(File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new InvalidDataException("Linked diagnostic source.");
    }
    public static byte[] SanitizeLog(string name,byte[] bytes)
    {
        if(!Logs.Contains(name)||bytes.Length>MaxLogBytes)throw new InvalidDataException();
        var input=bytes.AsMemory();if(input.Length>=3&&input.Span[0]==0xef&&input.Span[1]==0xbb&&input.Span[2]==0xbf)input=input[3..];
        using var parsed=JsonDocument.Parse(input,new JsonDocumentOptions{MaxDepth=12});
        var source=parsed.RootElement;if(source.ValueKind!=JsonValueKind.Object)throw new InvalidDataException();
        var safe=new Dictionary<string,object?>();
        static void Time(JsonElement from,Dictionary<string,object?> to,string key)
        {if(from.TryGetProperty(key,out var value)&&value.ValueKind==JsonValueKind.String&&value.TryGetDateTimeOffset(out var time))to[key]=time.ToUniversalTime().ToString("O");}
        static void Number(JsonElement from,Dictionary<string,object?> to,string key,bool signed=false)
        {if(from.TryGetProperty(key,out var value)&&value.ValueKind==JsonValueKind.Number&&value.TryGetDouble(out var number)&&double.IsFinite(number)&&number<1e15&&(signed?number>=int.MinValue:number>=0))to[key]=number;}
        static void Flag(JsonElement from,Dictionary<string,object?> to,string key)
        {if(from.TryGetProperty(key,out var value)&&value.ValueKind is JsonValueKind.True or JsonValueKind.False)to[key]=value.GetBoolean();}
        static void Choice(JsonElement from,Dictionary<string,object?> to,string key,params string[] allowed)
        {if(from.TryGetProperty(key,out var value)&&value.ValueKind==JsonValueKind.String)to[key]=allowed.Contains(value.GetString())?value.GetString():"unknown";}
        Time(source,safe,"timestamp");
        if(name=="startup-timings.json")
        {
            Choice(source,safe,"phase","runtime","webview","service","dashboard");Choice(source,safe,"status","starting","ready","failed","cancelled");Number(source,safe,"elapsedMs");
            if(source.TryGetProperty("stages",out var stages)&&stages.ValueKind==JsonValueKind.Object){var values=new Dictionary<string,object?>();foreach(var key in new[]{"runtimeReadyMs","browserReadyMs","serviceReadyMs","dashboardReadyMs"})Number(stages,values,key);safe["stages"]=values;}
        }
        else if(name=="startup-service-timings.json")
        {
            Choice(source,safe,"stage",Stages);
            if(source.TryGetProperty("milestones",out var milestones)&&milestones.ValueKind==JsonValueKind.Object){var values=new Dictionary<string,object?>();foreach(var key in Stages)Number(milestones,values,key);safe["milestones"]=values;}
            if(source.TryGetProperty("scan",out var scan)&&scan.ValueKind==JsonValueKind.Object){var values=new Dictionary<string,object?>();Choice(scan,values,"stage","scan-files","scan-index","scan-watch");foreach(var key in new[]{"filesObserved","filesCompleted","bytesRead","assetsProcessed"})Number(scan,values,key);safe["scan"]=values;}
        }
        else if(name=="scan-status.json")
        {
            Choice(source,safe,"status","stopped","discovering","scanning","reconciling","watching","running","error");Flag(source,safe,"installationFound");
            foreach(var key in new[]{"scanRootCount","automaticRootCount","extraRootCount"})Number(source,safe,key);
            if(source.TryGetProperty("lastScan",out var last)&&last.ValueKind==JsonValueKind.Object){var values=new Dictionary<string,object?>();foreach(var key in new[]{"filesObserved","resourcesAccepted","resourcesIgnored","assetsCreated","assetsUpdated","assetsDeleted","errorCount"})Number(last,values,key);safe["lastScan"]=values;}
        }
        else if(name=="game-discovery.log")
        {
            Choice(source,safe,"source","cached","manual","environment","registry","shortcut","drive","bounded","running-process","not-found","none");
            foreach(var key in new[]{"found","windowsProbeFailed","searchLimited"})Flag(source,safe,key);
            foreach(var key in new[]{"checkedDirectories","registryHints","shortcutHints","driveRoots","elapsedMs"})Number(source,safe,key);
        }
        else
        {
            Choice(source,safe,"phase",["runtime","webview","service","dashboard","configuration","database-and-tls","scanner-and-lan","desktop-control"]);
            Choice(source,safe,"code",Codes);Number(source,safe,"exitCode",true);Number(source,safe,"appBuild");
            if(source.TryGetProperty("database",out var database)&&database.ValueKind==JsonValueKind.Object)
            {
                var values=new Dictionary<string,object?>();
                Choice(database,values,"category","sql","busy","locked","memory","read-only","io","corrupt","full","cannot-open","schema","too-big","constraint","type-mismatch","not-database","unknown");
                Choice(database,values,"constraint","resource-path-unique","resource-id-unique","asset-id-unique","foreign-key","check","not-null","unknown");
                foreach(var key in new[]{"resultCode","extendedCode"})
                    if(database.TryGetProperty(key,out var value)&&value.ValueKind==JsonValueKind.Number&&value.TryGetInt32(out var number)&&number>0&&number<=(key=="resultCode"?255:65535))values[key]=number;
                safe["database"]=values;
            }
            if(source.TryGetProperty("index",out var index)&&index.ValueKind==JsonValueKind.Object)
            {
                var values=new Dictionary<string,object?>();Choice(index,values,"operation","build-snapshots","write-asset","mark-missing");
                Number(index,values,"processedAssets");Number(index,values,"observedResources");safe["index"]=values;
            }
            Choice(source,safe,"exceptionKind","access-denied","path-too-long","file-not-found","directory-not-found","invalid-data","invalid-json","io","win32","security","not-supported","argument","cancelled","unknown");
            foreach(var key in new[]{"hresultHex","exitCodeHex"})
                if(source.TryGetProperty(key,out var value)&&value.ValueKind==JsonValueKind.String&&System.Text.RegularExpressions.Regex.IsMatch(value.GetString()??"",@"\A0x[0-9A-Fa-f]{8}\z"))safe[key]=value.GetString();
            Choice(source,safe,"runtimeStep",Enum.GetNames<PayloadPreparationStep>());
            if(source.TryGetProperty("appVersion",out var version)&&version.ValueKind==JsonValueKind.String&&System.Text.RegularExpressions.Regex.IsMatch(version.GetString()??"",@"\A[0-9]{1,4}(\.[0-9]{1,4}){2,3}\z"))safe["appVersion"]=version.GetString();
        }
        return JsonSerializer.SerializeToUtf8Bytes(safe,new JsonSerializerOptions{WriteIndented=true});
    }
    public static async Task ExportAsync(string destination,string logDirectory,int desktopPort,DiagnosticContext context,IConnectionDiagnosticCollector collector,CancellationToken cancellationToken=default)
    {
        if(desktopPort is <1 or >65535)throw new ArgumentOutOfRangeException(nameof(desktopPort));
        destination=Path.GetFullPath(destination);RejectLinks(destination);
        var temporary=destination+"."+Guid.NewGuid().ToString("N")+".tmp";
        DiagnosticCollection collected;
        try{collected=await collector.CollectAsync(desktopPort,cancellationToken);}
        catch(System.ComponentModel.Win32Exception error){collected=new("unavailable",NativeErrorCode:error.NativeErrorCode);}
        catch(Exception error) when(error is IOException or InvalidDataException or UnauthorizedAccessException or System.Security.SecurityException){collected=new("unavailable");}
        cancellationToken.ThrowIfCancellationRequested();
        var statuses=new Dictionary<string,string>();
        try
        {
            await using(var output=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None))
            using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true,Encoding.UTF8))
            {
                void Add(string name,byte[] bytes){using var entry=zip.CreateEntry(name,CompressionLevel.Optimal).Open();entry.Write(bytes);}
                void Text(string name,string value)=>Add(name,Encoding.UTF8.GetBytes(value));
                var validCollection=collected.Status=="ok"&&collected.Report is {Length:>0 and <=131072} report&&report.StartsWith("MomoCamera connection diagnostic report v",StringComparison.Ordinal);
                if(validCollection)Text("ConnectionReport.txt",collected.Report!);
                statuses["connectionCheck"]=validCollection?"included":collected.Status is "timeout" or "failed" or "unavailable"?collected.Status:"unavailable";
                foreach(var name in Logs)
                {
                    cancellationToken.ThrowIfCancellationRequested();var path=Path.Combine(logDirectory,name);
                    try
                    {
                        RejectLinks(path);
                        if(!File.Exists(path)){statuses[name]="missing";continue;}
                        using var input=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete);
                        if(input.Length>MaxLogBytes){statuses[name]="too-large";continue;}
                        using var buffer=new MemoryStream();var chunk=new byte[4096];int count;
                        while((count=input.Read(chunk))>0){if(buffer.Length+count>MaxLogBytes)throw new InvalidDataException();buffer.Write(chunk,0,count);}
                        Add("logs/"+name,SanitizeLog(name,buffer.ToArray()));statuses[name]="included";
                    }
                    catch(JsonException){statuses[name]="invalid-json";}
                    catch(Exception error) when(error is IOException or InvalidDataException or UnauthorizedAccessException or System.Security.SecurityException){statuses[name]="unavailable";}
                }
                Add("DiagnosticSummary.json",JsonSerializer.SerializeToUtf8Bytes(new{schema=1,serviceProcessRunning=context.ServiceProcessRunning,exportedAt=DateTimeOffset.UtcNow,appVersion=context.Version,appBuild=context.Build,windows=Environment.OSVersion.Version.ToString(),architecture=System.Runtime.InteropServices.RuntimeInformation.OSArchitecture.ToString(),desktopControlPort=desktopPort,collectorExitCode=collected.ExitCode,collectorNativeErrorCode=collected.NativeErrorCode,lastRepairCode=context.LastRepairCode,lastRepairOperation=context.LastRepairOperation is "repair" or "restore"?context.LastRepairOperation:null,lastRepairState=context.LastRepairState is "running" or "completed" or "cancelled" or "launch-failed"?context.LastRepairState:null,files=statuses},new JsonSerializerOptions{WriteIndented=true}));
                Text("反馈说明.txt","请把此压缩包发给开发者，并补充手机品牌/型号、App版本、连接方式和手机端报错截图。\n压缩包包含连接检查、版本信息和筛选后的启动日志，不包含照片、配对码、密钥、用户名、MAC地址、Wi-Fi名称或个人路径；不会自动上传。\n连接检查仅用于排障，不修改防火墙、热点或网络设置。日志可能来自不同启动时间，旧错误不一定代表本次故障。\nDiagnosticSummary.json列出了缺失或未完成的项目，部分检查失败时其余信息仍可用于排查。\n");
            }
            cancellationToken.ThrowIfCancellationRequested();RejectLinks(destination);File.Move(temporary,destination,true);
        }
        finally{if(File.Exists(temporary))File.Delete(temporary);}
    }
}
