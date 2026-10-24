using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell.Tests;

public sealed class ConnectionDiagnosticsTests:IDisposable
{
    private readonly string _root=Path.Combine(Path.GetTempPath(),"MomoDiagTests-"+Guid.NewGuid().ToString("N"));
    private sealed class Collector(string status="ok"):IConnectionDiagnosticCollector
    {
        public int Port;
        public Task<DiagnosticCollection> CollectAsync(int port,CancellationToken ct){Port=port;return Task.FromResult(new DiagnosticCollection(status,status=="ok"?"MomoCamera connection diagnostic report v5\nSync TCP listeners: 0.0.0.0:28080":null));}
    }
    private sealed class UnavailableCollector:IConnectionDiagnosticCollector
    {public Task<DiagnosticCollection> CollectAsync(int port,CancellationToken ct)=>Task.FromException<DiagnosticCollection>(new InvalidDataException("private-collector-error"));}
    public ConnectionDiagnosticsTests()=>Directory.CreateDirectory(_root);
    public void Dispose(){var full=Path.GetFullPath(_root);Assert.StartsWith(Path.GetFullPath(Path.GetTempPath()),full);Assert.StartsWith("MomoDiagTests-",Path.GetFileName(full));Directory.Delete(full,true);}
    private string FileAt(string name)=>Path.Combine(_root,name);
    [Fact] public async Task ExportIncludesUsefulStagesButNeverRawLogsSecretsOrUnrelatedFiles()
    {
        const string secret="PRIVATE_DIAGNOSTIC_FIXTURE_SECRET_8492";
        File.WriteAllText(FileAt("startup-error.log"),JsonSerializer.Serialize(new{timestamp="2026-10-23T15:34:34.687Z",phase="scanner-and-lan",code="PORT_IN_USE",stack=secret,path=secret,token=secret}));
        File.WriteAllText(FileAt("startup-timings.json"),JsonSerializer.Serialize(new{timestamp="2026-10-23T18:07:42Z",status="ready",phase="dashboard",elapsedMs=36700,token=secret,stages=new{serviceReadyMs=36570,privateStage=secret}}));
        File.WriteAllText(FileAt("startup-service-timings.json"),JsonSerializer.Serialize(new{stage="dashboard-ready",milestones=new{scanner=125,raw=secret},scan=new{stage="scan-watch",filesObserved=2581,assetsProcessed=858,filename=secret}}));
        File.WriteAllText(FileAt("startup-diagnostics.log"),JsonSerializer.Serialize(new{code="SERVICE_EXIT",exceptionKind="io",hresultHex="0x80070020",runtimeStep="Ready",appVersion="1.0.22",hint=secret,windows=secret,appBuild=2026102402}));
        File.WriteAllText(FileAt("game-discovery.log"),JsonSerializer.Serialize(new{found=true,source="cached",checkedDirectories=1,gameRoot=secret}));
        File.WriteAllText(FileAt("nikkisync.sqlite"),secret);File.WriteAllText(FileAt("metadata-online-consent.json"),secret);
        var collector=new Collector();await ConnectionDiagnosticsPackage.ExportAsync(FileAt("result.zip"),_root,28951,new("1.0.22",2026102402,410,"repair"),collector);
        Assert.Equal(28951,collector.Port);
        using var zip=ZipFile.OpenRead(FileAt("result.zip"));Assert.Equal(8,zip.Entries.Count);
        Assert.DoesNotContain(zip.Entries,e=>e.Name.EndsWith(".sqlite")||e.Name.EndsWith(".ps1"));
        var text=string.Join("\n",zip.Entries.Select(e=>{using var reader=new StreamReader(e.Open());return reader.ReadToEnd();}));
        Assert.DoesNotContain(secret,text);Assert.Contains("PORT_IN_USE",text);Assert.Contains("dashboard-ready",text);Assert.Contains("2026-10-23T15:34:34",text);Assert.Contains("2026-10-23T18:07:42",text);
        Assert.Contains("410",text);Assert.Contains("28951",text);Assert.Contains("assetsProcessed",text);
        Assert.Empty(Directory.GetFiles(_root,"*.tmp"));
    }
    [Fact] public async Task FailedCollectionMissingMalformedAndOversizedLogsStillProduceAnHonestPartialPackage()
    {
        File.WriteAllText(FileAt("startup-error.log"),"not-json-private-error");
        File.WriteAllText(FileAt("game-discovery.log"),new string('x',65537));
        await ConnectionDiagnosticsPackage.ExportAsync(FileAt("result.zip"),_root,28950,new("1.0.22",2026102402),new Collector("timeout"));
        using var zip=ZipFile.OpenRead(FileAt("result.zip"));Assert.Equal(2,zip.Entries.Count);
        using var reader=new StreamReader(zip.GetEntry("DiagnosticSummary.json")!.Open());var text=reader.ReadToEnd();
        Assert.Contains("timeout",text);Assert.Contains("invalid-json",text);Assert.Contains("too-large",text);Assert.Contains("missing",text);Assert.DoesNotContain("not-json-private-error",text);
    }
    [Fact] public void UnknownValuesAndJsonPropertiesAreNotCopiedThrough()
    {
        var bytes=Encoding.UTF8.GetBytes("{\"code\":\"private-secret\",\"phase\":\"private-secret\",\"appVersion\":\"private-secret\",\"hresultHex\":\"private-secret\",\"runtimeStep\":\"private-secret\",\"exitCode\":-1073741795}");
        var text=Encoding.UTF8.GetString(ConnectionDiagnosticsPackage.SanitizeLog("startup-diagnostics.log",bytes));
        Assert.DoesNotContain("private-secret",text);Assert.Contains("unknown",text);Assert.Contains("-1073741795",text);
        Assert.Throws<InvalidDataException>(()=>ConnectionDiagnosticsPackage.SanitizeLog("metadata-resolver.json",bytes));
    }
    [Fact] public async Task CollectorLaunchOrTemporaryDirectoryFailureDoesNotDiscardTheOtherDiagnostics()
    {
        File.WriteAllText(FileAt("startup-error.log"),"{\"code\":\"PORT_IN_USE\"}");
        await ConnectionDiagnosticsPackage.ExportAsync(FileAt("result.zip"),_root,28950,new("1.0.22",2026102402),new UnavailableCollector());
        using var zip=ZipFile.OpenRead(FileAt("result.zip"));Assert.NotNull(zip.GetEntry("logs/startup-error.log"));
        using var reader=new StreamReader(zip.GetEntry("DiagnosticSummary.json")!.Open());var text=reader.ReadToEnd();Assert.Contains("unavailable",text);Assert.DoesNotContain("private-collector-error",text);
    }
    [Fact] public void Utf8BomLogsRemainReadableWithoutCopyingUnknownFields()
    {
        var bytes=new byte[]{0xef,0xbb,0xbf}.Concat(Encoding.UTF8.GetBytes("{\"code\":\"PORT_IN_USE\",\"token\":\"private-secret\"}")).ToArray();
        var text=Encoding.UTF8.GetString(ConnectionDiagnosticsPackage.SanitizeLog("startup-error.log",bytes));Assert.Contains("PORT_IN_USE",text);Assert.DoesNotContain("private-secret",text);
    }
    [Fact] public async Task CancelledExportPreservesAnExistingDestination()
    {
        File.WriteAllText(FileAt("result.zip"),"keep previous archive");using var cancelled=new CancellationTokenSource();cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>ConnectionDiagnosticsPackage.ExportAsync(FileAt("result.zip"),_root,28950,new("1.0.22",2026102402),new Collector(),cancelled.Token));
        Assert.Equal("keep previous archive",File.ReadAllText(FileAt("result.zip")));Assert.Empty(Directory.GetFiles(_root,"*.tmp"));
    }
    [Fact] public async Task LinkedLogIsNotFollowed()
    {
        File.WriteAllText(FileAt("private.json"),"{\"code\":\"PORT_IN_USE\"}");File.CreateSymbolicLink(FileAt("startup-error.log"),FileAt("private.json"));
        await ConnectionDiagnosticsPackage.ExportAsync(FileAt("result.zip"),_root,28950,new("1.0.22",2026102402),new Collector());
        using var zip=ZipFile.OpenRead(FileAt("result.zip"));Assert.Null(zip.GetEntry("logs/startup-error.log"));
    }
}
