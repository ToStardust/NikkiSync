using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

namespace NikkiSync.WindowsShell.Services;

public sealed record PayloadFile(string Path, long Length, string Sha256);
public sealed record PayloadManifest(string ArchiveSha256, PayloadFile[] Files);
public enum PayloadPreparationStep
{
    ReadManifest, ValidateManifest, CreateCache, CheckCachePath, AcquireCacheLock,
    ValidateCache, ValidateArchive, ValidateEntries, CreateStaging, ExtractFiles,
    BackupCache, PublishCache, VerifyPublishedCache, Ready,
    ExtractRecoveryCache, VerifyRecoveryCache
}

// The ZIP and its file hashes are build artifacts embedded in the desktop executable.
// Never collect a used release directory: it may contain browser data or pairing secrets.
public static class RuntimePayload
{
    public const string ArchiveResource = "NikkiSync.Runtime.zip";
    public const string ManifestResource = "NikkiSync.Runtime.json";
    public static string UserDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NikkiSync");

    public static string Prepare(string? cacheRoot = null, Action<double>? progress = null, Action<PayloadPreparationStep>? step = null)
    {
        step?.Invoke(PayloadPreparationStep.ReadManifest);
        var assembly = Assembly.GetExecutingAssembly();
        using var archive = assembly.GetManifestResourceStream(ArchiveResource);
        if (archive is null) return AppContext.BaseDirectory; // Existing folder builds remain supported.
        using var metadata = assembly.GetManifestResourceStream(ManifestResource)
            ?? throw new InvalidDataException("缺少内置运行文件清单。");
        var manifest = JsonSerializer.Deserialize<PayloadManifest>(metadata)
            ?? throw new InvalidDataException("内置运行文件清单无效。");
        return Deploy(archive, manifest.ArchiveSha256, cacheRoot ?? Path.Combine(UserDirectory, "portable-runtime"), manifest.Files, progress, step);
    }

    public static string Deploy(Stream archive, string archiveHash, string cacheRoot, IReadOnlyList<PayloadFile> files, Action<double>? progress = null, Action<PayloadPreparationStep>? step = null)
    {
        step?.Invoke(PayloadPreparationStep.ValidateManifest);
        if (!ValidHash(archiveHash) || files.Count is < 1 or > 64) throw new InvalidDataException("Invalid payload manifest.");
        var expected = new Dictionary<string, PayloadFile>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in files)
        {
            ValidatePath(file.Path);
            var fileLimit = IsMediaTool(file.Path) ? 268435456L : 134217728L;
            if (file.Length < 0 || file.Length > fileLimit || !ValidHash(file.Sha256) || !expected.TryAdd(file.Path, file))
                throw new InvalidDataException("Invalid payload file.");
        }
        if (files.Where(file => !IsMediaTool(file.Path)).Sum(file => file.Length) > 268435456
            || files.Sum(file => file.Length) > 805306368) throw new InvalidDataException("Payload exceeds size limit.");
        var root = Path.GetFullPath(cacheRoot);
        step?.Invoke(PayloadPreparationStep.CreateCache);
        Directory.CreateDirectory(root);
        step?.Invoke(PayloadPreparationStep.CheckCachePath);
        RejectLink(root);
        var target = Path.Combine(root, archiveHash.ToUpperInvariant());
        var recovery = target + ".recovery";
        // Synchronize extraction across launches without holding a background polling timer.
        step?.Invoke(PayloadPreparationStep.AcquireCacheLock);
        using var mutex = new Mutex(false, "Local\\NikkiSync-payload-" + archiveHash.ToUpperInvariant());
        var acquired = false;
        try
        {
            try { acquired = mutex.WaitOne(TimeSpan.FromMinutes(1)); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) throw new IOException("另一个程序正在准备运行文件，请稍后重试。");
            step?.Invoke(PayloadPreparationStep.ValidateCache);
            var cached = IsValid(target, files) ? target : IsValid(recovery, files) ? recovery : null;
            if (cached is not null) { step?.Invoke(PayloadPreparationStep.Ready); progress?.Invoke(1); return cached; }
            // An interrupted or modified cache is not accepted merely because a marker exists.
            step?.Invoke(PayloadPreparationStep.ValidateArchive);
            archive.Position = 0;
            if (!Convert.ToHexString(SHA256.HashData(archive)).Equals(archiveHash, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("内置运行文件校验失败，请重新下载程序。");
            archive.Position = 0;
            using var zip = new ZipArchive(archive, ZipArchiveMode.Read, true);
            step?.Invoke(PayloadPreparationStep.ValidateEntries);
            if (zip.Entries.Count != files.Count) throw new InvalidDataException("Unexpected payload entries.");
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in zip.Entries)
            {
                ValidatePath(entry.FullName);
                if (!expected.TryGetValue(entry.FullName, out var file) || !seen.Add(entry.FullName) || entry.Length != file.Length)
                    throw new InvalidDataException("Unexpected payload file.");
            }
            var staging = target + ".tmp-" + Guid.NewGuid().ToString("N");
            step?.Invoke(PayloadPreparationStep.CreateStaging);
            Directory.CreateDirectory(staging);
            try
            {
                step?.Invoke(PayloadPreparationStep.ExtractFiles);
                ExtractFiles(zip, staging, expected, progress);
                if (Directory.Exists(target))
                {
                    step?.Invoke(PayloadPreparationStep.BackupCache);
                    RejectLink(target);
                    // Preserve the old folder for diagnosis; never overwrite a running binary.
                    MoveCacheDirectory(target, target + ".bad-" + Guid.NewGuid().ToString("N"),root);
                }
                step?.Invoke(PayloadPreparationStep.PublishCache);
                try
                {
                    MoveCacheDirectory(staging, target, root);
                }
                catch (Exception error) when (IsCacheMoveConflict(error))
                {
                    // Keep a stable executable path for subsequent launches and firewall rules.
                    // Use the embedded archive again, since staging may still be locked.
                    step?.Invoke(PayloadPreparationStep.ExtractRecoveryCache);
                    RejectLink(root);
                    if (Directory.Exists(recovery))
                        MoveCacheDirectory(recovery, recovery + ".bad-" + Guid.NewGuid().ToString("N"), root);
                    Directory.CreateDirectory(recovery);
                    try
                    {
                        RejectLink(recovery);
                        ExtractFiles(zip, recovery, expected, null);
                        step?.Invoke(PayloadPreparationStep.VerifyRecoveryCache);
                        if (!IsValid(recovery, files)) throw new InvalidDataException("备用运行缓存校验未通过。");
                    }
                    catch
                    {
                        CleanTemporaryCache(recovery, root);
                        throw;
                    }
                    step?.Invoke(PayloadPreparationStep.Ready);
                    progress?.Invoke(1);
                    return recovery;
                }
                // A wait for another reader must not make post-extraction changes
                // executable. Verify the final directory before reporting Ready.
                step?.Invoke(PayloadPreparationStep.VerifyPublishedCache);
                if(!IsValid(target,files))throw new InvalidDataException("运行文件提交后的校验未通过。");
                step?.Invoke(PayloadPreparationStep.Ready);
                progress?.Invoke(1);
                return target;
            }
            finally
            {
                CleanTemporaryCache(staging, root);
            }
        }
        finally { if (acquired) mutex.ReleaseMutex(); }
    }

    private static void ExtractFiles(ZipArchive zip, string directory, IReadOnlyDictionary<string, PayloadFile> expected, Action<double>? progress)
    {
        long done = 0;
        var total = Math.Max(1, expected.Values.Sum(file => file.Length));
        var buffer = new byte[81920];
        foreach (var entry in zip.Entries)
        {
            var destination = Path.Combine(directory, entry.FullName);
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
                output.Write(buffer, 0, count);
                hash.AppendData(buffer, 0, count);
                done += count;
                progress?.Invoke((double)done / total);
            }
            if (length != entry.Length || !Convert.ToHexString(hash.GetHashAndReset()).Equals(expected[entry.FullName].Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Payload file checksum mismatch.");
        }
    }

    private static void CleanTemporaryCache(string directory, string root)
    {
        // Only remove a directory created by this invocation. Cleanup must not mask startup errors.
        try
        {
            if (!Directory.Exists(directory) || !Path.GetFullPath(directory).StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return;
            RejectLink(root);
            RejectLink(directory);
            Directory.Delete(directory, true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    }

    private static bool IsCacheMoveConflict(Exception error) =>
        (error is IOException or UnauthorizedAccessException)
        && (error.HResult is unchecked((int)0x80070005) or unchecked((int)0x80070020) or unchecked((int)0x80070021));

    private static void MoveCacheDirectory(string source,string destination,string root)
    {
        int[] delays=[100,200,400,800,1000];
        for(int attempt=0;;attempt++)
        {
            RejectLink(root);RejectLink(source);
            try{Directory.Move(source,destination);return;}
            catch(Exception error) when(attempt<delays.Length&&IsCacheMoveConflict(error))
            {Thread.Sleep(delays[attempt]);}
        }
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

    private static bool IsMediaTool(string path) => path is "runtime/wechat/media/ffmpeg.exe" or "runtime/wechat/media/ffprobe.exe";
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
