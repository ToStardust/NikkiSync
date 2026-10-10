using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell.Tests;

public sealed class StartupPageGateTests
{
    [Fact]
    public void Initial_navigation_and_window_restore_do_not_uncover_the_loading_screen()
    {
        var gate = new StartupPageGate(new Uri("http://127.0.0.1:28950/"));
        Assert.False(gate.ShouldShowBrowser(true));
        Assert.False(gate.CompleteNavigation("about:blank", true, true));
        Assert.False(gate.ShouldShowBrowser(true));
        Assert.False(gate.CompleteNavigation("http://127.0.0.1:28951/", true, true));
        Assert.False(gate.CompleteNavigation("http://127.0.0.1:28950/error", true, true));
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public void Failed_navigation_or_missing_dashboard_keeps_the_browser_hidden(bool success, bool dashboardPresent)
    {
        var gate = new StartupPageGate(new Uri("http://127.0.0.1:28950/"));
        Assert.Throws<InvalidOperationException>(() => gate.CompleteNavigation("http://127.0.0.1:28950/", success, dashboardPresent));
        Assert.False(gate.ShouldShowBrowser(true));
    }

    [Fact]
    public void Only_ready_dashboard_is_revealed_and_hidden_windows_stay_hidden()
    {
        var gate = new StartupPageGate(new Uri("http://127.0.0.1:28950/"));
        Assert.True(gate.CompleteNavigation("http://127.0.0.1:28950/", true, true));
        Assert.True(gate.ShouldShowBrowser(true));
        Assert.False(gate.ShouldShowBrowser(false));
    }
}
