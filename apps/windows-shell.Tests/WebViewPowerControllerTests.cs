using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell.Tests;

public sealed class WebViewPowerControllerTests
{
    [Fact]
    public async Task Hidden_view_suspends_and_restoring_resumes_it()
    {
        var visible = true; var suspends = 0; var resumes = 0;
        var power = new WebViewPowerController(() => { suspends++; return Task.FromResult(true); }, value => visible = value, () => resumes++);
        await power.SetActiveAsync(false);
        Assert.False(visible); Assert.Equal(1, suspends);
        await power.SetActiveAsync(true);
        Assert.True(visible); Assert.Equal(1, resumes);
    }

    [Fact]
    public async Task Late_suspend_cannot_leave_a_restored_window_asleep()
    {
        var completion = new TaskCompletionSource<bool>(); var resumes = 0; var suspends = 0; var visible = true;
        var power = new WebViewPowerController(() => { suspends++; return completion.Task; }, value => visible = value, () => resumes++);
        var hiding = power.SetActiveAsync(false);
        await power.SetActiveAsync(false);
        await power.SetActiveAsync(true);
        Assert.True(visible); Assert.Equal(1, suspends);
        completion.SetResult(true); await hiding;
        Assert.True(visible); Assert.Equal(2, resumes);
    }

    [Fact]
    public async Task Unavailable_suspend_does_not_break_restore_or_shutdown()
    {
        var visible = true;
        var power = new WebViewPowerController(() => throw new InvalidOperationException("Not ready"), value => visible = value, () => { });
        await power.SetActiveAsync(false);
        await power.SetActiveAsync(true);
        Assert.True(visible);
        var completion = new TaskCompletionSource<bool>(); var resumes = 0;
        power = new WebViewPowerController(() => completion.Task, _ => { }, () => resumes++);
        var hiding = power.SetActiveAsync(false); power.Stop();
        await power.SetActiveAsync(true);
        completion.SetResult(true); await hiding;
        Assert.Equal(0, resumes);
    }
}
