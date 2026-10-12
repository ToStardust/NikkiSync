namespace NikkiSync.WindowsShell.Services;

// A native WebView HWND can cover WPF siblings regardless of their Z-index.
// Reveal it only after the expected local dashboard has actually loaded.
public sealed class StartupPageGate(Uri dashboard)
{
    private bool _ready;
    public bool ShouldShowBrowser(bool windowActive) => _ready && windowActive;

    public bool IsDashboard(string source) => Uri.TryCreate(source, UriKind.Absolute, out var uri) && uri == dashboard;

    public bool CompleteNavigation(string source, bool success, bool dashboardPresent)
    {
        if (!IsDashboard(source)) return false;
        if (!success || !dashboardPresent) throw new InvalidOperationException("电脑相册页面加载失败，请退出后重新打开。");
        _ready = true;
        return true;
    }
}
