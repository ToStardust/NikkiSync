using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace NikkiSync.WindowsShell.Services;

// Only allowlisted codes/hints cross from child output into the UI or a saved log.
// Bun exception output can contain source snippets, absolute paths and credentials.
public sealed record StartupFailure(string Code, string Hint, int? ExitCode = null)
{
    public string Message => $"{Hint}\n\n错误代码：{Code}" +
        (ExitCode is int code ? $"\n服务退出码：{code}（0x{unchecked((uint)code):X8}）" : "");

    public static StartupFailure Create(string code, int? exitCode = null) => new(code, code switch
    {
        "GAME_NOT_FOUND" => "已自动检查安装记录、快捷方式和常见游戏位置，仍未找到电脑版《无限暖暖》。无需打开游戏，可重新自动检测；备选方式是选择游戏或启动器安装文件夹。",
        "NO_LAN" => "没有可用的网络连接。请连接 Wi-Fi 或网线后重新打开 NikkiSync。",
        "PORT_IN_USE" => "同步服务端口被占用。请退出重复启动的 NikkiSync；仍失败时，把此错误代码反馈给开发者。",
        "FILE_ACCESS" => "服务无法读取或写入运行文件。请确认程序未被隔离、所在目录允许读取，以及当前用户的数据目录允许写入。",
        "FILE_BUSY" => "运行文件正被其他程序占用。请稍后重试；仍失败时反馈启动日志，不要删除照片或配对数据。",
        "DISK_FULL" => "准备运行文件时磁盘空间不足。请腾出用户数据所在磁盘的可用空间后重试。",
        "PATH_TOO_LONG" => "运行文件路径超过系统支持范围。请反馈启动日志，以便检查数据目录的位置。",
        "FILE_VALIDATION" => "运行文件校验未通过。请反馈启动日志，保留现有数据目录。",
        "MISSING_FILE" => "服务缺少所需的运行文件。请重新下载完整的 NikkiSync EXE 后启动。",
        "DATABASE_ERROR" => "本地数据库无法打开或读取。请反馈此错误代码，不要删除数据目录，以免丢失配对信息。",
        "CPU_INSTRUCTION" => "后台服务执行了这台 CPU 不支持的指令。请使用新版兼容包，并反馈 Windows 版本和 CPU 型号。",
        "NATIVE_DEPENDENCY" => "Windows 无法载入后台服务所需的系统组件。请反馈 Windows 版本和此错误代码。",
        "WRONG_ARCHITECTURE" => "Windows 无法运行此后台服务。当前包面向 64 位 Windows，请反馈系统版本和 CPU 型号。",
        "SERVICE_TIMEOUT" => "后台服务启动超时。首次扫描较大的相册可能耗时较长；请重新打开一次，仍失败时反馈此错误代码。",
        "WEBVIEW_MISSING" => "这台电脑缺少 Microsoft Edge WebView2。安装后重新打开 NikkiSync 即可，无需安装 .NET。",
        _ => "NikkiSync 启动未完成。请将下方错误代码或启动日志反馈给开发者。"
    }, exitCode);

    public static StartupFailure FromServiceExit(int? exitCode, string output)
    {
        if (exitCode == unchecked((int)0xC000001D)) return Create("CPU_INSTRUCTION", exitCode);
        if (exitCode == unchecked((int)0xC0000135)) return Create("NATIVE_DEPENDENCY", exitCode);
        foreach (var code in new[] { "GAME_NOT_FOUND", "NO_LAN", "PORT_IN_USE", "FILE_ACCESS", "MISSING_FILE", "DATABASE_ERROR" })
            if (output.Contains($"\"code\":\"{code}\"", StringComparison.Ordinal)) return Create(code, exitCode);
        // Older service builds have unstructured stderr.
        if (output.Contains("Infinity Nikki installation was not found", StringComparison.Ordinal)) return Create("GAME_NOT_FOUND", exitCode);
        if (output.Contains("未找到局域网 IPv4 地址", StringComparison.Ordinal)) return Create("NO_LAN", exitCode);
        if (output.Contains("EADDRINUSE", StringComparison.Ordinal)) return Create("PORT_IN_USE", exitCode);
        if (output.Contains("EACCES", StringComparison.Ordinal) || output.Contains("EPERM", StringComparison.Ordinal)) return Create("FILE_ACCESS", exitCode);
        if (output.Contains("ENOENT", StringComparison.Ordinal)) return Create("MISSING_FILE", exitCode);
        if (output.Contains("SQLITE_", StringComparison.Ordinal)) return Create("DATABASE_ERROR", exitCode);
        return Create("SERVICE_EXIT", exitCode);
    }

    public static StartupFailure FromException(Exception error) => error switch
    {
        ServiceStartException service => service.Failure,
        Win32Exception { NativeErrorCode: 193 } => Create("WRONG_ARCHITECTURE"),
        Win32Exception { NativeErrorCode: 126 } => Create("NATIVE_DEPENDENCY"),
        Win32Exception { NativeErrorCode: 2 or 3 } => Create("MISSING_FILE"),
        Win32Exception { NativeErrorCode: 5 } => Create("FILE_ACCESS"),
        UnauthorizedAccessException => Create("FILE_ACCESS"),
        PathTooLongException => Create("PATH_TOO_LONG"),
        InvalidDataException or JsonException => Create("FILE_VALIDATION"),
        IOException io when io.HResult is unchecked((int)0x80070020) or unchecked((int)0x80070021) => Create("FILE_BUSY"),
        IOException io when io.HResult is unchecked((int)0x80070070) or unchecked((int)0x80070027) => Create("DISK_FULL"),
        _ => Create("STARTUP_ERROR")
    };
}

public static class StartupDiagnostics
{
    public const string BuildLabel = "2026.10.12-startup-health";

    public static string? WriteTimings(string directory, string phase, string status, double elapsedMs, IReadOnlyDictionary<string, double> timings)
    {
        try
        {
            Directory.CreateDirectory(directory);
            var stages = new Dictionary<string, double>();
            foreach (var key in new[] { "runtimeReadyMs", "browserReadyMs", "serviceReadyMs", "dashboardReadyMs" })
                if (timings.TryGetValue(key, out var value) && double.IsFinite(value) && value >= 0) stages[key] = value;
            var file = Path.Combine(directory, "startup-timings.json");
            File.WriteAllText(file, JsonSerializer.Serialize(new
            {
                timestamp = DateTimeOffset.UtcNow, build = BuildLabel,
                phase = phase is "runtime" or "webview" or "service" or "dashboard" ? phase : "unknown",
                status = status is "starting" or "ready" or "failed" or "cancelled" ? status : "unknown",
                elapsedMs = double.IsFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : 0,
                stages
            }, new JsonSerializerOptions { WriteIndented = true }));
            return file;
        }
        catch (Exception writeError) when (writeError is IOException or UnauthorizedAccessException) { return null; }
    }
    public static string ExceptionKind(Exception error) => error switch
    {
        UnauthorizedAccessException => "access-denied",
        PathTooLongException => "path-too-long",
        FileNotFoundException => "file-not-found",
        DirectoryNotFoundException => "directory-not-found",
        InvalidDataException => "invalid-data",
        JsonException => "invalid-json",
        IOException => "io",
        Win32Exception => "win32",
        System.Security.SecurityException => "security",
        NotSupportedException => "not-supported",
        ArgumentException => "argument",
        OperationCanceledException => "cancelled",
        _ => "unknown"
    };

    public static string? Write(string directory, string phase, StartupFailure failure, Exception? error = null, PayloadPreparationStep? runtimeStep = null)
    {
        try
        {
            Directory.CreateDirectory(directory);
            var file = Path.Combine(directory, "startup-diagnostics.log");
            File.WriteAllText(file, JsonSerializer.Serialize(new
            {
                timestamp = DateTimeOffset.UtcNow, build = BuildLabel,
                appVersion = DesktopRelease.Version, appBuild = DesktopRelease.Build,
                phase = phase is "runtime" or "webview" or "service" or "dashboard" ? phase : "unknown",
                code = failure.Code, hint = failure.Hint, exitCode = failure.ExitCode,
                exceptionKind = error is null ? null : ExceptionKind(error),
                hresultHex = error is null ? null : $"0x{unchecked((uint)error.HResult):X8}",
                runtimeStep = phase == "runtime" && runtimeStep.HasValue && Enum.IsDefined(runtimeStep.Value) ? runtimeStep.Value.ToString() : null,
                exitCodeHex = failure.ExitCode is int code ? $"0x{unchecked((uint)code):X8}" : null,
                windows = Environment.OSVersion.VersionString,
                architecture = RuntimeInformation.OSArchitecture.ToString(),
                processArchitecture = RuntimeInformation.ProcessArchitecture.ToString()
            }, new JsonSerializerOptions { WriteIndented = true }));
            return file;
        }
        catch (Exception writeError) when (writeError is IOException or UnauthorizedAccessException) { return null; }
    }
}
