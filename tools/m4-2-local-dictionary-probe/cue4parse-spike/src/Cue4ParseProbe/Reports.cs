namespace Cue4ParseProbe;

public sealed record InventoryEntry(string VirtualPath, string ResourceKind, bool Candidate);

public sealed record EvidenceHit(
    string EntityId,
    string VirtualPath,
    string ObjectPath,
    string Field,
    string Value,
    string Confidence);
