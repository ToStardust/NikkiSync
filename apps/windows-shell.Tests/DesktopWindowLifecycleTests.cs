using NikkiSync.WindowsShell;

namespace NikkiSync.WindowsShell.Tests;

public sealed class DesktopWindowLifecycleTests
{
    [Fact]
    public void CloseWindow_hides_to_tray_without_stopping_service()
    {
        var state = new DesktopWindowLifecycle();

        state.OnWindowClosing();

        Assert.True(state.HideWindow);
        Assert.False(state.StopService);
    }

    [Fact]
    public void ExplicitExit_stops_service_and_allows_application_shutdown()
    {
        var state = new DesktopWindowLifecycle();

        state.OnExplicitExit();

        Assert.False(state.HideWindow);
        Assert.True(state.StopService);
    }
}
