using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell.Tests;

public sealed class AutostartServiceTests
{
    [Fact]
    public void SetEnabled_writes_a_quoted_current_user_executable_path()
    {
        var store = new MemoryRunEntryStore();
        var service = new AutostartService(store);

        service.SetEnabled(true, @"C:\Program Files\NikkiSync\NikkiSync-PC.exe");

        Assert.True(service.IsEnabled());
        Assert.Equal("\"C:\\Program Files\\NikkiSync\\NikkiSync-PC.exe\"", store.Value);
    }

    [Fact]
    public void SetEnabled_false_removes_the_current_user_entry()
    {
        var store = new MemoryRunEntryStore { Value = "old" };
        var service = new AutostartService(store);

        service.SetEnabled(false, @"C:\NikkiSync-PC.exe");

        Assert.False(service.IsEnabled());
        Assert.Null(store.Value);
    }

    private sealed class MemoryRunEntryStore : IRunEntryStore
    {
        public string? Value { get; set; }
    }
}
