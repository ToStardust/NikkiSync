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

    [Fact]
    public void Updated_or_moved_executable_refreshes_existing_startup_entry()
    {
        var store = new MemoryRunEntryStore { Value = "\"C:\\Old\\MomoCamera-PC-1.0.21.exe\"" };
        var service = new AutostartService(store);
        service.RefreshEnabledPath(@"C:\New Folder\MomoCamera-PC-1.0.22.exe");
        Assert.Equal("\"C:\\New Folder\\MomoCamera-PC-1.0.22.exe\"", store.Value);
        Assert.True(service.IsEnabledFor(@"C:\New Folder\MomoCamera-PC-1.0.22.exe"));
        Assert.False(service.IsEnabledFor(@"C:\Old\MomoCamera-PC-1.0.21.exe"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void Starting_new_version_does_not_enable_previously_disabled_autostart(string? value)
    {
        var store = new MemoryRunEntryStore { Value = value };
        var service = new AutostartService(store);
        service.RefreshEnabledPath(@"C:\New\MomoCamera-PC.exe");
        Assert.Equal(value, store.Value);
        Assert.False(service.IsEnabledFor(@"C:\New\MomoCamera-PC.exe"));
    }

    [Fact]
    public void Current_entry_is_not_rewritten_on_every_launch()
    {
        var store = new MemoryRunEntryStore { Value = "\"C:\\New\\MomoCamera-PC.exe\"" };
        store.Writes = 0;
        var service = new AutostartService(store);
        service.RefreshEnabledPath(@"C:\New\MomoCamera-PC.exe");
        Assert.Equal(0, store.Writes);
    }

    [Fact]
    public void Failed_refresh_does_not_report_stale_entry_as_current()
    {
        var store = new MemoryRunEntryStore { Value = "\"C:\\Old\\MomoCamera-PC.exe\"", FailWrites = true };
        var service = new AutostartService(store);
        Assert.Throws<UnauthorizedAccessException>(() => service.RefreshEnabledPath(@"C:\New\MomoCamera-PC.exe"));
        Assert.False(service.IsEnabledFor(@"C:\New\MomoCamera-PC.exe"));
    }

    [Theory]
    [InlineData("relative.exe")]
    [InlineData("C:\\New\\app.exe\" --other")]
    [InlineData("C:\\New\\app.exe\n")]
    public void Invalid_path_cannot_replace_existing_registration(string path)
    {
        var store = new MemoryRunEntryStore { Value = "old" };
        var service = new AutostartService(store);
        Assert.Throws<ArgumentException>(() => service.RefreshEnabledPath(path));
        Assert.Equal("old", store.Value);
    }

    private sealed class MemoryRunEntryStore : IRunEntryStore
    {
        private string? _value;
        public int Writes;
        public bool FailWrites;
        public string? Value
        {
            get => _value;
            set { if (FailWrites) throw new UnauthorizedAccessException(); _value = value; Writes++; }
        }
    }
}
