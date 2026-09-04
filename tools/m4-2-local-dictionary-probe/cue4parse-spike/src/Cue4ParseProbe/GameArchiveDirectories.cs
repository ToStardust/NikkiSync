namespace Cue4ParseProbe;

public static class GameArchiveDirectories
{
    private static readonly string[] RelativeDirectories =
    [
        Path.Combine("Content", "Paks"),
        Path.Combine("Saved", "Paks"),
        Path.Combine("Saved", "FastPatchPaks")
    ];

    public static IReadOnlyList<string> Discover(string gameRoot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(gameRoot);
        var fullRoot = Path.GetFullPath(gameRoot);
        if (!Directory.Exists(fullRoot)) throw new DirectoryNotFoundException($"game root does not exist: {fullRoot}");

        return RelativeDirectories
            .Select(relative => Path.Combine(fullRoot, relative))
            .Where(Directory.Exists)
            .ToArray();
    }
}
