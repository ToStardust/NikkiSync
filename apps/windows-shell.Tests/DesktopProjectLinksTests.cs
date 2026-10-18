using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell.Tests;

public class DesktopProjectLinksTests
{
    [Theory]
    [InlineData("momo", "https://github.com/ToStardust/NikkiSync")]
    [InlineData("nikkiGallery", "https://github.com/QianQianLuLu1/NikkiGallery")]
    [InlineData("releases", "https://github.com/ToStardust/NikkiSync/releases")]
    public void ResolvesNamedProjectDestinations(string name,string expected) => Assert.Equal(expected,DesktopProjectLinks.Resolve(name));

    [Theory]
    [InlineData(null)] [InlineData("")] [InlineData("https://example.com/")] [InlineData("file:///C:/Windows/")]
    public void UnknownOrArbitraryAddressesCannotBeOpened(string? name) => Assert.Null(DesktopProjectLinks.Resolve(name));
}
