namespace Cue4ParseProbe;

public interface IArchiveReader
{
    IReadOnlyList<string> ListVirtualPaths(string paksDirectory);
    IReadOnlyList<EvidenceHit> FindEntityReferences(string paksDirectory, IReadOnlyList<string> entityIds);
}
