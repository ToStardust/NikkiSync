using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell.Tests;

[CollectionDefinition("Loopback proxy", DisableParallelization = true)]
public sealed class LoopbackProxyCollection { }

[Collection("Loopback proxy")]
public sealed class LoopbackHealthTests
{
    [Theory]
    [InlineData("200 OK", true)]
    [InlineData("302 Found", false)]
    public async Task Production_client_bypasses_system_proxy_and_does_not_follow_redirects(string status, bool ready)
    {
        var original = HttpClient.DefaultProxy;
        var proxy = new RejectingProxy();
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var endpoint = new Uri($"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}/api/status");
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var serve = Task.Run(async () =>
        {
            using var socket = await listener.AcceptTcpClientAsync(deadline.Token);
            using var stream = socket.GetStream();
            var bytes = new byte[4096];
            await stream.ReadAsync(bytes, deadline.Token);
            await stream.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 {status}\r\nContent-Length: 0\r\nLocation: http://127.0.0.1:1/\r\nConnection: close\r\n\r\n"), deadline.Token);
        });
        try
        {
            HttpClient.DefaultProxy = proxy;
            using var health = HttpHealthClient.CreateLoopback();
            Assert.Equal(ready, await health.IsReadyAsync(endpoint, deadline.Token));
            Assert.Equal(0, proxy.Calls);
            await serve;
        }
        finally { HttpClient.DefaultProxy = original; deadline.Cancel(); listener.Stop(); }
    }

    private sealed class RejectingProxy : IWebProxy
    {
        public int Calls;
        public ICredentials? Credentials { get; set; }
        public Uri GetProxy(Uri destination) { Interlocked.Increment(ref Calls); return new("http://127.0.0.1:1"); }
        public bool IsBypassed(Uri host) { Interlocked.Increment(ref Calls); return false; }
    }
}
