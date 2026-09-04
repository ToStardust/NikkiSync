using System.Text.Json;

namespace Cue4ParseProbe;

public sealed record InventoryReport(
    int SchemaVersion,
    DateTimeOffset GeneratedAtUtc,
    PaksFingerprint InputFingerprint,
    string ArchiveReader,
    IReadOnlyList<InventoryEntry> Entries,
    IReadOnlyList<string> Diagnostics);

public sealed class ProbeRunner(IArchiveReader reader)
{
    public InventoryReport Run(ProbeRequest request)
    {
        if (request.Command != ProbeCommand.Inventory) throw new ArgumentException("ProbeRunner inventory run requires inventory command", nameof(request));
        var before = PaksDirectory.ValidateAndFingerprint(request.PaksDirectory);
        var entries = reader.ListVirtualPaths(request.PaksDirectory)
            .Select(path =>
            {
                var classification = ResourceClassifier.Classify(path);
                return new InventoryEntry(path, classification.ResourceKind, classification.Candidate);
            })
            .Where(entry => entry.Candidate)
            .OrderBy(entry => entry.VirtualPath, StringComparer.Ordinal)
            .ToArray();
        PaksDirectory.VerifyUnchanged(request.PaksDirectory, before);

        var report = new InventoryReport(1, DateTimeOffset.UtcNow, before, reader.GetType().Name, entries, []);
        Directory.CreateDirectory(request.OutputDirectory);
        var reportPath = Path.Combine(request.OutputDirectory, "inventory-report.json");
        File.WriteAllText(reportPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        return report;
    }
}
