namespace NikkiSync.WindowsShell.Services;

public static class DesktopProjectLinks
{
    // Web content supplies a name, never an arbitrary URL, executable or local file path.
    public static string? Resolve(string? name) => name switch
    {
        "momo" => "https://github.com/ToStardust/NikkiSync",
        "nikkiGallery" => "https://github.com/QianQianLuLu1/NikkiGallery",
        "nikkiAlbums" => "https://github.com/RanAxro/nikki_albums",
        "meowStarMap" => "https://github.com/QianQianLuLu1/MeowStarMap",
        "nuan5" => "https://nuan5.pro/",
        "gongeo" => "https://gongeo.us/",
        "releases" => DesktopRelease.ReleasesUrl,
        "downloads" => DesktopRelease.DownloadsUrl,
        "quark" => DesktopRelease.QuarkDownloadsUrl,
        "androidDirect" => DesktopRelease.AndroidDirectUrl,
        _ => null
    };
}
