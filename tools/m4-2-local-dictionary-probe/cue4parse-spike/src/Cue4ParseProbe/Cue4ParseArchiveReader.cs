using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Versions;

namespace Cue4ParseProbe;

public sealed class Cue4ParseArchiveReader : IArchiveReader
{
    public IReadOnlyList<string> ListVirtualPaths(string paksDirectory)
    {
        try
        {
            var provider = new DefaultFileProvider(
                paksDirectory,
                SearchOption.TopDirectoryOnly,
                new VersionContainer(EGame.GAME_InfinityNikki),
                StringComparer.OrdinalIgnoreCase);
            provider.Initialize();
            provider.LoadVirtualPaths();

            return provider.Files.Keys
                .Select(path => path.Replace('\\', '/'))
                .OrderBy(path => path, StringComparer.Ordinal)
                .ToArray();
        }
        catch (Exception error)
        {
            throw new ArchiveProbeException($"CUE4Parse archive mount failed: {error.GetType().Name}: {error.Message}", error);
        }
    }

    public IReadOnlyList<EvidenceHit> FindEntityReferences(string paksDirectory, IReadOnlyList<string> entityIds) =>
        throw new ArchiveProbeException("CUE4Parse entity-reference probing has not been implemented yet.");
}
