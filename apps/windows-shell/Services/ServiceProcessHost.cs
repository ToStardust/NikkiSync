using System.Diagnostics;
using System.IO;
using System.Net.Http;

namespace NikkiSync.WindowsShell.Services;

public interface IChildProcess : IAsyncDisposable
{
    bool HasExited { get; }
    void Kill();
}

public interface IServiceProcessFactory
{
    IChildProcess Start(string executablePath, string arguments, IReadOnlyDictionary<string, string> environment);
}

public interface IHealthClient
{
    Task<bool> IsReadyAsync(Uri endpoint, CancellationToken cancellationToken);
}

public sealed class ServiceStartException(string message) : Exception(message);

public sealed class ServiceProcessHost(
    IServiceProcessFactory processFactory,
    IHealthClient healthClient,
    TimeSpan? startupTimeout = null)
{
    private const int DesktopPort = 28950;
    // A cold scan of a real Infinity Nikki library can take longer than a normal web-service boot.
    private readonly TimeSpan _startupTimeout = startupTimeout ?? TimeSpan.FromMinutes(2);
    private IChildProcess? _child;

    public async Task<Uri> StartAsync(string releaseDirectory, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(releaseDirectory)) throw new ArgumentException("Release directory is required.", nameof(releaseDirectory));
        await StopAsync();
        var endpoint = new Uri($"http://127.0.0.1:{DesktopPort}/api/status");
        _child = processFactory.Start(
            Path.Combine(releaseDirectory, "NikkiSync-PC-service.exe"),
            $"--desktop-port {DesktopPort}",
            new Dictionary<string, string> { ["NIKKISYNC_DESKTOP_PORT"] = DesktopPort.ToString() });
        var started = DateTimeOffset.UtcNow;
        try
        {
            while (true)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (_child.HasExited) throw new ServiceStartException("NikkiSync service exited before the desktop UI was ready.");
                if (await healthClient.IsReadyAsync(endpoint, cancellationToken)) return endpoint;
                if (DateTimeOffset.UtcNow - started >= _startupTimeout) throw new ServiceStartException("NikkiSync service did not become ready in time.");
                await Task.Delay(TimeSpan.FromMilliseconds(100), cancellationToken);
            }
        }
        catch
        {
            await StopAsync();
            throw;
        }
    }

    public async Task StopAsync()
    {
        var child = Interlocked.Exchange(ref _child, null);
        if (child is null) return;
        if (!child.HasExited) child.Kill();
        await child.DisposeAsync();
    }
}

public interface IRunEntryStore
{
    string? Value { get; set; }
}

public sealed class AutostartService(IRunEntryStore store)
{
    public bool IsEnabled() => !string.IsNullOrWhiteSpace(store.Value);

    public void SetEnabled(bool enabled, string executablePath)
    {
        if (!enabled) { store.Value = null; return; }
        if (string.IsNullOrWhiteSpace(executablePath)) throw new ArgumentException("Executable path is required.", nameof(executablePath));
        store.Value = $"\"{executablePath}\"";
    }
}

public sealed class ProcessServiceFactory : IServiceProcessFactory
{
    public IChildProcess Start(string executablePath, string arguments, IReadOnlyDictionary<string, string> environment)
    {
        var info = new ProcessStartInfo(executablePath, arguments) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
        foreach (var (key, value) in environment) info.Environment[key] = value;
        return new ProcessChild(Process.Start(info) ?? throw new ServiceStartException("Could not start NikkiSync service."));
    }

    private sealed class ProcessChild(Process process) : IChildProcess
    {
        public bool HasExited => process.HasExited;
        public void Kill() => process.Kill(entireProcessTree: true);
        public ValueTask DisposeAsync() { process.Dispose(); return ValueTask.CompletedTask; }
    }
}

public sealed class HttpHealthClient(HttpClient client) : IHealthClient
{
    public async Task<bool> IsReadyAsync(Uri endpoint, CancellationToken cancellationToken)
    {
        try { return (await client.GetAsync(endpoint, cancellationToken)).IsSuccessStatusCode; }
        catch (HttpRequestException) { return false; }
    }
}
