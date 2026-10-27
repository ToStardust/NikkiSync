using System.Windows;
using System.IO;
using System.Text.Json;
using NikkiSync.WindowsShell.Services;
using Microsoft.Web.WebView2.Core;

namespace NikkiSync.WindowsShell;

public partial class App : System.Windows.Application
{
    private SingleInstanceCoordinator? _singleInstance;
    private MainWindow? _mainWindow;
    private bool _activationPending;

    protected override async void OnStartup(StartupEventArgs e)
    {
        if(e.Args.Length>0&&e.Args[0]=="--recycle-batch")
        {
            Shutdown(e.Args.Length==3?RecycleOnly.RunBatch(e.Args[1],e.Args[2]):3);return;
        }
        if(e.Args.Length>0&&e.Args[0]=="--organizer-preview")
        {
            Shutdown(e.Args.Length==3?OrganizerPreview.Run(e.Args[1],e.Args[2]):3);return;
        }
        if(e.Args.Length>0&&e.Args[0]=="--recycle-file")
        {
            Shutdown(e.Args.Length==4?RecycleOnly.Run(e.Args[1],e.Args[2],e.Args[3]):3);return;
        }
          if(e.Args.Length>0&&e.Args[0]=="--repair-network")
          {
              Shutdown(e.Args.Length==5?WindowsNetworkConflict.RunHelper(e.Args[1],e.Args[2],e.Args[3],e.Args[4]):3);return;
          }
        if(e.Args.Length>0 && e.Args[0]=="--authorize-network")
        {
            // The elevated short-lived helper never starts the UI, scanner, updater or single-instance activation.
            var result=e.Args.Length==4?NetworkAuthorization.RunHelper(e.Args[1],e.Args[2],e.Args[3]):3;
            Shutdown(result);return;
        }
        if (e.Args.Length == 2 && e.Args[0] == "--release-info")
        {
            File.WriteAllText(Path.GetFullPath(e.Args[1]), JsonSerializer.Serialize(new { version = DesktopRelease.Version, build = DesktopRelease.Build }));
            Shutdown(0); return;
        }
        if (e.Args.Length == 2 && e.Args[0] == "--apply-update")
        {
            try { await UpdateInstaller.ApplyAsync(e.Args[1]); Shutdown(0); }
            catch { System.Windows.MessageBox.Show("自动更新未完成。原程序和用户数据已保留；请重新打开原 EXE，必要时手动下载完整包。", "大喵相机助手"); Shutdown(1); }
            return;
        }
        // Full boot acceptance bypasses the normal single-instance activation only
        // with explicitly isolated data and loopback ports; never scan into the real DB.
        if (e.Args.Length == 3 && e.Args[0] == "--verify-startup")
        {
            var directory = Path.GetFullPath(e.Args[1]);
            var privateData = Path.Combine(directory, "localdata");
            if (!string.Equals(Path.GetFullPath(Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? ""), privateData, StringComparison.OrdinalIgnoreCase)
                || !int.TryParse(e.Args[2], out var port) || port is < 1 or > 65535 || port == 28950
                || Environment.GetEnvironmentVariable("NIKKISYNC_BIND") != "127.0.0.1"
                || Environment.GetEnvironmentVariable("NIKKISYNC_PORT") != "0"
                || Environment.GetEnvironmentVariable("NIKKISYNC_MDNS") != "0")
            { Shutdown(2); return; }
            base.OnStartup(e);
            var verificationWindow = new MainWindow(port, directory) { Left = -10000, Top = -10000, ShowInTaskbar = false, WindowStartupLocation = WindowStartupLocation.Manual };
            MainWindow = verificationWindow;
            verificationWindow.Show();
            var ok = await verificationWindow.StartupCompleted;
            var startupFailureDiagnosticExportVerified = !ok && await verificationWindow.VerifyStartupFailureDiagnosticsAsync();
            if(ok)ok=await verificationWindow.VerifyFirstUseGuideAsync();
            if(ok)ok=await verificationWindow.VerifyExtraScanDirectoriesAsync();
            if(ok) ok=await verificationWindow.VerifyNetworkAuthorizationAsync();
            if(ok) ok=await verificationWindow.VerifyOrganizerAsync();
            if(ok) ok=await verificationWindow.VerifyConnectionDiagnosticsAsync();
            if (ok) ok = await verificationWindow.VerifyAboutAsync();
            if(ok&&Environment.GetEnvironmentVariable("NIKKISYNC_VERIFY_SERVICE_LOSS")=="1")ok=await verificationWindow.VerifyServiceLossAsync();
            File.WriteAllText(Path.Combine(directory, "startup-verification.json"), JsonSerializer.Serialize(new
            {
                ok, startupFailureDiagnosticExportVerified,
                stages = verificationWindow.StartupTimings,
                browserVisible = verificationWindow.ControlPage.Visibility == Visibility.Visible,
                loaderHidden = verificationWindow.StartupPanel.Visibility == Visibility.Collapsed,
                privateData = true
            }));
            await verificationWindow.ExitAsync();
            return;
        }
        // Build verification: exercise the actual embedded payload without opening a
        // browser, scanning the game, touching the user's database or activating an old app.
        if (e.Args.Length == 2 && (e.Args[0] == "--verify-package" || e.Args[0] == "--verify-webview"))
        {
            var directory = Path.GetFullPath(e.Args[1]);
            Window? verificationWindow = null;
            var preparationStep = PayloadPreparationStep.ReadManifest;
            try
            {
                var runtime = RuntimePayload.Prepare(Path.Combine(directory, "runtime-cache"), step: value => preparationStep = value);
                Directory.CreateDirectory(directory);
                string? browserVersion = null;
                if (e.Args[0] == "--verify-webview")
                {
                    var webview = new Microsoft.Web.WebView2.Wpf.WebView2();
                    verificationWindow = new Window { Width = 32, Height = 32, Left = -10000, Top = -10000, ShowInTaskbar = false, Content = webview };
                    verificationWindow.Show();
                    var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(directory, "webview2"));
                    await webview.EnsureCoreWebView2Async(environment);
                    browserVersion = webview.CoreWebView2.Environment.BrowserVersionString;
                    var script = await webview.ExecuteScriptAsync("JSON.stringify({ready:1+1===2})");
                    if (!script.Contains("ready")) throw new InvalidDataException("WebView script engine did not respond.");
                    webview.Dispose();
                }
                File.WriteAllText(Path.Combine(directory, "verification.json"), JsonSerializer.Serialize(new { ok = true, runtimeDirectory = runtime, payloadEmbedded = System.Reflection.Assembly.GetExecutingAssembly().GetManifestResourceNames().Contains(RuntimePayload.ArchiveResource), browserVersion }));
                verificationWindow?.Close();
                Shutdown(0);
            }
            catch (Exception error)
            {
                Directory.CreateDirectory(directory);
                File.WriteAllText(Path.Combine(directory, "verification.json"), JsonSerializer.Serialize(new {
                    ok = false, error = StartupFailure.FromException(error).Code,
                    exceptionKind = StartupDiagnostics.ExceptionKind(error),
                    hresultHex = $"0x{unchecked((uint)error.HResult):X8}", runtimeStep = preparationStep.ToString()
                }));
                verificationWindow?.Close();
                Shutdown(1);
            }
            return;
        }
        _singleInstance = new SingleInstanceCoordinator();
        _singleInstance.ActivationRequested += OnActivationRequested;

        if (!_singleInstance.TryAcquirePrimary())
        {
            _singleInstance.SignalExistingInstance();
            Shutdown();
            return;
        }

        base.OnStartup(e);
        _mainWindow = new MainWindow();
        MainWindow = _mainWindow;
        _mainWindow.Show();
        if (_activationPending) ActivateMainWindow();
        if (e.Args.Length == 2 && e.Args[0] == "--update-health")
        {
            var ready = await _mainWindow.StartupCompleted;
            try { UpdateInstaller.ReportHealth(e.Args[1], ready); }
            catch { await _mainWindow.ExitAsync(); }
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _singleInstance?.Dispose();
        _singleInstance = null;
        base.OnExit(e);
    }

    private void OnActivationRequested(object? sender, EventArgs e)
    {
        if (Dispatcher.HasShutdownStarted || Dispatcher.HasShutdownFinished) return;
        Dispatcher.BeginInvoke(new Action(ActivateMainWindow));
    }

    private void ActivateMainWindow()
    {
        if (_mainWindow is null)
        {
            _activationPending = true;
            return;
        }

        _activationPending = false;
        _mainWindow.ActivateFromSecondaryInstance();
    }
}
