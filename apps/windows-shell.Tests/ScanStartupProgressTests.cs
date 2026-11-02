using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell.Tests;

public sealed class ScanStartupProgressTests
{
    private static ScanStartupProgress Reading(long bytes) => new("scan-files", 1, 0, bytes, 0);

    [Fact]
    public void Active_large_scan_can_exceed_two_minutes_but_duplicate_progress_cannot_hide_a_stall()
    {
        var watchdog = new ScanStartupWatchdog(TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(30));
        Assert.True(watchdog.Observe(Reading(1024), TimeSpan.FromSeconds(90)));
        Assert.Equal(TimeSpan.FromSeconds(90), watchdog.Remaining(TimeSpan.FromSeconds(120)));
        Assert.False(watchdog.Observe(Reading(1024), TimeSpan.FromSeconds(180)));
        Assert.Equal(TimeSpan.Zero, watchdog.Remaining(TimeSpan.FromSeconds(210)));
    }

    [Fact]
    public void Scan_progress_extends_only_with_monotonic_work_and_has_a_total_limit()
    {
        var watchdog = new ScanStartupWatchdog(TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(30));
        Assert.True(watchdog.Observe(Reading(4096), TimeSpan.FromSeconds(110)));
        Assert.False(watchdog.Observe(Reading(2048), TimeSpan.FromSeconds(120)));
        // Model a genuinely progressing library for almost half an hour.
        for (var seconds = 210; seconds < 1800; seconds += 100)
            Assert.True(watchdog.Observe(Reading(seconds * 4096L), TimeSpan.FromSeconds(seconds)));
        Assert.Equal(TimeSpan.Zero, watchdog.Remaining(TimeSpan.FromMinutes(30)));
    }

    [Fact]
    public void Protocol_handles_split_lines_and_rejects_untrusted_or_unbounded_messages()
    {
        var reader = new ScanStartupProgressReader();
        var line = "{\"type\":\"nikkisync-startup-progress\",\"stage\":\"scan-files\",\"filesObserved\":1,\"filesCompleted\":0,\"bytesRead\":4096,\"assetsProcessed\":0}";
        reader.Append(line.AsSpan(0, 30)); Assert.Null(reader.Latest);
        reader.Append(line[30..] + "\n"); Assert.Equal(Reading(4096), reader.Latest);
        foreach (var bad in new[] { "{bad", line.Replace("scan-files", "C:/Private/photo.jpg"), line.Replace("4096", "-1"), line.Replace("4096", "1.5"), new string('x', 20000) })
            reader.Append(bad + "\n");
        Assert.Equal(Reading(4096), reader.Latest);
        reader.Append(line.Replace("4096", "8192") + "\n");
        Assert.Equal(Reading(8192), reader.Latest);
    }
}
