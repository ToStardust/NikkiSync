using NikkiSync.WindowsShell.Services;
using System.IO;

namespace NikkiSync.WindowsShell.Tests;

public sealed class ServiceProcessHostTests
{
    [Fact]
    public async Task StartAsync_launches_background_service_from_runtime_and_stops_it_on_exit()
    {
        var child = new FakeChildProcess();
        var factory = new FakeProcessFactory(child);
        var host = new ServiceProcessHost(factory, new ReadyHealthClient());

        var endpoint = await host.StartAsync(@"C:\Release Folder", CancellationToken.None);

        Assert.Equal(@"C:\Release Folder\runtime\NikkiSync-PC-service.exe", factory.ExecutablePath);
        Assert.Equal("--desktop-port 28950", factory.Arguments);
        Assert.Equal("127.0.0.1", endpoint.Host);
        Assert.False(child.KillCalled);
        await host.StopAsync();
        Assert.True(child.KillCalled);
    }

    [Fact]
    public async Task StartAsync_stops_child_when_local_health_never_becomes_ready()
    {
        var child = new FakeChildProcess();
        var host = new ServiceProcessHost(new FakeProcessFactory(child), new FailingHealthClient(), TimeSpan.Zero);

        await Assert.ThrowsAsync<ServiceStartException>(() => host.StartAsync(@"C:\Release", CancellationToken.None));

        Assert.True(child.KillCalled);
    }

    [Fact]
    public async Task Verification_can_use_an_isolated_port_without_changing_the_normal_desktop_port()
    {
        var factory = new FakeProcessFactory(new FakeChildProcess());
        var host = new ServiceProcessHost(factory, new ReadyHealthClient(), desktopPort: 30123);
        var endpoint = await host.StartAsync(@"C:\Verification", CancellationToken.None);
        Assert.Equal(30123, endpoint.Port);
        Assert.Equal("--desktop-port 30123", factory.Arguments);
        Assert.Equal("30123", factory.Environment!["NIKKISYNC_DESKTOP_PORT"]);
        await host.StopAsync();
    }

    private sealed class FakeChildProcess : IChildProcess
    {
        public bool HasExited => false;
        public bool KillCalled { get; private set; }
        public void Kill() => KillCalled = true;
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    [Fact]
    public async Task Explicit_game_directory_is_passed_as_environment_without_argument_interpolation()
    {
        var factory = new FakeProcessFactory(new FakeChildProcess());
        var host = new ServiceProcessHost(factory, new ReadyHealthClient());
        await host.StartAsync(@"C:\Release", CancellationToken.None, @"E:\我的游戏\InfinityNikki");
        Assert.Equal(@"E:\我的游戏\InfinityNikki", factory.Environment!["NIKKISYNC_GAME_ROOT"]);
        Assert.Equal("--desktop-port 28950", factory.Arguments);
        await host.StopAsync();
    }

    [Theory]
    [InlineData(unchecked((int)0xC000001D), "", "CPU_INSTRUCTION", "CPU")]
    [InlineData(1, "Infinity Nikki installation was not found", "GAME_NOT_FOUND", "无限暖暖")]
    [InlineData(1, "error: listen EADDRINUSE 0.0.0.0:28080", "PORT_IN_USE", "端口")]
    [InlineData(1, "未找到局域网 IPv4 地址", "NO_LAN", "网络")]
    public async Task Early_exit_reports_exit_code_and_safe_actionable_reason(int code, string output, string reason, string hint)
    {
        var child = new ExitedChild(code, output);
        var host = new ServiceProcessHost(new FakeProcessFactory(child), new ReadyHealthClient());
        var error = await Assert.ThrowsAsync<ServiceStartException>(() => host.StartAsync(@"C:\Release", CancellationToken.None));
        Assert.Contains(reason, error.Message);
        Assert.Contains(hint, error.Message);
        Assert.Contains($"0x{unchecked((uint)code):X8}", error.Message);
        Assert.True(child.OutputRead, "The last stderr bytes must be drained before diagnosing the exit.");
    }

    [Fact]
    public async Task Early_exit_never_displays_raw_child_source_or_private_data()
    {
        var output = "Error: mystery failure\nC:\\Users\\PrivateUser\\secret.jpg\n" +
            "token=pairing-secret; uid=123456789; https://private.example?key=secret\n" +
            "-----BEGIN PRIVATE KEY-----\nsecret-key\n-----END PRIVATE KEY-----";
        var host = new ServiceProcessHost(new FakeProcessFactory(new ExitedChild(1, output)), new ReadyHealthClient());
        var error = await Assert.ThrowsAsync<ServiceStartException>(() => host.StartAsync(@"C:\Release", CancellationToken.None));
        Assert.Contains("SERVICE_EXIT", error.Message);
        foreach (var secret in new[] { "PrivateUser", "pairing-secret", "123456789", "private.example", "secret-key" })
            Assert.DoesNotContain(secret, error.Message);
    }

    private sealed class ExitedChild(int code, string output) : IChildProcess
    {
        public bool HasExited => true;
        public int? ExitCode => code;
        public bool OutputRead { get; private set; }
        public async Task<string> ReadOutputAsync(CancellationToken cancellationToken)
        {
            await Task.Yield(); // Last pipe bytes may arrive after HasExited becomes true.
            OutputRead = true;
            return output;
        }
        public void Kill() => throw new InvalidOperationException("Already exited");
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    [Fact]
    public async Task Real_process_drains_final_stderr_and_bounds_large_output_without_blocking()
    {
        var executable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
        await using var child = new ProcessServiceFactory().Start(executable,
            "-NoProfile -NonInteractive -Command \"[Console]::Out.Write(('x' * 100000)); [Console]::Error.Write('Infinity Nikki installation was not found'); exit 7\"",
            new Dictionary<string, string>());
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        while (!child.HasExited) await Task.Delay(25, deadline.Token);
        var output = await child.ReadOutputAsync(deadline.Token);
        Assert.Equal(7, child.ExitCode);
        Assert.Contains("Infinity Nikki installation was not found", output);
        Assert.True(output.Length <= 32768);
    }

    private sealed class FakeProcessFactory(IChildProcess child) : IServiceProcessFactory
    {
        public string? ExecutablePath { get; private set; }
        public string? Arguments { get; private set; }
        public IReadOnlyDictionary<string, string>? Environment { get; private set; }
        public IChildProcess Start(string executablePath, string arguments, IReadOnlyDictionary<string, string> environment)
        {
            ExecutablePath = executablePath;
            Arguments = arguments;
            Environment = environment;
            return child;
        }
    }

    private sealed class ReadyHealthClient : IHealthClient
    {
        public Task<bool> IsReadyAsync(Uri endpoint, CancellationToken cancellationToken) => Task.FromResult(true);
    }

    [Fact]
    public async Task Startup_waits_beyond_the_normal_deadline_only_while_real_work_advances()
    {
        var child = new ProgressChild();
        var reports = new List<ScanStartupProgress>();
        var health = new ScanningHealthClient(child);
        var host = new ServiceProcessHost(new FakeProcessFactory(child), health, TimeSpan.FromSeconds(2));
        using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        try
        {
            await host.StartAsync(@"C:\Release", cancel.Token, progress: new CollectProgress(reports));
            Assert.Equal(10, health.Calls);
            Assert.True(reports.Count > 2);
            Assert.False(child.Killed);
        }
        finally { await host.StopAsync(); }
    }

    [Fact]
    public async Task Real_stdout_progress_reaches_host_without_exposing_or_buffering_raw_lines()
    {
        var message = "{\"type\":\"nikkisync-startup-progress\",\"stage\":\"scan-files\",\"filesObserved\":1,\"filesCompleted\":0,\"bytesRead\":8192,\"assetsProcessed\":0}";
        await using var child = new ProcessServiceFactory().Start("powershell.exe",
            "-NoProfile -Command \"[Console]::Out.WriteLine(('x' * 20000)); [Console]::Out.WriteLine('" + message.Replace("\"", "\\\"") + "')\"",
            new Dictionary<string, string>());
        using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (!child.HasExited) await Task.Delay(25, cancel.Token);
        await child.ReadOutputAsync(cancel.Token);
        Assert.Equal(new ScanStartupProgress("scan-files", 1, 0, 8192, 0), child.StartupProgress);
    }

    private sealed class CollectProgress(List<ScanStartupProgress> reports) : IProgress<ScanStartupProgress>
    { public void Report(ScanStartupProgress value) => reports.Add(value); }
    private sealed class ProgressChild : IChildProcess
    {
        public long Bytes = 1;
        public bool Killed;
        public bool HasExited => false;
        public ScanStartupProgress? StartupProgress => new("scan-files", 1, 0, Bytes, 0);
        public void Kill() => Killed = true;
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
    private sealed class ScanningHealthClient(ProgressChild child) : IHealthClient
    {
        public int Calls;
        public async Task<bool> IsReadyAsync(Uri endpoint, CancellationToken cancellationToken)
        {
            await Task.Delay(250, cancellationToken);
            child.Bytes += 4096;
            return ++Calls == 10;
        }
    }

    private sealed class FailingHealthClient : IHealthClient
    {
        public Task<bool> IsReadyAsync(Uri endpoint, CancellationToken cancellationToken) => Task.FromResult(false);
    }
}
