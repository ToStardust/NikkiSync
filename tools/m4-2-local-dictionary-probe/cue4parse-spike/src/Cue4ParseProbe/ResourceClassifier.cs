namespace Cue4ParseProbe;

public sealed record ResourceClassification(string ResourceKind, bool Candidate);

public static class ResourceClassifier
{
    public static ResourceClassification Classify(string virtualPath)
    {
        var path = virtualPath.Replace('\\', '/');
        if (path.EndsWith(".locres", StringComparison.OrdinalIgnoreCase)) return new("localization", true);
        if (path.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) return new("json", true);
        if (path.EndsWith(".lua", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".luac", StringComparison.OrdinalIgnoreCase)) return new("lua", true);
        if (path.EndsWith(".ini", StringComparison.OrdinalIgnoreCase) || path.Contains("/Config/", StringComparison.OrdinalIgnoreCase)) return new("config", true);
        if (path.EndsWith(".bk2", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".wem", StringComparison.OrdinalIgnoreCase)) return new("media", false);
        if (path.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase) && path.Contains("StringTable", StringComparison.OrdinalIgnoreCase)) return new("string-table", true);
        if (path.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase) && (path.Contains("DataTable", StringComparison.OrdinalIgnoreCase) || path.Contains("/Data/", StringComparison.OrdinalIgnoreCase) || path.Contains("DT_", StringComparison.OrdinalIgnoreCase))) return new("data-table", true);
        return new("other", false);
    }
}
