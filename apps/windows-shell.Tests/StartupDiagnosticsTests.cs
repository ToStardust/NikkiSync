using NikkiSync.WindowsShell.Services;
using System.IO;

namespace NikkiSync.WindowsShell.Tests;

public sealed class StartupDiagnosticsTests
{
    [Fact]
    public void Game_not_found_hint_explains_completed_automatic_detection_and_does_not_require_the_game_to_run()
    {
        var failure = StartupFailure.Create("GAME_NOT_FOUND", 1);
        Assert.Contains("自动", failure.Hint);
        Assert.Contains("无需打开游戏", failure.Hint);
        Assert.DoesNotContain("请先打开游戏", failure.Hint);
        Assert.Contains("启动器", failure.Hint);
    }

    [Fact]
    public void Unknown_exceptions_and_diagnostics_log_cannot_include_private_exception_data()
    {
        var directory = Path.Combine(Path.GetTempPath(), "nikkisync-diagnostics-" + Guid.NewGuid().ToString("N"));
        try
        {
            var failure = StartupFailure.FromException(new Exception("user=PrivateUser token=private-token C:\\Users\\PrivateUser\\photo.jpg"));
            var log = StartupDiagnostics.Write(directory, "service", failure);
            Assert.NotNull(log);
            var content = File.ReadAllText(log!);
            Assert.Contains("STARTUP_ERROR", content);
            Assert.DoesNotContain("PrivateUser", content);
            Assert.DoesNotContain("private-token", content);
            Assert.Contains("service", content);
            StartupDiagnostics.Write(directory, "service", failure);
            Assert.Single(Directory.GetFiles(directory));
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true); }
    }
}
