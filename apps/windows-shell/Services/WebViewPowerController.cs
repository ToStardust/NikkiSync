using System.Runtime.InteropServices;

namespace NikkiSync.WindowsShell.Services;

/** Keeps asynchronous suspension from overriding a newer window restore. */
public sealed class WebViewPowerController(Func<Task<bool>> suspend, Action<bool> setVisible, Action resume)
{
    private bool _active = true;
    private bool _suspending;
    private bool _stopped;

    public async Task SetActiveAsync(bool active)
    {
        if (_stopped) return;
        _active = active;
        setVisible(active);
        if (active) { resume(); return; }
        if (_suspending) return;
        _suspending = true;
        try { await suspend(); }
        catch (COMException) { /* Visibility/runtime may change before suspension completes. */ }
        catch (InvalidOperationException) { /* WebView initialization/disposal can race this request. */ }
        finally
        {
            _suspending = false;
            if (_active && !_stopped) resume();
        }
    }

    public void Stop() => _stopped = true;
}
