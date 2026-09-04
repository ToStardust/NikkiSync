using System.Security.Cryptography;
using System.Text;

namespace Cue4ParseProbe;

public sealed record PaksFingerprint(int FileCount, long TotalBytes, string Sha256);

public static class PaksDirectory
{
    public static PaksFingerprint ValidateAndFingerprint(string paksDirectory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(paksDirectory);
        var fullPath = Path.GetFullPath(paksDirectory);
        var root = Path.GetPathRoot(fullPath);
        if (string.Equals(fullPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), root?.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("input must be a Content/Paks directory, not a filesystem root", nameof(paksDirectory));
        if (!Directory.Exists(fullPath) || !string.Equals(new DirectoryInfo(fullPath).Name, "Paks", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("input must be an existing directory named Paks", nameof(paksDirectory));

        var files = Directory.EnumerateFiles(fullPath, "*", SearchOption.TopDirectoryOnly)
            .Where(file => file.EndsWith(".utoc", StringComparison.OrdinalIgnoreCase) || file.EndsWith(".pak", StringComparison.OrdinalIgnoreCase))
            .Select(file => new FileInfo(file))
            .OrderBy(file => file.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (files.Length == 0) throw new ArgumentException("Paks directory contains no .utoc or .pak archive", nameof(paksDirectory));

        using var sha = SHA256.Create();
        long totalBytes = 0;
        foreach (var file in files)
        {
            totalBytes += file.Length;
            var line = $"{file.Name}|{file.Length}|{file.LastWriteTimeUtc.Ticks}\n";
            var bytes = Encoding.UTF8.GetBytes(line);
            sha.TransformBlock(bytes, 0, bytes.Length, null, 0);
        }
        sha.TransformFinalBlock([], 0, 0);
        return new PaksFingerprint(files.Length, totalBytes, Convert.ToHexString(sha.Hash!).ToLowerInvariant());
    }

    public static void VerifyUnchanged(string paksDirectory, PaksFingerprint before)
    {
        if (ValidateAndFingerprint(paksDirectory) != before)
            throw new InvalidOperationException("archive input changed while the read-only probe was running");
    }
}
