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
    private readonly object _startupContent;
    private readonly CancellationTokenSource _startupCancellation = new();
    private readonly System.Windows.Threading.DispatcherTimer _startupTimer = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly Stopwatch _startupWatch = new();
    private readonly string? _verificationDirectory;
    private readonly TaskCompletionSource<bool> _startupCompleted = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public Task<bool> StartupCompleted => _startupCompleted.Task;
    public Dictionary<string, double> StartupTimings { get; } = new();
    private VerifiedUpdate? _availableUpdate;
    private UpdateWindow? _updateWindow;

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
        _startupWatch.Restart();
        StartupTimings.Clear();
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
            }));
            _startupCancellation.Token.ThrowIfCancellationRequested();
            StartupTimings["runtimeReadyMs"] = _startupWatch.Elapsed.TotalMilliseconds;
            StartupText.Text = "2 / 4 · 准备界面显示组件…";
            _startupPhase = "webview";
            RecordStartupTimings("starting");
            StartupProgress.IsIndeterminate = true;
            // Windows special-folder lookup does not honor a diagnostic LOCALAPPDATA override.
            var environment = await CoreWebView2Environment.CreateAsync(null, _verificationDirectory is null ? Path.Combine(RuntimePayload.UserDirectory, "webview2") : Path.Combine(_verificationDirectory, "localdata", "NikkiSync", "webview2"));
            await ControlPage.EnsureCoreWebView2Async(environment);
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
            var endpoint = await _service.StartAsync(_runtimeDirectory, _startupCancellation.Token, _gameRoot);
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
            var log = StartupDiagnostics.Write(diagnosticsDirectory, _startupPhase, failure);
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
                panel.Children.Add(new TextBlock { Text = "反馈 startup-diagnostics.log、game-discovery.log 和 startup-timings.json；日志不包含照片、个人路径、配对码或密钥。", TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 16, 0, 0) });
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
        if (type.GetString() == "getAutostart")
        {
            ReplyAutostart();
            ReplyPackageInfo();
        }
        if (type.GetString() == "checkUpdates") OpenUpdates();
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
            _autostart.SetEnabled(enabled.GetBoolean(), Environment.ProcessPath ?? throw new InvalidOperationException("Current executable path is unavailable."));
            ReplyAutostart();
        }
    }

    private void ReplyAutostart() => ControlPage.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "autostart", enabled = _autostart.IsEnabled() }));
    private void ReplyPackageInfo() => ControlPage.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new {
        type = "packageInfo", version = DesktopRelease.Version, build = DesktopRelease.Build,
        hasAndroidInstaller = AndroidInstallerPath is { } path && File.Exists(path), availableUpdateVersion = _availableUpdate?.Manifest.Version
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
                    && new[] { "momo", "nikkiGallery", "releases" }.All(name => links.Contains(DesktopProjectLinks.Resolve(name)));
                await Task.Delay(150);
                using var image = File.Create(Path.Combine(_verificationDirectory, "about-screen.png"));
                await ControlPage.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, image);
                return ok;
            }
            await Task.Delay(50);
        }
        return false;
    }
}
