using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

namespace NikkiSync.WindowsShell.Services;

public sealed record PayloadFile(string Path, long Length, string Sha256);
public sealed record PayloadManifest(string ArchiveSha256, PayloadFile[] Files);

// The ZIP and its file hashes are build artifacts embedded in the desktop executable.
// Never collect a used release directory: it may contain browser data or pairing secrets.
public static class RuntimePayload
{
    public const string ArchiveResource = "NikkiSync.Runtime.zip";
    public const string ManifestResource = "NikkiSync.Runtime.json";
    public static string UserDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NikkiSync");

    public static string Prepare(string? cacheRoot = null, Action<double>? progress = null)
    {
        var assembly = Assembly.GetExecutingAssembly();
        using var archive = assembly.GetManifestResourceStream(ArchiveResource);
        if (archive is null) return AppContext.BaseDirectory; // Existing folder builds remain supported.
        using var metadata = assembly.GetManifestResourceStream(ManifestResource)
            ?? throw new InvalidDataException("缺少内置运行文件清单。");
        var manifest = JsonSerializer.Deserialize<PayloadManifest>(metadata)
            ?? throw new InvalidDataException("内置运行文件清单无效。");
        return Deploy(archive, manifest.ArchiveSha256, cacheRoot ?? Path.Combine(UserDirectory, "portable-runtime"), manifest.Files, progress);
    }

    public static string Deploy(Stream archive, string archiveHash, string cacheRoot, IReadOnlyList<PayloadFile> files, Action<double>? progress = null)
    {
        if (!ValidHash(archiveHash) || files.Count is < 1 or > 64) throw new InvalidDataException("Invalid payload manifest.");
        var expected = new Dictionary<string, PayloadFile>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in files)
        {
            ValidatePath(file.Path);
            if (file.Length is < 0 or > 134217728 || !ValidHash(file.Sha256) || !expected.TryAdd(file.Path, file))
                throw new InvalidDataException("Invalid payload file.");
        }
        if (files.Sum(file => file.Length) > 268435456) throw new InvalidDataException("Payload exceeds size limit.");
        var root = Path.GetFullPath(cacheRoot);
        Directory.CreateDirectory(root);
        RejectLink(root);
        var target = Path.Combine(root, archiveHash.ToUpperInvariant());
        // Synchronize extraction across launches without holding a background polling timer.
        using var mutex = new Mutex(false, "Local\\NikkiSync-payload-" + archiveHash.ToUpperInvariant());
        var acquired = false;
        try
        {
            try { acquired = mutex.WaitOne(TimeSpan.FromMinutes(1)); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) throw new IOException("另一个程序正在准备运行文件，请稍后重试。");
            if (IsValid(target, files)) { progress?.Invoke(1); return target; }
            // An interrupted or modified cache is not accepted merely because a marker exists.
            archive.Position = 0;
            if (!Convert.ToHexString(SHA256.HashData(archive)).Equals(archiveHash, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("内置运行文件校验失败，请重新下载程序。");
            archive.Position = 0;
            using var zip = new ZipArchive(archive, ZipArchiveMode.Read, true);
            if (zip.Entries.Count != files.Count) throw new InvalidDataException("Unexpected payload entries.");
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in zip.Entries)
            {
                ValidatePath(entry.FullName);
                if (!expected.TryGetValue(entry.FullName, out var file) || !seen.Add(entry.FullName) || entry.Length != file.Length)
                    throw new InvalidDataException("Unexpected payload file.");
            }
            var staging = target + ".tmp-" + Guid.NewGuid().ToString("N");
            Directory.CreateDirectory(staging);
            try
            {
                long done = 0; var total = Math.Max(1, files.Sum(file => file.Length));
                var buffer = new byte[81920];
                foreach (var entry in zip.Entries)
                {
                    var destination = Path.Combine(staging, entry.FullName);
                    Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                    using var input = entry.Open();
                    using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                    using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                    long length = 0;
                    int count;
                    while ((count = input.Read(buffer)) > 0)
                    {
                        length += count;
                        if (length > entry.Length) throw new InvalidDataException("Payload length mismatch.");
                        output.Write(buffer, 0, count); hash.AppendData(buffer, 0, count);
                        done += count; progress?.Invoke((double)done / total);
                    }
                    if (length != entry.Length || !Convert.ToHexString(hash.GetHashAndReset()).Equals(expected[entry.FullName].Sha256, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("Payload file checksum mismatch.");
                }
                if (Directory.Exists(target))
                {
                    RejectLink(target);
                    // Preserve the old folder for diagnosis; never overwrite a running binary.
                    Directory.Move(target, target + ".bad-" + Guid.NewGuid().ToString("N"));
                }
                Directory.Move(staging, target);
                progress?.Invoke(1);
                return target;
            }
            finally
            {
                // Only this invocation's freshly created, contained temporary folder is removed.
                if (Directory.Exists(staging) && Path.GetFullPath(staging).StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    Directory.Delete(staging, true);
            }
        }
        finally { if (acquired) mutex.ReleaseMutex(); }
    }

    private static bool IsValid(string target, IReadOnlyList<PayloadFile> files)
    {
        if (!Directory.Exists(target)) return false;
        RejectLink(target);
        try
        {
            foreach (var file in files)
            {
                var path = Path.Combine(target, file.Path);
                var parent = Path.GetDirectoryName(path)!;
                while (parent != target) { RejectLink(parent); parent = Path.GetDirectoryName(parent)!; }
                if (!System.IO.File.Exists(path)) return false;
                RejectLink(path);
                if (new FileInfo(path).Length != file.Length) return false;
                using var stream = System.IO.File.OpenRead(path);
                if (!Convert.ToHexString(SHA256.HashData(stream)).Equals(file.Sha256, StringComparison.OrdinalIgnoreCase)) return false;
            }
            return true;
        }
        catch (FileNotFoundException) { return false; }
        catch (DirectoryNotFoundException) { return false; }
    }

    private static bool ValidHash(string value) => value.Length == 64 && value.All(Uri.IsHexDigit);
    private static void ValidatePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Contains('\\') || path.Contains(':') || path.StartsWith('/') ||
            path.Split('/').Any(part => part is "" or "." or ".." || part.EndsWith('.') || part.EndsWith(' ')))
            throw new InvalidDataException("Unsafe payload path.");
    }
    private static void RejectLink(string path)
    {
        if ((System.IO.File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("运行文件目录不能是符号链接。");
    }
}
