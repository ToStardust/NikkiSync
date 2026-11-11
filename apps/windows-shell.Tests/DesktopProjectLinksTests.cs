using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell.Tests;

public class DesktopProjectLinksTests
{
    [Theory]
    [InlineData("momo", "https://github.com/ToStardust/NikkiSync")]
    [InlineData("nikkiGallery", "https://github.com/QianQianLuLu1/NikkiGallery")]
    [InlineData("nikkiAlbums", "https://github.com/RanAxro/nikki_albums")]
    [InlineData("meowStarMap", "https://github.com/QianQianLuLu1/MeowStarMap")]
    [InlineData("nuan5", "https://nuan5.pro/")]
    [InlineData("gongeo", "https://gongeo.us/")]
    [InlineData("releases", "https://github.com/ToStardust/NikkiSync/releases")]
    [InlineData("downloads", "https://pan.baidu.com/s/5bb_o2A8iJ2MR4f_hRBlPCw")]
    [InlineData("quark", "https://pan.quark.cn/s/3d5a764a196c")]
    [InlineData("androidDirect", "https://cnb.cool/nikkisync/icon-packs/-/releases/download/android-update-test/MomoCamera-Android-1.0.39.apk")]
    public void ResolvesNamedProjectDestinations(string name,string expected) => Assert.Equal(expected,DesktopProjectLinks.Resolve(name));

    [Theory]
    [InlineData(null)] [InlineData("")] [InlineData("https://example.com/")] [InlineData("file:///C:/Windows/")]
    public void UnknownOrArbitraryAddressesCannotBeOpened(string? name) => Assert.Null(DesktopProjectLinks.Resolve(name));
}
