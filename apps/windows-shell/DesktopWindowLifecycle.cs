namespace NikkiSync.WindowsShell;

/** Separates user-visible close behavior from process shutdown so it remains unit-testable. */
public sealed class DesktopWindowLifecycle
{
    public bool HideWindow { get; private set; }
    public bool StopService { get; private set; }

    public void OnWindowClosing() { HideWindow = true; StopService = false; }
    public void OnExplicitExit() { HideWindow = false; StopService = true; }
}
