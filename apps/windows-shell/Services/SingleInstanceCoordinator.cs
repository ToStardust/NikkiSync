using System.Threading;

namespace NikkiSync.WindowsShell.Services;

public sealed class SingleInstanceCoordinator : IDisposable
{
    private const string DefaultMutexName = "Local\\NikkiSync.WindowsShell.Instance";
    private const string DefaultActivationEventName = "Local\\NikkiSync.WindowsShell.Activate";
    private static readonly TimeSpan SignalRetryWindow = TimeSpan.FromSeconds(1);

    private readonly string _mutexName;
    private readonly string _activationEventName;
    private Mutex? _mutex;
    private EventWaitHandle? _activationEvent;
    private RegisteredWaitHandle? _waitRegistration;
    private bool _ownsMutex;
    private int _disposed;

    public SingleInstanceCoordinator(string? mutexName = null, string? activationEventName = null)
    {
        _mutexName = RequireName(mutexName ?? DefaultMutexName, nameof(mutexName));
        _activationEventName = RequireName(activationEventName ?? DefaultActivationEventName, nameof(activationEventName));
    }

    public event EventHandler? ActivationRequested;

    public bool TryAcquirePrimary()
    {
        ThrowIfDisposed();
        if (_ownsMutex) return true;

        var createdNew = false;
        Mutex? candidate = null;
        try
        {
            try
            {
                candidate = new Mutex(initiallyOwned: true, _mutexName, out createdNew);
            }
            catch (AbandonedMutexException)
            {
                // The previous shell exited without releasing the named mutex. The
                // OS has transferred ownership to this process, so it is safe to continue.
                candidate = new Mutex(initiallyOwned: false, _mutexName);
                candidate.WaitOne(TimeSpan.Zero);
                createdNew = true;
            }

            if (candidate is null) throw new InvalidOperationException("The single-instance mutex could not be created.");

            if (!createdNew)
            {
                candidate.Dispose();
                return false;
            }

            _mutex = candidate;
            _ownsMutex = true;
            _activationEvent = new EventWaitHandle(
                initialState: false,
                EventResetMode.AutoReset,
                _activationEventName);
            _waitRegistration = ThreadPool.RegisterWaitForSingleObject(
                _activationEvent,
                static (state, timedOut) => ((SingleInstanceCoordinator)state!).OnActivationSignal(timedOut),
                this,
                Timeout.Infinite,
                executeOnlyOnce: false);
            return true;
        }
        catch
        {
            candidate?.Dispose();
            _mutex = null;
            _ownsMutex = false;
            throw;
        }
    }

    public bool SignalExistingInstance()
    {
        ThrowIfDisposed();
        var deadline = DateTime.UtcNow + SignalRetryWindow;
        while (true)
        {
            try
            {
                using var activationEvent = EventWaitHandle.OpenExisting(_activationEventName);
                return activationEvent.Set();
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                if (DateTime.UtcNow >= deadline) return false;
                Thread.Sleep(10);
            }
            catch (UnauthorizedAccessException)
            {
                return false;
            }
        }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;

        _waitRegistration?.Unregister(null);
        _waitRegistration = null;
        _activationEvent?.Dispose();
        _activationEvent = null;

        if (_ownsMutex)
        {
            try { _mutex?.ReleaseMutex(); }
            catch (ApplicationException) { }
        }

        _ownsMutex = false;
        _mutex?.Dispose();
        _mutex = null;
    }

    private void OnActivationSignal(bool timedOut)
    {
        if (timedOut || Volatile.Read(ref _disposed) != 0) return;
        ActivationRequested?.Invoke(this, EventArgs.Empty);
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
    }

    private static string RequireName(string value, string parameterName)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException("A named synchronization primitive is required.", parameterName);
        return value;
    }
}
