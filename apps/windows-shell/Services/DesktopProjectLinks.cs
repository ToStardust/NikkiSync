namespace NikkiSync.WindowsShell.Services;

public static class DesktopProjectLinks
{
    // Web content supplies a name, never an arbitrary URL, executable or local file path.
    public static string? Resolve(string? name) => name switch
    {
        "momo" => "https://github.com/ToStardust/NikkiSync",
        "nikkiGallery" => "https://github.com/QianQianLuLu1/NikkiGallery",
        "releases" => DesktopRelease.ReleasesUrl,
        _ => null
    };
}
