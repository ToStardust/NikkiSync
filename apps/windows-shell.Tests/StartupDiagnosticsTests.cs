using NikkiSync.WindowsShell.Services;
using System.IO;

namespace NikkiSync.WindowsShell.Tests;

public sealed class StartupDiagnosticsTests
{
    [Theory]
    [InlineData(unchecked((int)0x80070005), "FILE_ACCESS")]
    [InlineData(unchecked((int)0x80070020), "FILE_BUSY")]
    [InlineData(unchecked((int)0x80070021), "FILE_BUSY")]
    [InlineData(unchecked((int)0x80070070), "DISK_FULL")]
    [InlineData(unchecked((int)0x80070027), "DISK_FULL")]
    public void File_system_failures_use_actionable_codes_without_raw_exception_text(int hresult, string expected)
    {
        var failure=StartupFailure.FromException(new IOException("C:\\Users\\PrivateUser\\token=private-token",hresult));
        Assert.Equal(expected,failure.Code);
        Assert.DoesNotContain("PrivateUser",failure.Message);
        Assert.DoesNotContain("private-token",failure.Message);
    }

    [Fact]
    public void Long_paths_and_invalid_payloads_are_distinguished_from_unknown_failures()
    {
        Assert.Equal("PATH_TOO_LONG",StartupFailure.FromException(new PathTooLongException("private-path")).Code);
        Assert.Equal("FILE_VALIDATION",StartupFailure.FromException(new InvalidDataException("private-path")).Code);
    }

    [Fact]
    public void Failure_details_report_only_safe_type_hresult_step_and_real_app_version()
    {
        var directory=Path.Combine(Path.GetTempPath(),"nikkisync-safe-failure-"+Guid.NewGuid().ToString("N"));
        try
        {
            var error=new IOException("C:\\Users\\PrivateUser\\private-token",unchecked((int)0x80070020));
            var file=StartupDiagnostics.Write(directory,"runtime",StartupFailure.FromException(error),error,PayloadPreparationStep.ValidateCache);
            var content=File.ReadAllText(file!);
            using var report=System.Text.Json.JsonDocument.Parse(content);
            Assert.Equal("io",report.RootElement.GetProperty("exceptionKind").GetString());
            Assert.Equal("0x80070020",report.RootElement.GetProperty("hresultHex").GetString());
            Assert.Equal("ValidateCache",report.RootElement.GetProperty("runtimeStep").GetString());
            Assert.Equal(DesktopRelease.Version,report.RootElement.GetProperty("appVersion").GetString());
            Assert.Equal(DesktopRelease.Build,report.RootElement.GetProperty("appBuild").GetInt64());
            Assert.DoesNotContain("PrivateUser",content);Assert.DoesNotContain("private-token",content);
            StartupDiagnostics.Write(directory,"service",StartupFailure.FromException(error),error,PayloadPreparationStep.Ready);
            using var later=System.Text.Json.JsonDocument.Parse(File.ReadAllText(file!));
            Assert.Equal(System.Text.Json.JsonValueKind.Null,later.RootElement.GetProperty("runtimeStep").ValueKind);
        }
        finally {if(Directory.Exists(directory))Directory.Delete(directory,true);}
    }

    [Fact]
    public void Arbitrary_exception_names_and_invalid_step_values_are_not_logged()
    {
        var directory=Path.Combine(Path.GetTempPath(),"nikkisync-safe-failure-"+Guid.NewGuid().ToString("N"));
        try
        {
            var error=new PrivateUserException();
            var file=StartupDiagnostics.Write(directory,"runtime",StartupFailure.FromException(error),error,(PayloadPreparationStep)999);
            var content=File.ReadAllText(file!);
            Assert.DoesNotContain("PrivateUser",content);
            using var report=System.Text.Json.JsonDocument.Parse(content);
            Assert.Equal("unknown",report.RootElement.GetProperty("exceptionKind").GetString());
            Assert.Equal(System.Text.Json.JsonValueKind.Null,report.RootElement.GetProperty("runtimeStep").ValueKind);
        }
        finally {if(Directory.Exists(directory))Directory.Delete(directory,true);}
    }
    private sealed class PrivateUserException : Exception {}

    [Fact]
    public void Timing_report_filters_untrusted_keys_and_values_and_replaces_previous_report()
    {
        var directory = Path.Combine(Path.GetTempPath(), "nikkisync-timings-" + Guid.NewGuid().ToString("N"));
        try
        {
            var timings = new Dictionary<string, double> { ["runtimeReadyMs"] = 120, ["browserReadyMs"] = double.NaN,
                ["serviceReadyMs"] = -1, ["token=private-token"] = 99 };
            var file = StartupDiagnostics.WriteTimings(directory, "private-path", "private-token", 200, timings);
            Assert.NotNull(file);
            var content = File.ReadAllText(file!);
            Assert.Contains("runtimeReadyMs", content);
            Assert.DoesNotContain("browserReadyMs", content);
            Assert.DoesNotContain("serviceReadyMs", content);
            Assert.DoesNotContain("private", content);
            StartupDiagnostics.WriteTimings(directory, "service", "starting", 300, timings);
            using var result = System.Text.Json.JsonDocument.Parse(File.ReadAllText(file!));
            Assert.Equal("service", result.RootElement.GetProperty("phase").GetString());
            Assert.Equal(300, result.RootElement.GetProperty("elapsedMs").GetDouble());
            Assert.Single(Directory.GetFiles(directory));
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true); }
    }
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
