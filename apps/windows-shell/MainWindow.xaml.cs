using System.Text.Json;
using System.IO;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell;

public partial class MainWindow : Window
{
    private readonly DesktopWindowLifecycle _lifecycle = new();
    private readonly ServiceProcessHost _service;
    private readonly HttpHealthClient _health = HttpHealthClient.CreateLoopback();
    private readonly AutostartService _autostart = new(new RegistryRunEntryStore());
    private readonly TrayService _tray = new();
    private Uri? _controlOrigin;
    private WebViewPowerController? _viewPower;
    private StartupPageGate? _pageGate;
    private string? _runtimeDirectory;
    private string? _gameRoot;
    private string _startupPhase = "runtime";
    private PayloadPreparationStep _runtimeStep = PayloadPreparationStep.ReadManifest;
    private readonly object _startupContent;
    private readonly RetryableStartupInitialization _browserInitialization = new();
    private readonly CancellationTokenSource _startupCancellation = new();
    private readonly System.Windows.Threading.DispatcherTimer _startupTimer = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly Stopwatch _startupWatch = new();
    private readonly string? _verificationDirectory;
    private readonly TaskCompletionSource<bool> _startupCompleted = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public Task<bool> StartupCompleted => _startupCompleted.Task;
    public Dictionary<string, double> StartupTimings { get; } = new();
    private VerifiedUpdate? _availableUpdate;
    private UpdateWindow? _updateWindow;
    private bool _networkAuthorizationBusy;
    private readonly TemporaryHotspot _temporaryHotspot=new();
    private bool _networkRuleAuthorized,_networkRuleOwned;
    private int _networkAuthorizationRevision;
    private bool _extraFolderPickerOpen;
    private bool _diagnosticExportBusy;
    private string? _autostartMessage;
    private int? _lastNetworkRepairCode;
    private string? _lastNetworkRepairOperation;
    private string? _lastNetworkRepairState;

    public MainWindow(int desktopPort = 28950, string? verificationDirectory = null)
    {
        _service = new(new ProcessServiceFactory(), _health, desktopPort: desktopPort);
        _verificationDirectory = verificationDirectory;
        InitializeComponent();
        _startupContent = MainSurface.Content;
        _startupTimer.Tick += (_, _) => StartupElapsed.Text = $"已等待 {(int)_startupWatch.Elapsed.TotalSeconds} 秒";
        ControlPage.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 248, 240);
        Loaded += OnLoaded;
        Closing += OnClosing;
        IsVisibleChanged += async (_, _) => await UpdateViewPowerAsync();
        StateChanged += async (_, _) => await UpdateViewPowerAsync();
        _tray.ShowRequested += (_, _) => ActivateFromSecondaryInstance();
        _tray.ExitRequested += async (_, _) => await ExitAsync();
    }

    public void ActivateFromSecondaryInstance()
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.BeginInvoke(new Action(ActivateFromSecondaryInstance));
            return;
        }

        Show();
        WindowState = WindowState.Normal;
        Activate();
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        // Verification and short-lived update/network helpers must never change
        // the real user's startup entry. Helpers do not create this window.
        if (_verificationDirectory is null)
        {
            try { _autostart.RefreshEnabledPath(Environment.ProcessPath ?? throw new InvalidOperationException()); }
            catch { _autostartMessage = "自启动路径未能更新，请在启动偏好中重新开启；若仍失败，请检查 Windows 启动应用设置。"; }
        }
        _startupWatch.Restart();
        StartupTimings.Clear();
        _runtimeStep = PayloadPreparationStep.ReadManifest;
        _startupTimer.Start();
        try
        {
            _startupPhase = "runtime";
            RecordStartupTimings("starting");
            StartupText.Text = "1 / 4 · 检查并准备运行文件…";
            StartupProgress.IsIndeterminate = false;
            var lastProgress = DateTime.MinValue;
            _runtimeDirectory = await Task.Run(() => RuntimePayload.Prepare(_verificationDirectory is null ? null : Path.Combine(_verificationDirectory, "runtime-cache"), progress: value =>
            {
                if (value < 1 && DateTime.UtcNow - lastProgress < TimeSpan.FromMilliseconds(100)) return;
                lastProgress = DateTime.UtcNow;
                Dispatcher.BeginInvoke(new Action(() => StartupProgress.Value = value * 100));
            }, step: value => _runtimeStep = value));
            _startupCancellation.Token.ThrowIfCancellationRequested();
            StartupTimings["runtimeReadyMs"] = _startupWatch.Elapsed.TotalMilliseconds;
            StartupText.Text = "2 / 4 · 准备界面显示组件…";
            _startupPhase = "webview";
            RecordStartupTimings("starting");
            StartupProgress.IsIndeterminate = true;
            // Windows special-folder lookup does not honor a diagnostic LOCALAPPDATA override.
            await _browserInitialization.EnsureAsync(async () =>
            {
                var environment = await CoreWebView2Environment.CreateAsync(null, _verificationDirectory is null ? Path.Combine(RuntimePayload.UserDirectory, "webview2") : Path.Combine(_verificationDirectory, "localdata", "NikkiSync", "webview2"));
                await ControlPage.EnsureCoreWebView2Async(environment);
            });
            _startupCancellation.Token.ThrowIfCancellationRequested();
            StartupTimings["browserReadyMs"] = _startupWatch.Elapsed.TotalMilliseconds;
            StartupText.Text = "3 / 4 · 正在同步相册并启动连接服务…";
            _startupPhase = "service";
            RecordStartupTimings("starting");
            if (_verificationDirectory is not null)
            {
                await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.Render);
                var surface = (FrameworkElement)Content;
                var snapshot = new System.Windows.Media.Imaging.RenderTargetBitmap((int)surface.ActualWidth, (int)surface.ActualHeight, 96, 96, System.Windows.Media.PixelFormats.Pbgra32);
                snapshot.Render(surface);
                var encoder = new System.Windows.Media.Imaging.PngBitmapEncoder();
                encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(snapshot));
                using var image = File.Create(Path.Combine(_verificationDirectory, "startup-screen.png"));
                encoder.Save(image);
            }
            var endpoint = await _service.StartAsync(_runtimeDirectory, _startupCancellation.Token, _gameRoot,
                new Progress<ScanStartupProgress>(work => StartupText.Text = work.Stage switch
                {
                    "scan-index" => $"3 / 4 · 正在建立相册索引：已处理 {work.AssetsProcessed:N0} 项…",
                    "scan-watch" => "3 / 4 · 正在完成扫描并建立相册监听…",
                    _ => $"3 / 4 · 正在扫描相册：已检查 {work.FilesCompleted:N0} 个文件，已读取 {work.BytesRead / 1073741824d:F2} GB…"
                }));
            StartupTimings["serviceReadyMs"] = _startupWatch.Elapsed.TotalMilliseconds;
            _controlOrigin = new Uri(endpoint.GetLeftPart(UriPartial.Authority));
            _pageGate = new StartupPageGate(new Uri(_controlOrigin, "/"));
            _viewPower = new WebViewPowerController(
                async () =>
                {
                    // Let the WPF wrapper propagate Visibility to the native controller.
                    await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.Background);
                    return await ControlPage.CoreWebView2.TrySuspendAsync();
                },
                active => ControlPage.Visibility = _pageGate.ShouldShowBrowser(active) ? Visibility.Visible : Visibility.Collapsed,
                () => ControlPage.CoreWebView2.Resume());
            ControlPage.CoreWebView2.NavigationStarting += OnNavigationStarting;
            ControlPage.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            StartupText.Text = "4 / 4 · 正在打开电脑相册…";
            _startupPhase = "dashboard";
            RecordStartupTimings("starting");
            await WaitForDashboardAsync(_startupCancellation.Token);
            _startupTimer.Stop();
            StartupPanel.Visibility = Visibility.Collapsed;
            await UpdateViewPowerAsync();
            StartupTimings["dashboardReadyMs"] = _startupWatch.Elapsed.TotalMilliseconds;
            RecordStartupTimings("ready");
            _startupCompleted.TrySetResult(true);
            if (_verificationDirectory is null) _ = CheckForUpdatesQuietlyAsync();
        }
        catch (OperationCanceledException) when (_startupCancellation.IsCancellationRequested)
        { _startupTimer.Stop(); RecordStartupTimings("cancelled"); _startupCompleted.TrySetResult(false); }
        catch (Exception error)
        {
            _startupTimer.Stop();
            RecordStartupTimings("failed");
            _viewPower?.Stop();
            ControlPage.Visibility = Visibility.Collapsed;
            await _service.StopAsync();
            var panel = new StackPanel { Margin = new Thickness(32), Background = Background };
            var missingBrowser = error is WebView2RuntimeNotFoundException;
            var failure = missingBrowser ? StartupFailure.Create("WEBVIEW_MISSING") : StartupFailure.FromException(error);
            var diagnosticsDirectory = _verificationDirectory is null ? RuntimePayload.UserDirectory : Path.Combine(_verificationDirectory, "localdata", "NikkiSync");
            var log = StartupDiagnostics.Write(diagnosticsDirectory, _startupPhase, failure, error, _runtimeStep);
            panel.Children.Add(new TextBlock { Text = "NikkiSync 暂时无法启动", FontSize = 22, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 0, 0, 18) });
            panel.Children.Add(new TextBlock { Text = failure.Message, TextWrapping = TextWrapping.Wrap });
            System.Windows.Controls.Button? choose = null;
            if (failure.Code == "GAME_NOT_FOUND")
            {
                choose = new System.Windows.Controls.Button { Content = "备选：手动选择安装文件夹", Margin = new Thickness(0, 12, 0, 0), Padding = new Thickness(14, 8, 14, 8) };
                choose.Click += (_, _) =>
                {
                    var dialog = new Microsoft.Win32.OpenFolderDialog { Title = "选择《无限暖暖》游戏或启动器的安装文件夹（也支持 X6Game）" };
                    if (dialog.ShowDialog(this) != true) return;
                    _gameRoot = dialog.FolderName;
                    RetryStartup();
                };
            }
            if (missingBrowser)
            {
                var download = new System.Windows.Controls.Button { Content = "打开 WebView2 官方安装页面", Margin = new Thickness(0, 20, 0, 0), Padding = new Thickness(14, 8, 14, 8) };
                download.Click += (_, _) => Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/") { UseShellExecute = true });
                panel.Children.Add(download);
            }
            var retry = new System.Windows.Controls.Button { Content = failure.Code == "GAME_NOT_FOUND" ? "重新自动检测" : "重试启动", Margin = new Thickness(0, 12, 0, 0), Padding = new Thickness(14, 8, 14, 8) };
            retry.Click += (_, _) => { _gameRoot = null; RetryStartup(); };
            panel.Children.Add(retry);
            var updates = new System.Windows.Controls.Button { Content = "检查更新", Margin = new Thickness(0, 12, 0, 0), Padding = new Thickness(14, 8, 14, 8) };
            updates.Click += (_, _) => OpenUpdates();
            panel.Children.Add(updates);
            if (choose is not null) panel.Children.Add(choose);
            if (log is not null)
            {
                var openLogs = new System.Windows.Controls.Button { Content = "打开日志文件夹", Margin = new Thickness(0, 12, 0, 0), Padding = new Thickness(14, 8, 14, 8) };
                openLogs.Click += (_, _) => Process.Start(new ProcessStartInfo(diagnosticsDirectory) { UseShellExecute = true });
                panel.Children.Add(openLogs);
                panel.Children.Add(new TextBlock { Text = "反馈 startup-diagnostics.log、game-discovery.log、startup-timings.json 和 startup-service-timings.json；日志不包含照片、个人路径、配对码或密钥。", TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 16, 0, 0) });
            }
            else panel.Children.Add(new TextBlock { Text = "日志无法写入，请截取上方错误代码反馈。", Margin = new Thickness(0, 16, 0, 0), TextWrapping = TextWrapping.Wrap });
            MainSurface.Content = panel;
            if (_verificationDirectory is not null)
            {
                await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.Render);
                var surface = (FrameworkElement)Content;
                var snapshot = new System.Windows.Media.Imaging.RenderTargetBitmap(Math.Max(1, (int)surface.ActualWidth), Math.Max(1, (int)surface.ActualHeight), 96, 96, System.Windows.Media.PixelFormats.Pbgra32);
                snapshot.Render(surface);
                var encoder = new System.Windows.Media.Imaging.PngBitmapEncoder();
                encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(snapshot));
                using var image = File.Create(Path.Combine(_verificationDirectory, "startup-error-screen.png"));
                encoder.Save(image);
            }
            _startupCompleted.TrySetResult(false);
        }
    }

    private void RetryStartup()
    {
        MainSurface.Content = _startupContent;
        StartupPanel.Visibility = Visibility.Visible;
        OnLoaded(this, new RoutedEventArgs());
    }

    private void RecordStartupTimings(string status) => StartupDiagnostics.WriteTimings(
        _verificationDirectory is null ? RuntimePayload.UserDirectory : Path.Combine(_verificationDirectory, "localdata", "NikkiSync"),
        _startupPhase, status, _startupWatch.Elapsed.TotalMilliseconds, StartupTimings);

    private async Task WaitForDashboardAsync(CancellationToken cancellationToken)
    {
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async void Completed(object? sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (_pageGate is null || !_pageGate.IsDashboard(ControlPage.CoreWebView2.Source)) return;
            try
            {
                // Checking DOM readiness works even when the native HWND is hidden.
                // requestAnimationFrame would stall for a hidden/minimized startup.
                var present = e.IsSuccess && await ControlPage.ExecuteScriptAsync("document.readyState === 'complete' && !!document.querySelector('.app-shell main #desktop-title')") == "true";
                cancellationToken.ThrowIfCancellationRequested();
                if (_pageGate.CompleteNavigation(ControlPage.CoreWebView2.Source, e.IsSuccess, present)) ready.TrySetResult();
            }
            catch (Exception error) { ready.TrySetException(error); }
        }
        ControlPage.CoreWebView2.NavigationCompleted += Completed;
        try
        {
            ControlPage.Source = new Uri(_controlOrigin!, "/");
            await ready.Task.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken);
        }
        finally { ControlPage.CoreWebView2.NavigationCompleted -= Completed; }
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (_controlOrigin is null || !Uri.TryCreate(e.Uri, UriKind.Absolute, out var target) || target.GetLeftPart(UriPartial.Authority) != _controlOrigin.GetLeftPart(UriPartial.Authority)) e.Cancel = true;
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (_controlOrigin is null || !Uri.TryCreate(e.Source, UriKind.Absolute, out var source) || source.GetLeftPart(UriPartial.Authority) != _controlOrigin.GetLeftPart(UriPartial.Authority)) return;
        using var message = JsonDocument.Parse(e.WebMessageAsJson);
        if (!message.RootElement.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String) return;
        if(type.GetString() is "startHotspot" or "stopHotspot")_=ChangeHotspotAsync(type.GetString()=="stopHotspot");
        if(type.GetString()=="hotspotSettings")try{Process.Start(new ProcessStartInfo("ms-settings:network-mobilehotspot"){UseShellExecute=true});}catch{}
        if (type.GetString() == "getAutostart")
        {
            ReplyAutostart();
            ReplyPackageInfo();
            _=RefreshNetworkAuthorizationAsync();
            _=RefreshNetworkConflictsAsync();
        }
        if (type.GetString() == "checkUpdates") OpenUpdates();
        if(type.GetString() is "authorizeNetwork" or "revokeNetwork") _=AuthorizeNetworkAsync(type.GetString()=="revokeNetwork");
        if(type.GetString()=="checkNetworkConflicts")_=RefreshNetworkConflictsAsync();
        if(type.GetString()=="exportConnectionDiagnostics")_=ExportConnectionDiagnosticsAsync();
        if(type.GetString() is "repairNetworkConflicts" or "restoreNetworkConflicts")_=RepairNetworkConflictsAsync(type.GetString()=="restoreNetworkConflicts");
        if(type.GetString() is "chooseExtraScanDirectory" or "chooseSpinningMomoDirectory")ChooseExtraScanDirectory(type.GetString()=="chooseSpinningMomoDirectory");
        if (type.GetString() == "openProjectLink" && message.RootElement.TryGetProperty("project", out var project) && project.ValueKind == JsonValueKind.String
            && DesktopProjectLinks.Resolve(project.GetString()) is { } projectUrl)
        {
            try { Process.Start(new ProcessStartInfo(projectUrl) { UseShellExecute = true }); }
            catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
            { System.Windows.MessageBox.Show(this, "请在浏览器中打开：\n" + projectUrl, "项目仓库"); }
        }
        if (type.GetString() == "saveAndroidInstaller") SaveAndroidInstaller();
        if (type.GetString() == "setAutostart" && message.RootElement.TryGetProperty("enabled", out var enabled) && (enabled.ValueKind is JsonValueKind.True or JsonValueKind.False))
        {
            try
            {
                if (_verificationDirectory is null)
                    _autostart.SetEnabled(enabled.GetBoolean(), Environment.ProcessPath ?? throw new InvalidOperationException());
                _autostartMessage = null;
            }
            catch { _autostartMessage = "未能保存自启动设置，请检查 Windows 启动应用设置后重试。"; }
            ReplyAutostart();
        }
    }

    private void ReplyAutostart()
    {
        var enabled = false;
        try { enabled = _verificationDirectory is null && Environment.ProcessPath is { } path && _autostart.IsEnabledFor(path); }
        catch { _autostartMessage = "暂时无法读取自启动设置，请稍后重试。"; }
        ControlPage.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "autostart", enabled, message = _autostartMessage }));
    }
    private async Task ExportConnectionDiagnosticsAsync()
    {
        if(_diagnosticExportBusy||_startupCancellation.IsCancellationRequested)return;
        _diagnosticExportBusy=true;
        void Reply(bool busy,string message){if(!_startupCancellation.IsCancellationRequested)ControlPage.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{type="connectionDiagnostics",busy,message}));}
        try
        {
            string destination;
            if(_verificationDirectory is not null)destination=Path.Combine(_verificationDirectory,"ConnectionDiagnostics.zip");
            else
            {
                var dialog=new Microsoft.Win32.SaveFileDialog{FileName="MomoCamera-连接诊断-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+".zip",DefaultExt=".zip",AddExtension=true,Filter="连接诊断压缩包 (*.zip)|*.zip",Title="导出连接诊断包"};
                if(dialog.ShowDialog(this)!=true){Reply(false,"已取消导出，需要时可再次点击。");return;}
                destination=dialog.FileName;
            }
            Reply(true,"正在检查电脑连接并整理诊断包，请稍候…");
            var data=_verificationDirectory is null?RuntimePayload.UserDirectory:Path.Combine(_verificationDirectory,"localdata","NikkiSync");
            await ConnectionDiagnosticsPackage.ExportAsync(destination,data,_controlOrigin?.Port??28950,new(DesktopRelease.Version,DesktopRelease.Build,_lastNetworkRepairCode,_lastNetworkRepairOperation,_lastNetworkRepairState),new ConnectionDiagnosticsCollector(),_startupCancellation.Token);
            Reply(false,"诊断包已保存。请将压缩包发给开发者，并附手机端的报错截图。");
        }
        catch(OperationCanceledException){Reply(false,"导出已取消。");}
        catch(Exception error) when(error is IOException or InvalidDataException or UnauthorizedAccessException or System.ComponentModel.Win32Exception or System.Security.SecurityException){Reply(false,"诊断包未能保存，请换一个可写文件夹重试（DIAG-EXPORT）。");}
        finally{_diagnosticExportBusy=false;}
    }
    private async Task ChangeHotspotAsync(bool stop)
    {
        if(_verificationDirectory is not null){ControlPage.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{type="temporaryNetwork",busy=false,message="测试验收模式：不会改变网络。"}));return;}
        ControlPage.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{type="temporaryNetwork",busy=true,message="正在请求 Windows 处理热点…"}));
        var result=await _temporaryHotspot.ChangeAsync(stop);
        if(!_startupCancellation.IsCancellationRequested)ControlPage.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{type="temporaryNetwork",busy=false,message=result.Message,credentials=result.Credentials}));
    }
    private void ChooseExtraScanDirectory(bool spinningMomo)
    {
        if(_verificationDirectory is not null||_extraFolderPickerOpen)return;
        _extraFolderPickerOpen=true;
        try
        {
            var dialog=new Microsoft.Win32.OpenFolderDialog{Title=spinningMomo?"选择“旋转吧大喵 → 设置 → 输出目录”中配置的照片文件夹":"选择要加入共享相册的照片文件夹（随后可预览并确认）"};
            var spinning=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyVideos),"SpinningMomo");
            if(spinningMomo&&Directory.Exists(spinning))dialog.InitialDirectory=spinning;
            if(dialog.ShowDialog(this)!=true)return;
            ControlPage.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{type="extraScanDirectorySelected",path=dialog.FolderName}));
        }
        catch(Exception){ControlPage.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{type="extraScanDirectoryError",message="无法打开文件夹选择器，请关闭其他选择窗口后重试。"}));}
        finally{_extraFolderPickerOpen=false;}
    }
    private void ReplyNetworkAuthorization(bool busy,string message) => ControlPage.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new {type="networkAuthorization",busy,message,authorized=_networkRuleAuthorized,canRevoke=_networkRuleOwned}));

    private async Task<NetworkAuthorizationPlan> GetNetworkAuthorizationPlanAsync()
        =>(await GetNetworkConflictTargetAsync()).Plan;

    private async Task<(NetworkAuthorizationPlan Plan,string Host)> GetNetworkConflictTargetAsync()
    {
        if(_runtimeDirectory is null || _controlOrigin is null) throw new InvalidOperationException();
        using var http=new System.Net.Http.HttpClient(new System.Net.Http.HttpClientHandler{UseProxy=false,AllowAutoRedirect=false}){Timeout=TimeSpan.FromSeconds(3)};
        using var status=JsonDocument.Parse(await http.GetStringAsync(new Uri(_controlOrigin,"/api/status")));
        if(status.RootElement.GetProperty("service").GetString()!="ready") throw new InvalidOperationException();
        return (NetworkAuthorizationPlan.Create(Path.Combine(_runtimeDirectory,"runtime","NikkiSync-PC-service.exe"),status.RootElement.GetProperty("port").GetInt32()),status.RootElement.GetProperty("host").GetString()??"");
    }

    private async Task RefreshNetworkAuthorizationAsync()
    {
        if(_verificationDirectory is not null || _networkAuthorizationBusy) return;
        var revision=_networkAuthorizationRevision;
        try
        {
            var plan=await GetNetworkAuthorizationPlanAsync();
            var state=await Task.Run(()=>NetworkAuthorization.ReadRulePresence(plan));
            if(_startupCancellation.IsCancellationRequested || _networkAuthorizationBusy || revision!=_networkAuthorizationRevision) return;
            _networkRuleOwned=state?.Owned==true;
            _networkRuleAuthorized=_networkRuleOwned&&state?.Matches==true;
            ReplyNetworkAuthorization(false,_networkRuleAuthorized
                ?"已检测到本助手添加的本地网络权限。若仍连接失败，请反馈诊断报告；已有权限不等于网络必然可达。"
                :"这是可选的连接排障功能，已能正常连接时无需操作。连接失败时可点击授权本地网络访问。");
        }
        catch
        {
            if(!_startupCancellation.IsCancellationRequested && !_networkAuthorizationBusy && revision==_networkAuthorizationRevision)
                ReplyNetworkAuthorization(false,"暂时无法读取网络授权状态。已正常连接时无需操作；连接失败时仍可点击尝试授权。");
        }
    }

    private async Task AuthorizeNetworkAsync(bool remove)
    {
        if(_networkAuthorizationBusy) return;
        if(_verificationDirectory is not null) { ReplyNetworkAuthorization(false,"测试验收模式不修改网络权限。");return; }
        if(_runtimeDirectory is null || _controlOrigin is null) return;
        _networkAuthorizationBusy=true;
        _networkAuthorizationRevision++;
        ReplyNetworkAuthorization(true,remove?"正在撤销当前服务的授权，如出现 Windows 提示请选择“是”…":"正在设置本地网络权限，如出现 Windows 提示请选择“是”…");
        var feedback="网络授权未完成，请重试。";
        var stage="STATUS";
        try
        {
            var plan=await GetNetworkAuthorizationPlanAsync();
            stage="LAUNCH";
            using var helper=Process.Start(NetworkAuthorization.CreateElevationStartInfo(Environment.ProcessPath ?? throw new InvalidOperationException(),plan,remove))
                ?? throw new InvalidOperationException();
            stage="WAIT";
            await helper.WaitForExitAsync();
            feedback=NetworkAuthorization.ResultMessage(helper.ExitCode);
            if(helper.ExitCode is 0 or 8) _networkRuleAuthorized=_networkRuleOwned=true;
            if(helper.ExitCode==9) _networkRuleAuthorized=_networkRuleOwned=false;
        }
        catch(System.ComponentModel.Win32Exception error) when(error.NativeErrorCode==1223)
        { feedback="已取消 Windows 授权，网络权限未修改。需要时可再次点击。"; }
        catch { feedback=$"网络授权未完成（NET-AUTH-{stage}）。请确认助手仍在运行，并反馈此代码和诊断报告。"; }
        finally
        {
            _networkAuthorizationBusy=false;
            if(!_startupCancellation.IsCancellationRequested) ReplyNetworkAuthorization(false,feedback);
            _=RefreshNetworkConflictsAsync();
        }
    }
    private void ReplyNetworkConflicts(bool busy,string message,bool canRepair=true)=>ControlPage.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{type="networkConflicts",busy,message,canRepair}));
    private async Task RefreshNetworkConflictsAsync(string prefix="")
    {
        if(_networkAuthorizationBusy||_startupCancellation.IsCancellationRequested)return;
        if(_verificationDirectory is not null){ReplyNetworkConflicts(false,"测试验收模式不修改网络权限。");return;}
        var revision=_networkAuthorizationRevision;
        try
        {
            var target=await GetNetworkConflictTargetAsync();
            var state=await Task.Run(()=>WindowsNetworkConflict.Inspect(target.Plan,target.Host));
            if(_networkAuthorizationBusy||revision!=_networkAuthorizationRevision||_startupCancellation.IsCancellationRequested)return;
            var profile=state.Profile switch{2=>"专用",4=>"公用",1=>"域网络",_=>"未知"};
            var text=state.Profile is 2 or 4?$"当前连接使用{profile}网络。检测到 {state.Conflicts} 条当前后台的冲突阻止，其中 {state.Repairable} 条可自动处理。":"无法确认当前连接的网络类型，或这是受管理的域网络；未修改规则，请重新检查或反馈诊断报告。";
            if(state.Profile is 2 or 4&&!state.PolicyAllowsChange)text+=" 电脑安全策略限制修改，请联系管理员。";
            ReplyNetworkConflicts(false,prefix+(prefix.Length>0?" ":"")+text,state.Profile is 2 or 4&&state.PolicyAllowsChange);
        }
        catch{if(!_startupCancellation.IsCancellationRequested&&!_networkAuthorizationBusy&&revision==_networkAuthorizationRevision)ReplyNetworkConflicts(false,prefix+" 暂时无法读取冲突规则，可重新检查或反馈诊断报告。",true);}
    }
    private async Task RepairNetworkConflictsAsync(bool restore)
    {
        if(_networkAuthorizationBusy)return;
        if(_verificationDirectory is not null){ReplyNetworkConflicts(false,"测试验收模式不修改网络权限。");return;}
        _networkAuthorizationBusy=true;_networkAuthorizationRevision++;
        _lastNetworkRepairOperation=restore?"restore":"repair";_lastNetworkRepairCode=null;_lastNetworkRepairState="running";
        ReplyNetworkAuthorization(true,"正在处理连接权限，如出现 Windows 提示请选择“是”…");
        ReplyNetworkConflicts(true,restore?"正在恢复本次修复前的规则…":"正在检查并处理当前连接的冲突，如出现 Windows 提示请选择“是”…");
        string feedback;
        try
        {
            var target=await GetNetworkConflictTargetAsync();
            using var helper=Process.Start(WindowsNetworkConflict.Elevation(Environment.ProcessPath??throw new InvalidOperationException(),target.Plan,target.Host,restore))??throw new InvalidOperationException();
            await helper.WaitForExitAsync();_lastNetworkRepairCode=helper.ExitCode;_lastNetworkRepairState="completed";feedback=WindowsNetworkConflict.ResultMessage(helper.ExitCode);
        }
        catch(System.ComponentModel.Win32Exception error) when(error.NativeErrorCode==1223){_lastNetworkRepairState="cancelled";_lastNetworkRepairCode=1223;feedback="已取消 Windows 授权，冲突规则未修改。需要时可再次点击。";}
        catch{_lastNetworkRepairState="launch-failed";feedback="连接权限处理未完成，请重试并反馈 NET-REPAIR-LAUNCH。";}
        finally{_networkAuthorizationBusy=false;}
        if(!_startupCancellation.IsCancellationRequested){await RefreshNetworkAuthorizationAsync();await RefreshNetworkConflictsAsync(feedback);}
    }
    private void ReplyPackageInfo() => ControlPage.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new {
        type = "packageInfo", version = DesktopRelease.Version, build = DesktopRelease.Build,
        hasAndroidInstaller = AndroidInstallerPath is { } path && File.Exists(path), availableUpdateVersion = _availableUpdate?.Manifest.Version, availableUpdateBuild = _availableUpdate?.Manifest.Build
    }));

    private string? AndroidInstallerPath => _runtimeDirectory is null ? null : Path.Combine(_runtimeDirectory, "runtime", "NikkiSync-Android.apk");
    private void SaveAndroidInstaller()
    {
        if (AndroidInstallerPath is not { } source || !File.Exists(source)) return;
        var dialog = new Microsoft.Win32.SaveFileDialog { FileName = "NikkiSync-Android.apk", Filter = "安卓安装包 (*.apk)|*.apk", Title = "导出安卓安装包" };
        if (dialog.ShowDialog(this) != true) return;
        try { File.Copy(source, dialog.FileName, true); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        { System.Windows.MessageBox.Show(this, "无法保存安装包：" + error.Message, "NikkiSync"); }
    }

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        _lifecycle.OnWindowClosing();
        if (_lifecycle.HideWindow) { e.Cancel = true; Hide(); }
    }

    public async Task ExitAsync()
    {
        await _temporaryHotspot.ChangeAsync(true);
        _lifecycle.OnExplicitExit();
        _startupCancellation.Cancel();
        _startupTimer.Stop();
        _viewPower?.Stop();
        _tray.Dispose();
        await _service.StopAsync();
        _health.Dispose();
        ControlPage.Dispose();
        System.Windows.Application.Current.Shutdown();
    }

    private void OpenUpdates()
    {
        if (_updateWindow is not null) { _updateWindow.Activate(); return; }
        _updateWindow = new UpdateWindow(this, _availableUpdate);
        _updateWindow.Closed += (_, _) => _updateWindow = null;
        _updateWindow.Show();
    }

    private async Task CheckForUpdatesQuietlyAsync()
    {
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(_startupCancellation.Token);
            timeout.CancelAfter(TimeSpan.FromSeconds(35));
            using var http = new UpdateHttp();
            _availableUpdate = await new DesktopUpdateSource(http, DesktopRelease.CreateVerifier(), DesktopRelease.Build).CheckAsync(UpdateWindow.ReadSource(), timeout.Token);
            if (!_startupCancellation.IsCancellationRequested) ReplyPackageInfo();
        }
        catch { /* Offline startup remains usable; manual update check displays feedback. */ }
    }

    private Task UpdateViewPowerAsync() => _viewPower?.SetActiveAsync(IsVisible && WindowState != WindowState.Minimized) ?? Task.CompletedTask;

    // Only the existing isolated startup-verification mode calls this. No external links or updates
    // are opened: exercise the delivered WebView page and native version-message bridge, then capture it.
    public async Task<bool> VerifyAboutAsync()
    {
        if (_verificationDirectory is null || _controlOrigin is null) return false;
        ReplyPackageInfo();
        for (var attempt = 0; attempt < 40; attempt++)
        {
            var json = await ControlPage.CoreWebView2.ExecuteScriptAsync(@"(()=>{
                document.querySelector('[data-view=about]')?.click();
                return {title:document.querySelector('#desktop-title')?.textContent,
                    visible:document.querySelector('[data-page=about]')?.hidden===false,
                    version:document.querySelector('#desktop-version')?.textContent,
                    updateEnabled:document.querySelector('#check-updates')?.disabled===false,
                    repositories:[...document.querySelectorAll('[data-project]')].map(link=>link.href)};
            })()");
            using var state = JsonDocument.Parse(json);
            var value = state.RootElement;
            if (value.ValueKind == JsonValueKind.Object && value.TryGetProperty("version", out var version)
                && version.GetString() is { } label && label.Contains(DesktopRelease.Version) && label.Contains(DesktopRelease.Build.ToString()))
            {
                File.WriteAllText(Path.Combine(_verificationDirectory, "about-verification.json"), json);
                var links = value.GetProperty("repositories").EnumerateArray().Select(link => link.GetString()).ToHashSet();
                var ok = value.GetProperty("title").GetString() == "关于" && value.GetProperty("visible").GetBoolean()
                    && value.GetProperty("updateEnabled").GetBoolean()
                    && new[] { "momo", "nikkiGallery", "releases", "downloads" }.All(name => links.Contains(DesktopProjectLinks.Resolve(name)));
                await Task.Delay(150);
                using var image = File.Create(Path.Combine(_verificationDirectory, "about-screen.png"));
                await ControlPage.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, image);
                return ok;
            }
            await Task.Delay(50);
        }
        return false;
    }

    public async Task<bool> VerifyFirstUseGuideAsync()
    {
        if(_verificationDirectory is null)return false;
        await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-view=connect]').click();document.querySelector('#android-first-pairing')?.setAttribute('hidden','');document.querySelector('#android-paired').hidden=false;window.scrollTo(0,0);");
        for(var attempt=0;attempt<60;attempt++)
        {
            var ready=await ControlPage.CoreWebView2.ExecuteScriptAsync("!document.querySelector('#android-installer').hidden");
            if(ready=="true")break;
            await Task.Delay(50);
        }
        var home=await ControlPage.CoreWebView2.ExecuteScriptAsync(@"(()=>({
            guideVisible:document.querySelector('#first-use-title')?.getClientRects().length>0,
            wechatHidden:!document.querySelector('#wechat-start')&&!document.querySelector('#wechat-modal'),
            installerVisible:!document.querySelector('#android-installer').hidden,
            shortcutsInView:['#android-installer','#open-network-settings','#open-scan-settings'].every(selector=>{const rect=document.querySelector(selector).getBoundingClientRect();return rect.height>=40&&rect.top>=0&&rect.bottom<=window.innerHeight;}),
            noHorizontalOverflow:document.documentElement.scrollWidth<=window.innerWidth
        }))()");
        using var homeState=JsonDocument.Parse(home);
        if(homeState.RootElement.EnumerateObject().Any(item=>item.Value.ValueKind!=JsonValueKind.True))return false;
        using(var image=File.Create(Path.Combine(_verificationDirectory,"first-use-home-screen.png")))await ControlPage.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,image);
        var shortcuts=await ControlPage.CoreWebView2.ExecuteScriptAsync(@"(()=>{
            document.querySelector('#open-network-settings').click();
            const networkOpened=!document.querySelector('[data-page=settings]').hidden&&document.querySelector('#authorize-network').getClientRects().length>0;
            document.querySelector('[data-view=connect]').click();document.querySelector('#open-scan-settings').click();
            const scanOpened=!document.querySelector('[data-page=settings]').hidden&&!document.querySelector('#scan-directory-guide').hidden;
            document.querySelector('#scan-directory-help').click();const collapsed=document.querySelector('#scan-directory-guide').hidden;
            document.querySelector('#scan-directory-help').click();const expanded=!document.querySelector('#scan-directory-guide').hidden&&document.querySelector('#scan-directory-help').getAttribute('aria-expanded')==='true';
            document.querySelector('#extra-scan-section').scrollIntoView({block:'start'});
            return {networkOpened,scanOpened,collapsed,expanded};
        })()");
        File.WriteAllText(Path.Combine(_verificationDirectory,"first-use-guide-verification.json"),"{\"home\":"+home+",\"shortcuts\":"+shortcuts+"}");
        using(var image=File.Create(Path.Combine(_verificationDirectory,"directory-guide-screen.png")))await ControlPage.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,image);
        using var shortcutState=JsonDocument.Parse(shortcuts);
        return shortcutState.RootElement.EnumerateObject().All(item=>item.Value.ValueKind==JsonValueKind.True);
    }

    public async Task<bool> VerifyNetworkAuthorizationAsync()
    {
        if(_verificationDirectory is null) return false;
        await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-view=settings]').click();document.querySelector('#authorize-network').click();document.querySelector('#authorize-network').scrollIntoView({block:'center'});");
        for(var attempt=0;attempt<40;attempt++)
        {
            var json=await ControlPage.CoreWebView2.ExecuteScriptAsync(@"(()=>({
                text:document.querySelector('#network-authorization-note')?.textContent,
                enabled:document.querySelector('#authorize-network')?.disabled===false,
                revokeEnabled:document.querySelector('#revoke-network')?.disabled===false
            }))()");
            using var state=JsonDocument.Parse(json);
            if(state.RootElement.GetProperty("text").GetString()?.Contains("测试验收模式")==true)
            {
                File.WriteAllText(Path.Combine(_verificationDirectory,"network-authorization-verification.json"),json);
                using var image=File.Create(Path.Combine(_verificationDirectory,"network-authorization-screen.png"));
                await ControlPage.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,image);
                var originalOk=state.RootElement.GetProperty("enabled").GetBoolean() && !state.RootElement.GetProperty("revokeEnabled").GetBoolean();
                var conflictResults=new List<object>();
                foreach(var id in new[]{"check-network-conflicts","repair-network-conflicts","restore-network-conflicts"})
                {
                    await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('#network-conflict-note').textContent='';document.querySelector('#"+id+"').click();");
                    var received=false;
                    for(var poll=0;poll<40;poll++)
                    {
                        if(await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('#network-conflict-note').textContent.includes('测试验收模式')")=="true"){received=true;break;}
                        await Task.Delay(50);
                    }
                    conflictResults.Add(new{id,received});if(!received)return false;
                }
                File.WriteAllText(Path.Combine(_verificationDirectory,"network-conflict-verification.json"),JsonSerializer.Serialize(new{nativeBridge=true,noRuleWrites=true,actions=conflictResults}));
                await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('#repair-network-conflicts').scrollIntoView({block:'center'});");
                using(var conflictImage=File.Create(Path.Combine(_verificationDirectory,"network-conflict-screen.png")))await ControlPage.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,conflictImage);
                return originalOk;
            }
            await Task.Delay(50);
        }
        return false;
    }

    public async Task<bool> VerifyExtraScanDirectoriesAsync()
    {
        if(_verificationDirectory is null)return false;
        var directory=Path.Combine(_verificationDirectory,"extra-photo-fixture");Directory.CreateDirectory(directory);
        var photo=Path.Combine(directory,"External.png");
        File.WriteAllBytes(photo,Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="));
        await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-view=settings]').click();");
        ControlPage.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{type="extraScanDirectorySelected",path=directory}));
        async Task<bool> UntilAsync(string expression)
        {
            for(var attempt=0;attempt<160;attempt++){if(await ControlPage.CoreWebView2.ExecuteScriptAsync(expression)=="true")return true;await Task.Delay(50);}return false;
        }
        if(!await UntilAsync("document.querySelector('#scan-directory-preview').hidden===false"))return false;
        await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('#confirm-scan-directory').click();");
        if(!await UntilAsync("document.querySelector('#scan-directory-preview').hidden===true && document.querySelector('#scan-directory-list').textContent.includes('extra-photo-fixture')"))return false;
        await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('#extra-scan-section').scrollIntoView({block:'start'});");
        using(var image=File.Create(Path.Combine(_verificationDirectory,"extra-scan-screen.png")))await ControlPage.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,image);
        await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('#scan-directory-list button').click();document.querySelector('#scan-directory-list button').click();");
        var removed=await UntilAsync("!document.querySelector('#scan-directory-list').textContent.includes('extra-photo-fixture')");
        File.WriteAllText(Path.Combine(_verificationDirectory,"extra-scan-verification.json"),JsonSerializer.Serialize(new{previewConfirmed=true,added=true,removed,originalPreserved=File.Exists(photo),privateFixture=true}));
        return removed&&File.Exists(photo);
    }

    public async Task<bool> VerifyConnectionDiagnosticsAsync()
    {
        if(_verificationDirectory is null)return false;
        await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-view=connect]').click();document.querySelector('#renew').click();");
        await Task.Delay(500);
        await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('#pairing-export-diagnostics').click();");
        var watch=Stopwatch.StartNew();var path=Path.Combine(_verificationDirectory,"ConnectionDiagnostics.zip");
        while(watch.Elapsed<TimeSpan.FromSeconds(60)&&!File.Exists(path))await Task.Delay(200);
        if(!File.Exists(path))return false;
        using var zip=System.IO.Compression.ZipFile.OpenRead(path);
        var names=zip.Entries.Select(entry=>entry.FullName).ToArray();
        var hasReport=names.Contains("ConnectionReport.txt");var hasSummary=names.Contains("DiagnosticSummary.json");
        var allowed=names.All(name=>name is "ConnectionReport.txt" or "DiagnosticSummary.json" or "反馈说明.txt"||new[]{"startup-timings.json","startup-service-timings.json","startup-error.log","startup-diagnostics.log","game-discovery.log"}.Any(log=>name=="logs/"+log));
        File.WriteAllText(Path.Combine(_verificationDirectory,"connection-diagnostics-verification.json"),JsonSerializer.Serialize(new{hasReport,hasSummary,allowlistedEntries=allowed,actualNativeExport=true,privateFixture=true}));
        using(var image=File.Create(Path.Combine(_verificationDirectory,"connection-diagnostics-screen.png")))await ControlPage.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,image);
        await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('#close').click();");
        return hasReport&&hasSummary&&allowed;
    }

    public async Task<bool> VerifyOrganizerAsync()
    {
        if(_verificationDirectory is null)return false;
        await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-view=settings]').click();document.querySelector('#start-hotspot').click();document.querySelector('#temporary-network').scrollIntoView({block:'start'});");
        bool bridge=false;
        for(int i=0;i<60;i++){if(await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('#hotspot-note').textContent.includes('测试验收模式')")=="true"){bridge=true;break;}await Task.Delay(50);}
        using(var image=File.Create(Path.Combine(_verificationDirectory,"temporary-network-screen.png")))await ControlPage.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,image);
        // UI-only synthetic row. The actual authorization and filesystem roundtrip have separate integration tests.
        await ControlPage.CoreWebView2.ExecuteScriptAsync("""
        window.__organizerOriginalFetch=window.fetch;
        window.__organizerFixture=Array.from({length:10},(_,index)=>({id:'synthetic-organizer-preview-'+index,assetId:'asset_fixture',state:['pending','pending','confirming','confirming','recycled','failed','queued','checking','executing','preparing'][index],online:index%2===0,message:index===5?'示例：部分处理，请检查电脑回收站':index>=6?'正在处理，结果自动更新':'等待电脑确认',count:2,files:[{name:index===4?'已回收照片占位.jpeg':'暖暖照片_cover.jpeg',folder:'Videos',size:1048576},{name:'暖暖照片.mp4',folder:'Videos',size:5242880}]}));
        window.fetch=(url,options)=>{
          if(url==='/api/organizer')return Promise.resolve(new Response(JSON.stringify({items:window.__organizerFixture}),{status:200}));
          if(url==='/api/organizer/approve-many'){
            window.__organizerBulkIds=JSON.parse(options.body).ids;
            window.__organizerFixture=window.__organizerFixture.map(item=>window.__organizerBulkIds.includes(item.id)?{...item,state:'recycled'}:item);
            return Promise.resolve(new Response(JSON.stringify({items:window.__organizerFixture,approved:window.__organizerBulkIds.length,skipped:0}),{status:200}));
          }
          return url.startsWith('/api/organizer/preview?')?window.__organizerOriginalFetch('/brand.png'):window.__organizerOriginalFetch(url,options);
        };
        """);
        bool rendered=false;
        for(int i=0;i<160;i++){if(await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('#organizer-list').textContent.includes('暖暖照片_cover.jpeg')")=="true"){rendered=true;break;}await Task.Delay(50);}
        await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('[data-view=connect]').click();window.scrollTo(0,0);");
        using(var home=File.Create(Path.Combine(_verificationDirectory,"organizer-home-screen.png")))await ControlPage.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,home);
        await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('#open-organizer').click();window.scrollTo(0,0);");
        bool previews=false;
        for(int i=0;i<100;i++){if(await ControlPage.CoreWebView2.ExecuteScriptAsync("Array.from(document.querySelectorAll('.organizer-picture img')).filter(image=>image.complete&&image.naturalWidth>0).length>=3")=="true"){previews=true;break;}await Task.Delay(50);}
        using(var image=File.Create(Path.Combine(_verificationDirectory,"organizer-screen.png")))await ControlPage.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,image);
        bool guidance=await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('#organizer-list').textContent.includes('等待手机连接')&&document.querySelector('#organizer-list').textContent.includes('等待手机重新连接')&&document.querySelector('#organizer-approve-all').textContent.includes('1 张')&&!document.querySelector('#organizer-list').textContent.includes('已回收照片占位')&&document.querySelectorAll('.organizer-tile').length===8")=="true";
        bool progress=await ControlPage.CoreWebView2.ExecuteScriptAsync("document.querySelector('#organizer-list').textContent.includes('正在核对关联文件')&&document.querySelector('#organizer-list').textContent.includes('正在移入回收站')&&document.querySelector('#organizer-note').textContent.includes('3 张正在核对或移入回收站')")=="true";
        // Explicit verification mode only: approve synthetic DOM rows through a mocked endpoint; never touch the real queue.
        await ControlPage.CoreWebView2.ExecuteScriptAsync("window.__organizerFixture=window.__organizerFixture.map(item=>item.state==='preparing'?{...item,state:'pending'}:item);");
        bool prepared=false;
        for(int i=0;i<130;i++){if(await ControlPage.CoreWebView2.ExecuteScriptAsync("!document.querySelector('#organizer-approve-all').disabled&&document.querySelector('#organizer-approve-all').textContent.includes('1 张')")=="true"){prepared=true;break;}await Task.Delay(50);}
        await ControlPage.CoreWebView2.ExecuteScriptAsync("window.__organizerConfirm=window.confirm;window.confirm=()=>true;document.querySelector('#organizer-approve-all').click();window.confirm=window.__organizerConfirm;");
        bool bulk=false;
        for(int i=0;i<60;i++){if(await ControlPage.CoreWebView2.ExecuteScriptAsync("JSON.stringify(window.__organizerBulkIds)==='[\"synthetic-organizer-preview-0\"]'&&document.querySelectorAll('.organizer-tile').length===7&&document.querySelector('#organizer-approve-all').disabled")=="true"){bulk=true;break;}await Task.Delay(50);}
        await ControlPage.CoreWebView2.ExecuteScriptAsync("window.fetch=window.__organizerOriginalFetch;delete window.__organizerOriginalFetch;delete window.__organizerFixture;delete window.__organizerBulkIds;delete window.__organizerConfirm;");
        File.WriteAllText(Path.Combine(_verificationDirectory,"organizer-verification.json"),JsonSerializer.Serialize(new{hotspotBridge=bridge,syntheticPendingUi=rendered,syntheticPreviewsLoaded=previews,connectionGuidance=guidance,syntheticProgress=progress,syntheticPreparationGate=prepared,syntheticBulkSnapshotAndCompletedRemoval=bulk,noNetworkChanges=true,noMediaDeleted=true}));
        return bridge&&rendered&&previews&&guidance&&progress&&prepared&&bulk;
    }
}
