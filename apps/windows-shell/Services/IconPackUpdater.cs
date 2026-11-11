using System.IO;
using System.IO.Compression;
using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace NikkiSync.WindowsShell.Services;

public sealed record IconUpdateFeed(int Schema, string AppId, string BaseManifestSha256,
    string TargetManifestSha256, string DownloadUrl, string Sha256, int Size);
public sealed record IconCatalogDelta(string BaseVersion, string TargetVersion, string BaseManifestSha256,
    string TargetManifestSha256, string DownloadUrl, string Sha256, int Size);
public sealed record IconUpdateCatalog(int Schema, string AppId, string LatestVersion,
    string LatestManifestSha256, IconCatalogDelta[] Deltas);

/// <summary>Downloads signed icon deltas and prepares a verified snapshot for activation.</summary>
public sealed class IconPackUpdater
{
    public const string InitialPackFileName = "NikkiSync-Icons-full.zip";
    public const string InitialPackResource = "NikkiSync.Icons.Full.zip";
    private const long InitialPackSize = 77678905;
    private const string InitialPackSha256 = "ddd70fbf87ebeb9722e37365a76a5d159951f1104c2e378578316e884e840b4f";
    private const string InitialManifestSha256 = "c39e0f672867c7ee59fe9f7865510d95a0f2bbbf6d47f56a21f9a95e134752f0";
    private const int MaxPackage = 128 * 1024 * 1024;
    private const int MaxManifest = 4 * 1024 * 1024;
    private const int MaxIcon = 256 * 1024;
    private const int MaxDeltas = 512;
    private static readonly Regex IconPath = new(
        @"^(icons/[1-9][0-9]{0,11}|fallbacks/[0-9a-f]{64}|effects/(pose|lighting)-[1-9][0-9]{0,11})\.webp\z",
        RegexOptions.CultureInvariant);
    private readonly string _active;
    private readonly string _work;
    private readonly string _publicKey;
    private readonly Func<string, int, CancellationToken, Task<byte[]>> _download;

    public IconPackUpdater(string dataDirectory, string publicKey,
        Func<string, int, CancellationToken, Task<byte[]>> download)
    {
        _active = Path.Combine(dataDirectory, "clothing-icons");
        _work = Path.Combine(dataDirectory, "icon-updates");
        _publicKey = publicKey;
        _download = download;
    }

    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static bool ValidHash(string? value) =>
        value is { Length: 64 } && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');

    /// <summary>Supports an older sidecar package while the one-file build embeds the same ZIP.</summary>
    public bool InstallInitialPack(string sidecarPath, CancellationToken token)
    {
        if (!File.Exists(sidecarPath) || Directory.Exists(_active)) return false;
        if ((File.GetAttributes(sidecarPath) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("Initial icon pack is a link.");
        using var source = File.OpenRead(sidecarPath);
        return InstallInitialPack(source, token);
    }

    /// <summary>Verifies and installs the embedded r3 full pack once, without a second download.</summary>
    public bool InstallInitialPack(Stream source, CancellationToken token)
    {
        if (Directory.Exists(_active)) return false;
        if (!source.CanSeek || source.Length != InitialPackSize)
            throw new InvalidDataException("Initial icon pack download failed verification.");
        source.Position = 0;
        if (Convert.ToHexString(SHA256.HashData(source)).ToLowerInvariant() != InitialPackSha256)
            throw new InvalidDataException("Initial icon pack download failed verification.");
        source.Position = 0;
        token.ThrowIfCancellationRequested();
        Directory.CreateDirectory(_work);
        if ((File.GetAttributes(_work) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("Icon update directory is a link.");
        using var gate = new FileStream(Path.Combine(_work, "update.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        if (Directory.Exists(_active)) return false;
        string job = Path.Combine(_work, Guid.NewGuid().ToString("N"));
        string candidate = Path.Combine(job, "candidate");
        Directory.CreateDirectory(candidate);
        try
        {
            using var zip = new ZipArchive(source, ZipArchiveMode.Read, leaveOpen: true);
            if (zip.Entries.Count is < 1 or > 30000) throw new InvalidDataException("Invalid initial icon pack.");
            foreach (var entry in zip.Entries)
            {
                token.ThrowIfCancellationRequested();
                if ((entry.FullName != "manifest.json" && !IconPath.IsMatch(entry.FullName))
                    || entry.Length > (entry.FullName == "manifest.json" ? MaxManifest : MaxIcon))
                    throw new InvalidDataException("Initial icon pack contains an invalid file.");
            }
            zip.ExtractToDirectory(candidate);
            VerifySnapshot(candidate, InitialManifestSha256);
            token.ThrowIfCancellationRequested();
            Directory.Move(candidate, _active);
            return true;
        }
        finally
        {
            string fullJob = Path.GetFullPath(job);
            string fullWork = Path.GetFullPath(_work) + Path.DirectorySeparatorChar;
            if (fullJob.StartsWith(fullWork, StringComparison.OrdinalIgnoreCase) && Directory.Exists(fullJob))
                Directory.Delete(fullJob, true);
        }
    }

    private JsonDocument VerifySignedDocument(byte[] bytes, byte[] signature)
    {
        if (bytes.Length is 0 or > 524288 || signature.Length is < 128 or > 1024)
            throw new CryptographicException("Invalid icon update signature.");
        using var rsa = RSA.Create();
        rsa.ImportFromPem(_publicKey);
        if (!rsa.VerifyData(bytes, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))
            throw new CryptographicException("Invalid icon update signature.");
        return JsonDocument.Parse(bytes);
    }

    private static void ValidateDelta(IconUpdateFeed feed)
    {
        if (feed.Schema != 1 || feed.AppId != "NikkiSync.Icons" || !ValidHash(feed.BaseManifestSha256)
            || !ValidHash(feed.TargetManifestSha256) || feed.BaseManifestSha256 == feed.TargetManifestSha256
            || !ValidHash(feed.Sha256) || feed.Size is <= 0 or > MaxPackage)
            throw new InvalidDataException("Invalid icon update feed.");
        UpdateHttp.RequireHttps(new Uri(feed.DownloadUrl));
    }

    private static IconUpdateFeed VerifyFeed(JsonElement root)
    {
        var feed = root.Deserialize<IconUpdateFeed>() ?? throw new InvalidDataException("Invalid icon update feed.");
        ValidateDelta(feed);
        return feed;
    }

    private static IconUpdateCatalog VerifyCatalog(JsonElement root)
    {
        var catalog = root.Deserialize<IconUpdateCatalog>() ?? throw new InvalidDataException("Invalid icon update catalog.");
        if (catalog.Schema != 2 || catalog.AppId != "NikkiSync.Icons" || !ValidHash(catalog.LatestManifestSha256)
            || string.IsNullOrWhiteSpace(catalog.LatestVersion) || catalog.LatestVersion.Length > 80
            || catalog.Deltas is not { Length: > 0 and <= MaxDeltas })
            throw new InvalidDataException("Invalid icon update catalog.");
        var visited = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 0; i < catalog.Deltas.Length; i++)
        {
            var item = catalog.Deltas[i];
            if (item is null || string.IsNullOrWhiteSpace(item.BaseVersion) || item.BaseVersion.Length > 80
                || string.IsNullOrWhiteSpace(item.TargetVersion) || item.TargetVersion.Length > 80)
                throw new InvalidDataException("Invalid icon update version.");
            ValidateDelta(new IconUpdateFeed(1, catalog.AppId, item.BaseManifestSha256,
                item.TargetManifestSha256, item.DownloadUrl, item.Sha256, item.Size));
            if (i > 0 && (catalog.Deltas[i - 1].TargetManifestSha256 != item.BaseManifestSha256
                    || catalog.Deltas[i - 1].TargetVersion != item.BaseVersion))
                throw new InvalidDataException("Icon update chain is not continuous.");
            if (!visited.Add(item.BaseManifestSha256) || visited.Contains(item.TargetManifestSha256))
                throw new InvalidDataException("Icon update chain contains a cycle.");
        }
        var last = catalog.Deltas[^1];
        if (last.TargetManifestSha256 != catalog.LatestManifestSha256 || last.TargetVersion != catalog.LatestVersion)
            throw new InvalidDataException("Icon update latest version mismatch.");
        return catalog;
    }

    private static IconUpdateFeed[] Plan(JsonElement root, string current)
    {
        if (root.TryGetProperty("Deltas", out _))
        {
            var catalog = VerifyCatalog(root);
            if (current == catalog.LatestManifestSha256) return [];
            int start = Array.FindIndex(catalog.Deltas, item => item.BaseManifestSha256 == current);
            if (start < 0) return [];
            return catalog.Deltas[start..].Select(item => new IconUpdateFeed(1, catalog.AppId,
                item.BaseManifestSha256, item.TargetManifestSha256, item.DownloadUrl, item.Sha256, item.Size)).ToArray();
        }
        var feed = VerifyFeed(root);
        return current == feed.BaseManifestSha256 ? [feed] : [];
    }

    public async Task<bool> CheckWithRetryAsync(string feedUrl, CancellationToken token,
        Func<CancellationToken, Task>? retryDelay = null)
    {
        for (int attempt = 0; ; attempt++)
        {
            token.ThrowIfCancellationRequested();
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
                timeout.CancelAfter(TimeSpan.FromMinutes(20));
                return await CheckAndStageAsync(feedUrl, timeout.Token);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch when (attempt < 2)
            {
                if (retryDelay is null) await Task.Delay(TimeSpan.FromSeconds(30), token);
                else await retryDelay(token);
            }
        }
    }

    public async Task<bool> CheckAndStageAsync(string feedUrl, CancellationToken token)
    {
        UpdateHttp.RequireHttps(new Uri(feedUrl));
        if (!File.Exists(Path.Combine(_active, "manifest.json"))) return false;
        byte[] feedBytes = await _download(feedUrl, 524288, token);
        byte[] signature = await _download(feedUrl + ".sig", 1024, token);
        using var document = VerifySignedDocument(feedBytes, signature);
        string current = Hash(await File.ReadAllBytesAsync(Path.Combine(_active, "manifest.json"), token));
        var plan = Plan(document.RootElement, current);
        if (plan.Length == 0) return false;

        Directory.CreateDirectory(_work);
        if ((File.GetAttributes(_work) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("Icon update directory is a link.");
        using var gate = new FileStream(Path.Combine(_work, "update.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        string id = Guid.NewGuid().ToString("N");
        string job = Path.Combine(_work, id);
        string candidate = Path.Combine(job, "candidate");
        Directory.CreateDirectory(candidate);
        try
        {
            CopyTree(_active, candidate, token);
            foreach (var feed in plan)
            {
                token.ThrowIfCancellationRequested();
                byte[] package = await _download(feed.DownloadUrl, feed.Size, token);
                if (package.Length != feed.Size || Hash(package) != feed.Sha256)
                    throw new InvalidDataException("Icon update download failed verification.");
                ApplyPackage(candidate, package, feed);
                VerifySnapshot(candidate, feed.TargetManifestSha256);
            }
            await File.WriteAllBytesAsync(Path.Combine(job, "feed.json"), feedBytes, token);
            await File.WriteAllBytesAsync(Path.Combine(job, "feed.sig"), signature, token);
            string pointer = Path.Combine(_work, "ready.txt");
            string pointerTemp = Path.Combine(_work, "ready-" + id + ".tmp");
            await File.WriteAllTextAsync(pointerTemp, id, token);
            File.Move(pointerTemp, pointer, true);
            return true;
        }
        catch
        {
            // This is a freshly created GUID directory under the updater's own root.
            string fullJob = Path.GetFullPath(job);
            string fullWork = Path.GetFullPath(_work) + Path.DirectorySeparatorChar;
            if (fullJob.StartsWith(fullWork, StringComparison.OrdinalIgnoreCase) && Directory.Exists(fullJob))
                Directory.Delete(fullJob, true);
            throw;
        }
    }

    public bool ActivatePrepared()
    {
        if (!Directory.Exists(_work)) return false;
        if ((File.GetAttributes(_work) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("Icon update directory is a link.");
        using var gate = new FileStream(Path.Combine(_work, "update.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        string pointer = Path.Combine(_work, "ready.txt");
        if (!File.Exists(pointer)) return false;
        string id = File.ReadAllText(pointer).Trim();
        if (!Regex.IsMatch(id, "^[a-f0-9]{32}$")) throw new InvalidDataException("Invalid icon update state.");
        string job = Path.Combine(_work, id);
        string backup = Path.Combine(job, "previous");
        string candidate = Path.Combine(job, "candidate");
        if ((File.GetAttributes(job) & FileAttributes.ReparsePoint) != 0
            || (Directory.Exists(backup) && (File.GetAttributes(backup) & FileAttributes.ReparsePoint) != 0)
            || (Directory.Exists(candidate) && (File.GetAttributes(candidate) & FileAttributes.ReparsePoint) != 0))
            throw new InvalidDataException("Icon update snapshot is a link.");
        if (!Directory.Exists(_active) && Directory.Exists(backup)) Directory.Move(backup, _active);
        using var document = VerifySignedDocument(File.ReadAllBytes(Path.Combine(job, "feed.json")),
            File.ReadAllBytes(Path.Combine(job, "feed.sig")));
        if (!Directory.Exists(_active)) return false;
        string current = Hash(File.ReadAllBytes(Path.Combine(_active, "manifest.json")));
        var plan = Plan(document.RootElement, current);
        if (plan.Length == 0) { File.Delete(pointer); return false; }
        if (!Directory.Exists(candidate) || Directory.Exists(backup)) return false;
        VerifySnapshot(candidate, plan[^1].TargetManifestSha256);
        Directory.Move(_active, backup);
        try { Directory.Move(candidate, _active); }
        catch { Directory.Move(backup, _active); throw; }
        File.Delete(pointer);
        try { PruneOldJobs(id); }
        catch (IOException) { /* Cleanup must not turn a successful activation into a failure. */ }
        catch (UnauthorizedAccessException) { }
        return true;
    }

    private void PruneOldJobs(string keepId)
    {
        string fullWork = Path.GetFullPath(_work) + Path.DirectorySeparatorChar;
        foreach (string path in Directory.EnumerateDirectories(_work))
        {
            string name = Path.GetFileName(path);
            string full = Path.GetFullPath(path);
            if (name == keepId || !Regex.IsMatch(name, "^[a-f0-9]{32}$")
                || !full.StartsWith(fullWork, StringComparison.OrdinalIgnoreCase)
                || (File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0) continue;
            try { Directory.Delete(full, true); }
            catch (IOException) { /* A prior snapshot can be retried for cleanup later. */ }
            catch (UnauthorizedAccessException) { }
        }
    }

    private static void CopyTree(string source, string destination, CancellationToken token)
    {
        if ((File.GetAttributes(source) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("Icon pack contains a link.");
        foreach (string entry in Directory.EnumerateFileSystemEntries(source))
        {
            token.ThrowIfCancellationRequested();
            var attributes = File.GetAttributes(entry);
            if ((attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Icon pack contains a link.");
            string dest = Path.Combine(destination, Path.GetFileName(entry));
            if ((attributes & FileAttributes.Directory) != 0) { Directory.CreateDirectory(dest); CopyTree(entry, dest, token); }
            else File.Copy(entry, dest);
        }
    }

    private static byte[] ReadEntry(ZipArchiveEntry entry, int limit)
    {
        if (entry.Length < 0 || entry.Length > limit) throw new InvalidDataException("Icon update entry is too large.");
        using var stream = entry.Open();
        using var result = new MemoryStream();
        var buffer = new byte[8192];
        int read;
        while ((read = stream.Read(buffer)) > 0)
        {
            if (result.Length + read > limit) throw new InvalidDataException("Icon update entry is too large.");
            result.Write(buffer, 0, read);
        }
        if (result.Length != entry.Length) throw new InvalidDataException("Incomplete icon update entry.");
        return result.ToArray();
    }

    private static void ApplyPackage(string candidate, byte[] package, IconUpdateFeed feed)
    {
        using var memory = new MemoryStream(package);
        using var zip = new ZipArchive(memory, ZipArchiveMode.Read);
        if (zip.Entries.Count is < 2 or > 30002) throw new InvalidDataException("Invalid icon update archive.");
        var entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in zip.Entries)
            if (!entries.TryAdd(entry.FullName, entry)) throw new InvalidDataException("Duplicate icon update entry.");
        if (!entries.Remove("update.json", out var updateEntry) || !entries.Remove("manifest.json", out var manifestEntry))
            throw new InvalidDataException("Missing icon update metadata.");
        byte[] manifest = ReadEntry(manifestEntry, MaxManifest);
        if (Hash(manifest) != feed.TargetManifestSha256) throw new InvalidDataException("Target manifest mismatch.");
        using var update = JsonDocument.Parse(ReadEntry(updateEntry, MaxManifest));
        var data = update.RootElement;
        if (data.GetProperty("schemaVersion").GetInt32() != 1
            || data.GetProperty("baseManifestSha256").GetString() != feed.BaseManifestSha256
            || data.GetProperty("targetManifestSha256").GetString() != feed.TargetManifestSha256)
            throw new InvalidDataException("Delta metadata mismatch.");
        var files = data.GetProperty("files");
        if (files.GetArrayLength() != entries.Count) throw new InvalidDataException("Unexpected delta entries.");
        foreach (var file in files.EnumerateArray())
        {
            string name = file.GetProperty("path").GetString() ?? "";
            string digest = file.GetProperty("sha256").GetString() ?? "";
            if (!IconPath.IsMatch(name) || !ValidHash(digest) || !entries.Remove(name, out var entry))
                throw new InvalidDataException("Invalid delta file.");
            byte[] image = ReadEntry(entry, MaxIcon);
            if (image.Length != file.GetProperty("size").GetInt32() || Hash(image) != digest)
                throw new InvalidDataException("Delta file hash mismatch.");
            string destination = Path.Combine(candidate, name.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            File.WriteAllBytes(destination, image);
        }
        if (entries.Count != 0) throw new InvalidDataException("Unexpected delta files.");
        File.WriteAllBytes(Path.Combine(candidate, "manifest.json"), manifest);
    }

    private static void VerifySnapshot(string candidate, string expectedManifest)
    {
        byte[] manifest = File.ReadAllBytes(Path.Combine(candidate, "manifest.json"));
        if (manifest.Length > MaxManifest || Hash(manifest) != expectedManifest)
            throw new InvalidDataException("Icon snapshot manifest mismatch.");
        using var json = JsonDocument.Parse(manifest);
        string? version = json.RootElement.GetProperty("version").GetString();
        string? source = json.RootElement.GetProperty("source").GetString();
        if (json.RootElement.GetProperty("schemaVersion").GetInt32() != 2
            || json.RootElement.GetProperty("imageFormat").GetString() != "webp"
            || string.IsNullOrWhiteSpace(version) || version.Length > 80
            || string.IsNullOrWhiteSpace(source) || source.Length > 512
            || !json.RootElement.TryGetProperty("entries", out _))
            throw new InvalidDataException("Invalid icon snapshot manifest.");
        var seen = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var effectKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (string kind in new[] { "entries", "fallbackEntries", "effectEntries" })
        {
            if (!json.RootElement.TryGetProperty(kind, out var list)) continue;
            if (list.GetArrayLength() > 30000) throw new InvalidDataException("Too many icon entries.");
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in list.EnumerateArray())
            {
                string id = item.GetProperty("id").GetString() ?? "";
                string file = item.GetProperty("file").GetString() ?? "";
                string hash = item.GetProperty("sha256").GetString() ?? "";
                string effectKind = kind == "effectEntries" ? item.GetProperty("kind").GetString() ?? "" : "";
                string expected = kind switch {
                    "entries" => "icons/" + id + ".webp",
                    "fallbackEntries" => "fallbacks/" + hash + ".webp",
                    _ => "effects/" + effectKind + "-" + id + ".webp"
                };
                if (!Regex.IsMatch(id, @"^[1-9][0-9]{0,11}\z") || (kind != "effectEntries" && !ids.Add(id))
                    || !IconPath.IsMatch(file)
                    || file != expected || !ValidHash(hash)
                    || item.GetProperty("width").GetInt32() is < 1 or > 192
                    || item.GetProperty("height").GetInt32() is < 1 or > 192
                    || item.GetProperty("sizeBytes").GetInt32() is < 25 or > MaxIcon)
                    throw new InvalidDataException("Invalid icon snapshot entry.");
                if (kind == "effectEntries")
                {
                    if (!effectKeys.Add(effectKind + ":" + id)) throw new InvalidDataException("Duplicate effect ID.");
                    if (item.TryGetProperty("aliases", out var aliases))
                    {
                        if (aliases.GetArrayLength() > 8) throw new InvalidDataException("Too many effect aliases.");
                        foreach (var aliasValue in aliases.EnumerateArray())
                        {
                            string alias = aliasValue.GetString() ?? "";
                            if (!Regex.IsMatch(alias, @"^[A-Za-z][A-Za-z0-9_]{0,79}\z")
                                || !effectKeys.Add(effectKind + ":" + alias))
                                throw new InvalidDataException("Invalid effect alias.");
                        }
                    }
                }
                if (seen.TryGetValue(file, out string? previous))
                {
                    if (previous != hash) throw new InvalidDataException("Conflicting icon snapshot entry.");
                    continue;
                }
                seen.Add(file, hash);
                string path = Path.Combine(candidate, file.Replace('/', Path.DirectorySeparatorChar));
                if ((File.GetAttributes(Path.GetDirectoryName(path)!) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidDataException("Icon snapshot contains a link.");
                var info = new FileInfo(path);
                if (!info.Exists || info.Length != item.GetProperty("sizeBytes").GetInt32()
                    || (info.Attributes & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidDataException("Icon snapshot file mismatch.");
                byte[] image = File.ReadAllBytes(path);
                if (Hash(image) != hash || !ValidWebP(image, item.GetProperty("width").GetInt32(), item.GetProperty("height").GetInt32()))
                    throw new InvalidDataException("Invalid icon snapshot image.");
            }
        }
    }

    private static bool ValidWebP(byte[] bytes, int width, int height)
    {
        if (bytes.Length < 25 || Encoding.ASCII.GetString(bytes, 0, 4) != "RIFF"
            || BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(4, 4)) != bytes.Length - 8
            || Encoding.ASCII.GetString(bytes, 8, 4) != "WEBP") return false;
        bool frame = false, extended = false;
        for (int offset = 12; offset < bytes.Length;)
        {
            if (offset + 8 > bytes.Length) return false;
            string chunk = Encoding.ASCII.GetString(bytes, offset, 4);
            uint size = BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(offset + 4, 4));
            int start = offset + 8;
            long end = (long)start + size + size % 2;
            if (end > bytes.Length || chunk is "ANIM" or "ANMF") return false;
            offset = (int)end;
            if (chunk == "VP8X")
            {
                if (extended || size != 10 || (bytes[start] & 2) != 0
                    || 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16) != width
                    || 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16) != height) return false;
                extended = true;
            }
            else if (chunk is "VP8 " or "VP8L")
            {
                if (frame) return false;
                int imageWidth, imageHeight;
                if (chunk == "VP8 ")
                {
                    if (size < 10 || bytes[start + 3] != 0x9d || bytes[start + 4] != 0x01 || bytes[start + 5] != 0x2a) return false;
                    imageWidth = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(start + 6, 2)) & 0x3fff;
                    imageHeight = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(start + 8, 2)) & 0x3fff;
                }
                else
                {
                    if (size < 5 || bytes[start] != 0x2f) return false;
                    uint dimensions = BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(start + 1, 4));
                    imageWidth = (int)(dimensions & 0x3fff) + 1;
                    imageHeight = (int)((dimensions >> 14) & 0x3fff) + 1;
                }
                if (imageWidth != width || imageHeight != height) return false;
                frame = true;
            }
        }
        return frame;
    }
}
