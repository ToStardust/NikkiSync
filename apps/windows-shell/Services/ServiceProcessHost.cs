using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text;

namespace NikkiSync.WindowsShell.Services;

public interface IChildProcess : IAsyncDisposable
{
    bool HasExited { get; }
    int? ExitCode => null;
    Task<string> ReadOutputAsync(CancellationToken cancellationToken) => Task.FromResult("");
    ScanStartupProgress? StartupProgress => null;
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

public sealed class ServiceStartException(StartupFailure failure) : Exception(failure.Message)
{
    public StartupFailure Failure { get; } = failure;
}

public sealed class ServiceProcessHost(
    IServiceProcessFactory processFactory,
    IHealthClient healthClient,
    TimeSpan? startupTimeout = null,
    int desktopPort = 28950)
{
    // A cold scan of a real Infinity Nikki library can take longer than a normal web-service boot.
    private readonly TimeSpan _startupTimeout = startupTimeout ?? TimeSpan.FromMinutes(2);
    private IChildProcess? _child;

    public async Task<Uri> StartAsync(string releaseDirectory, CancellationToken cancellationToken, string? gameRoot = null,
        IProgress<ScanStartupProgress>? progress = null)
    {
        if (string.IsNullOrWhiteSpace(releaseDirectory)) throw new ArgumentException("Release directory is required.", nameof(releaseDirectory));
        await StopAsync();
        if (desktopPort is < 1 or > 65535) throw new ArgumentOutOfRangeException(nameof(desktopPort));
        var endpoint = new Uri($"http://127.0.0.1:{desktopPort}/api/status");
        var environment = new Dictionary<string, string> { ["NIKKISYNC_DESKTOP_PORT"] = desktopPort.ToString() };
        if (!string.IsNullOrWhiteSpace(gameRoot)) environment["NIKKISYNC_GAME_ROOT"] = gameRoot;
        _child = processFactory.Start(
            Path.Combine(releaseDirectory, "runtime", "NikkiSync-PC-service.exe"),
            $"--desktop-port {desktopPort}",
            environment);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var elapsed = Stopwatch.StartNew();
        var watchdog = new ScanStartupWatchdog(_startupTimeout, _startupTimeout > TimeSpan.FromMinutes(30) ? _startupTimeout : TimeSpan.FromMinutes(30));
        deadline.CancelAfter(_startupTimeout);
        try
        {
            while (true)
            {
                cancellationToken.ThrowIfCancellationRequested();
                deadline.Token.ThrowIfCancellationRequested();
                if (_child.HasExited)
                {
                    var output = await _child.ReadOutputAsync(cancellationToken);
                    throw new ServiceStartException(StartupFailure.FromServiceExit(_child.ExitCode, output));
                }
                if (_child.StartupProgress is { } work && watchdog.Observe(work, elapsed.Elapsed))
                {
                    deadline.CancelAfter(watchdog.Remaining(elapsed.Elapsed));
                    progress?.Report(work);
                }
                if (await healthClient.IsReadyAsync(endpoint, deadline.Token)) return endpoint;
                await Task.Delay(TimeSpan.FromMilliseconds(100), deadline.Token);
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested && deadline.IsCancellationRequested)
        {
            await StopAsync();
            throw new ServiceStartException(StartupFailure.Create("SERVICE_TIMEOUT"));
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

    public bool IsEnabledFor(string executablePath) =>
        string.Equals(store.Value, Command(executablePath), StringComparison.OrdinalIgnoreCase);

    public void RefreshEnabledPath(string executablePath)
    {
        // An existing Run value is the user's opt-in. A new portable release may
        // have a different filename/location; never opt in when the value is absent.
        if (!IsEnabled()) return;
        var command = Command(executablePath);
        if (!string.Equals(store.Value, command, StringComparison.OrdinalIgnoreCase)) store.Value = command;
    }

    public void SetEnabled(bool enabled, string executablePath)
    {
        if (!enabled) { store.Value = null; return; }
        store.Value = Command(executablePath);
    }

    private static string Command(string executablePath)
    {
        if (string.IsNullOrWhiteSpace(executablePath) || !Path.IsPathFullyQualified(executablePath)
            || executablePath.IndexOfAny(['"', '\r', '\n']) >= 0)
            throw new ArgumentException("An absolute executable path is required.", nameof(executablePath));
        return $"\"{executablePath}\"";
    }
}

public sealed class ProcessServiceFactory : IServiceProcessFactory
{
    public IChildProcess Start(string executablePath, string arguments, IReadOnlyDictionary<string, string> environment)
    {
        var info = new ProcessStartInfo(executablePath, arguments)
        {
            UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
            // Discover installs beside the user's single EXE even if a shortcut has a different working directory.
            WorkingDirectory = Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        foreach (var (key, value) in environment) info.Environment[key] = value;
        info.Environment["NIKKISYNC_RECYCLE_HELPER"] = Environment.ProcessPath;
        return new ProcessChild(Process.Start(info) ?? throw new ServiceStartException(StartupFailure.Create("SERVICE_EXIT")));
    }

    private sealed class ProcessChild : IChildProcess
    {
        private readonly Process _process;
        private readonly object _gate = new();
        // Separate tails prevent verbose stdout from evicting the actual stderr reason.
        private readonly StringBuilder _stdout = new();
        private readonly StringBuilder _stderr = new();
        private readonly ScanStartupProgressReader _progress = new();
        private readonly Task _readers;
        public ProcessChild(Process process)
        {
            _process = process;
            _readers = Task.WhenAll(PumpAsync(process.StandardOutput, _stdout), PumpAsync(process.StandardError, _stderr));
        }
        private async Task PumpAsync(StreamReader reader, StringBuilder tail)
        {
            var buffer = new char[2048];
            try
            {
                int count;
                while ((count = await reader.ReadAsync(buffer)) > 0)
                    lock (_gate)
                    {
                        tail.Append(buffer, 0, count);
                        if (tail.Length > 16384) tail.Remove(0, tail.Length - 16384);
                        if (ReferenceEquals(tail, _stdout)) _progress.Append(buffer.AsSpan(0, count));
                    }
            }
            catch (Exception error) when (error is IOException or ObjectDisposedException) { }
        }
        public bool HasExited => _process.HasExited;
        public ScanStartupProgress? StartupProgress { get { lock (_gate) return _progress.Latest; } }
        public int? ExitCode => HasExited ? _process.ExitCode : null;
        public async Task<string> ReadOutputAsync(CancellationToken cancellationToken)
        {
            if (HasExited)
                try { await _readers.WaitAsync(TimeSpan.FromSeconds(1), cancellationToken); }
                catch (TimeoutException) { } // A descendant holding a pipe must not stall the error UI.
            lock (_gate) return _stdout.ToString() + _stderr;
        }
        public void Kill() => _process.Kill(entireProcessTree: true);
        public async ValueTask DisposeAsync()
        {
            try { await _readers.WaitAsync(TimeSpan.FromSeconds(1)); }
            catch (TimeoutException) { }
            finally { _process.Dispose(); }
        }
    }
}

public sealed class HttpHealthClient(HttpClient client, TimeSpan? probeTimeout = null) : IHealthClient, IDisposable
{
    private readonly TimeSpan _probeTimeout = probeTimeout ?? TimeSpan.FromSeconds(1);

    // Loopback readiness must not depend on VPN/system proxy routing or follow a remote redirect.
    public static HttpHealthClient CreateLoopback() => new(new HttpClient(new SocketsHttpHandler
    {
        UseProxy = false, AllowAutoRedirect = false, ConnectTimeout = TimeSpan.FromMilliseconds(500)
    }) { Timeout = Timeout.InfiniteTimeSpan });

    public async Task<bool> IsReadyAsync(Uri endpoint, CancellationToken cancellationToken)
    {
        using var probe = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        probe.CancelAfter(_probeTimeout);
        try
        {
            using var response = await client.GetAsync(endpoint, HttpCompletionOption.ResponseHeadersRead, probe.Token);
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException) { return false; }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return false; }
    }

    public void Dispose() => client.Dispose();
}
