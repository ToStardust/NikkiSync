using System.Text;
using System.Text.Json;

namespace NikkiSync.WindowsShell.Services;

// The child protocol contains aggregate work only. Never forward arbitrary child text to the UI.
public sealed record ScanStartupProgress(string Stage, long FilesObserved, long FilesCompleted, long BytesRead, long AssetsProcessed)
{
    public int StageOrder => Stage switch { "scan-files" => 0, "scan-index" => 1, "scan-watch" => 2, _ => -1 };
    public bool IsValid => StageOrder >= 0 && FilesObserved is >= 0 and <= int.MaxValue
        && FilesCompleted >= 0 && FilesCompleted <= FilesObserved
        && BytesRead is >= 0 and <= 9007199254740991L && AssetsProcessed is >= 0 and <= int.MaxValue;

    public static bool TryParse(string line, out ScanStartupProgress? progress)
    {
        progress = null;
        if (line.Length > 1024) return false;
        try
        {
            using var document = JsonDocument.Parse(line);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var type)
                || type.ValueKind != JsonValueKind.String || type.GetString() != "nikkisync-startup-progress"
                || !root.TryGetProperty("stage", out var stage) || stage.ValueKind != JsonValueKind.String) return false;
            static bool Count(JsonElement root, string key, out long count)
            { count = 0; return root.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out count); }
            if (!Count(root, "filesObserved", out var observed) || !Count(root, "filesCompleted", out var completed)
                || !Count(root, "bytesRead", out var bytes) || !Count(root, "assetsProcessed", out var assets)) return false;
            var candidate = new ScanStartupProgress(stage.GetString()!, observed, completed, bytes, assets);
            if (!candidate.IsValid) return false;
            progress = candidate; return true;
        }
        catch (JsonException) { return false; }
    }
}

public sealed class ScanStartupProgressReader
{
    private readonly StringBuilder _line = new();
    private bool _discard;
    public ScanStartupProgress? Latest { get; private set; }
    public void Append(ReadOnlySpan<char> text)
    {
        foreach (var character in text)
        {
            if (character == '\n')
            {
                if (!_discard && ScanStartupProgress.TryParse(_line.ToString(), out var value)) Latest = value;
                _line.Clear(); _discard = false;
            }
            else if (!_discard)
            {
                if (_line.Length == 1024) { _line.Clear(); _discard = true; }
                else _line.Append(character);
            }
        }
    }
}

public sealed class ScanStartupWatchdog(TimeSpan idleTimeout, TimeSpan maximumWait)
{
    private TimeSpan _deadline = idleTimeout < maximumWait ? idleTimeout : maximumWait;
    private ScanStartupProgress? _last;

    public bool Observe(ScanStartupProgress value, TimeSpan elapsed)
    {
        if (!value.IsValid || Remaining(elapsed) <= TimeSpan.Zero) return false;
        if (_last is { } last && (value.StageOrder < last.StageOrder || value.FilesObserved < last.FilesObserved
            || value.FilesCompleted < last.FilesCompleted || value.BytesRead < last.BytesRead
            || value.AssetsProcessed < last.AssetsProcessed || value == last)) return false;
        _last = value;
        var renewed = elapsed + idleTimeout;
        _deadline = renewed < maximumWait ? renewed : maximumWait;
        return true;
    }

    public TimeSpan Remaining(TimeSpan elapsed) => _deadline > elapsed ? _deadline - elapsed : TimeSpan.Zero;
}
