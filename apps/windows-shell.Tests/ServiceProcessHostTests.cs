using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell.Tests;

public sealed class ServiceProcessHostTests
{
    [Fact]
    public async Task StartAsync_stops_child_when_local_health_never_becomes_ready()
    {
        var child = new FakeChildProcess();
        var host = new ServiceProcessHost(new FakeProcessFactory(child), new FailingHealthClient(), TimeSpan.Zero);

        await Assert.ThrowsAsync<ServiceStartException>(() => host.StartAsync(@"C:\Release", CancellationToken.None));

        Assert.True(child.KillCalled);
    }

    private sealed class FakeChildProcess : IChildProcess
    {
        public bool HasExited => false;
        public bool KillCalled { get; private set; }
        public void Kill() => KillCalled = true;
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    private sealed class FakeProcessFactory(IChildProcess child) : IServiceProcessFactory
    {
        public IChildProcess Start(string executablePath, string arguments, IReadOnlyDictionary<string, string> environment) => child;
    }

    private sealed class FailingHealthClient : IHealthClient
    {
        public Task<bool> IsReadyAsync(Uri endpoint, CancellationToken cancellationToken) => Task.FromResult(false);
    }
}
