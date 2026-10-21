namespace NikkiSync.WindowsShell.Services;

/** Called on the UI thread: retain successful/pending initialization across service retries. */
public sealed class RetryableStartupInitialization
{
    private Task? _attempt;
    public Task EnsureAsync(Func<Task> initialize)
    {
        if (_attempt is null || _attempt.IsFaulted || _attempt.IsCanceled) _attempt = initialize();
        return _attempt;
    }
}
