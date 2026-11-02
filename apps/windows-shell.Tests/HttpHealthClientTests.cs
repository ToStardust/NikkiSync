using System.Net;
using System.Net.Http;
using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell.Tests;

public sealed class HttpHealthClientTests
{
    private static readonly Uri Endpoint = new("http://127.0.0.1:28950/api/status");

    [Fact]
    public async Task Timed_out_health_request_is_retried_and_does_not_abort_startup()
    {
        using var client = new HttpClient(new DelayedHandler()) { Timeout = TimeSpan.FromMilliseconds(30) };
        var health = new HttpHealthClient(client);
        Assert.False(await health.IsReadyAsync(Endpoint, CancellationToken.None));
        Assert.True(await health.IsReadyAsync(Endpoint, CancellationToken.None));
    }

    [Fact]
    public async Task User_cancellation_is_not_swallowed_as_a_retry()
    {
        using var client = new HttpClient(new DelayedHandler());
        using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(30));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new HttpHealthClient(client).IsReadyAsync(Endpoint, cancel.Token));
    }

    [Fact]
    public async Task Each_probe_is_bounded_even_when_the_http_client_has_no_timeout()
    {
        using var client = new HttpClient(new DelayedHandler()) { Timeout = Timeout.InfiniteTimeSpan };
        var health = new HttpHealthClient(client, TimeSpan.FromMilliseconds(30));
        Assert.False(await health.IsReadyAsync(Endpoint, CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(1)));
        Assert.True(await health.IsReadyAsync(Endpoint, CancellationToken.None));
    }

    [Fact]
    public async Task Startup_deadline_interrupts_an_inflight_health_request()
    {
        var child = new Child();
        var host = new ServiceProcessHost(new Factory(child), new SlowHealth(), TimeSpan.FromMilliseconds(30));
        var error = await Assert.ThrowsAsync<ServiceStartException>(() => host.StartAsync("test", CancellationToken.None));
        Assert.Equal("SERVICE_TIMEOUT", error.Failure.Code);
        Assert.True(child.Killed);
    }

    private sealed class DelayedHandler : HttpMessageHandler
    {
        private int _calls;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            if (Interlocked.Increment(ref _calls) == 1) await Task.Delay(TimeSpan.FromSeconds(2), token);
            return new HttpResponseMessage(HttpStatusCode.OK);
        }
    }
    private sealed class SlowHealth : IHealthClient
    {
        public async Task<bool> IsReadyAsync(Uri endpoint, CancellationToken token)
        { await Task.Delay(TimeSpan.FromMilliseconds(150), token); return true; }
    }
    private sealed class Child : IChildProcess
    {
        public bool Killed;
        public bool HasExited => false;
        public void Kill() => Killed = true;
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
    private sealed class Factory(Child child) : IServiceProcessFactory
    {
        public IChildProcess Start(string executablePath, string arguments, IReadOnlyDictionary<string, string> environment) => child;
    }
}
