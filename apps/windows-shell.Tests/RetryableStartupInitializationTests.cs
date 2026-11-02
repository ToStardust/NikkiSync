using NikkiSync.WindowsShell.Services;
using System.IO;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace NikkiSync.WindowsShell.Tests;

public sealed class RetryableStartupInitializationTests
{
    [Fact]
    public async Task Actual_webview_still_executes_scripts_after_initialization_is_retried()
    {
        var finished = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var profile = Path.Combine(Path.GetTempPath(), "nikkisync-webview-retry-" + Guid.NewGuid().ToString("N"));
        var thread = new Thread(() =>
        {
            var dispatcher = Dispatcher.CurrentDispatcher;
            SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(dispatcher));
            dispatcher.BeginInvoke(new Action(async () =>
            {
                var browser = new WebView2();
                var window = new Window { Content = browser, Width = 32, Height = 32, Left = -10000, Top = -10000, ShowInTaskbar = false };
                try
                {
                    window.Show();
                    var initialization = new RetryableStartupInitialization();
                    var calls = 0;
                    async Task Initialize()
                    {
                        calls++;
                        var environment = await CoreWebView2Environment.CreateAsync(null, profile);
                        await browser.EnsureCoreWebView2Async(environment);
                    }
                    await initialization.EnsureAsync(Initialize);
                    await initialization.EnsureAsync(Initialize);
                    Assert.Equal(1, calls);
                    Assert.Equal("2", await browser.ExecuteScriptAsync("1+1"));
                    finished.TrySetResult();
                }
                catch (Exception error) { finished.TrySetException(error); }
                finally { browser.Dispose(); window.Close(); dispatcher.BeginInvokeShutdown(DispatcherPriority.Normal); }
            }));
            Dispatcher.Run();
        }) { IsBackground = true };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        try { await finished.Task.WaitAsync(TimeSpan.FromSeconds(45)); }
        finally
        {
            thread.Join(TimeSpan.FromSeconds(5));
            try { if (Directory.Exists(profile)) Directory.Delete(profile, recursive: true); }
            catch (IOException) { /* Browser teardown may briefly retain cache files in the isolated temp profile. */ }
        }
    }

    [Fact]
    public async Task Retrying_a_later_startup_failure_reuses_the_initialized_browser()
    {
        var initialization = new RetryableStartupInitialization();
        var calls = 0;
        Task InitializeBrowser()
        {
            if (++calls > 1) throw new ArgumentException("WebView already has a different environment");
            return Task.CompletedTask;
        }
        await initialization.EnsureAsync(InitializeBrowser);
        await initialization.EnsureAsync(InitializeBrowser);
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Failed_browser_initialization_can_be_attempted_again_and_pending_calls_are_shared()
    {
        var initialization = new RetryableStartupInitialization();
        await Assert.ThrowsAsync<InvalidOperationException>(() => initialization.EnsureAsync(() => Task.FromException(new InvalidOperationException())));
        var pending = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var first = initialization.EnsureAsync(() => pending.Task);
        var second = initialization.EnsureAsync(() => throw new Exception("Must share pending initialization"));
        Assert.Same(first, second);
        pending.SetResult(); await Task.WhenAll(first, second);
    }
}
