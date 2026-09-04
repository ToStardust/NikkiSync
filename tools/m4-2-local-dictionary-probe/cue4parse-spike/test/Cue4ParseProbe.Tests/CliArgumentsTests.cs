using Cue4ParseProbe;
using Xunit;

namespace Cue4ParseProbe.Tests;

public sealed class CliArgumentsTests
{
    [Fact]
    public void Inventory_parses_a_paks_directory_and_default_output_directory()
    {
        var result = InvokeTryParse(["inventory", @"D:\Game\X6Game\Content\Paks"], @"D:\tool");

        Assert.True(result.Success, result.Error);
        Assert.NotNull(result.Request);
        Assert.Equal("Inventory", result.Request!.GetType().GetProperty("Command")!.GetValue(result.Request)!.ToString());
        Assert.Equal(@"D:\tool\out", result.Request.GetType().GetProperty("OutputDirectory")!.GetValue(result.Request));
    }

    [Fact]
    public void Probe_rejects_a_non_ten_digit_id()
    {
        var result = InvokeTryParse(["probe", @"D:\Game\X6Game\Content\Paks", "not-an-id"], @"D:\tool");

        Assert.False(result.Success);
        Assert.Contains("10-digit", result.Error);
    }

    private static (bool Success, object? Request, string? Error) InvokeTryParse(string[] args, string workingDirectory)
    {
        var type = typeof(ProgramAnchor).Assembly.GetType("Cue4ParseProbe.CliArguments");
        var method = type?.GetMethod("TryParse");
        Assert.NotNull(method);
        object?[] call = [args, workingDirectory, null, null];
        var success = Assert.IsType<bool>(method!.Invoke(null, call));
        return (success, call[2], call[3] as string);
    }
}
