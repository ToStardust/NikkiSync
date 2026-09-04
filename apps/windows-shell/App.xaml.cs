using System.Windows;
using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell;

public partial class App : System.Windows.Application
{
    private SingleInstanceCoordinator? _singleInstance;
    private MainWindow? _mainWindow;
    private bool _activationPending;

    protected override void OnStartup(StartupEventArgs e)
    {
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
