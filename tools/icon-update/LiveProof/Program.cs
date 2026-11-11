using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using NikkiSync.WindowsShell.Services;

string repo = Path.GetFullPath(args[0]);
string proof = Path.Combine(repo, "out", "icon-update-live-proof-" + Guid.NewGuid().ToString("N"));
string data = Path.Combine(proof, "data");
string installed = Path.Combine(data, "clothing-icons");
string baseZip = Path.Combine(repo, "out", "current-clothing-webp85-20261109", "NikkiSync-ClothingIcons-WebP85-192-20261109-r2.zip");
Directory.CreateDirectory(installed);
ZipFile.ExtractToDirectory(baseZip, installed);
byte[] initial = await File.ReadAllBytesAsync(Path.Combine(installed, "manifest.json"));
const string feedUrl = "https://cnb.cool/nikkisync/icon-packs/-/releases/download/icons-update/MomoCamera-Icons-catalog.json";
using var http = new UpdateHttp(new HttpClientHandler {
    AllowAutoRedirect = false, UseProxy = false,
    AutomaticDecompression = System.Net.DecompressionMethods.GZip | System.Net.DecompressionMethods.Deflate
});
int interruptedBytes = 0;
bool interrupt = true;
var updater = new IconPackUpdater(data, DesktopRelease.ReadPublicKey(), async (url, limit, token) =>
{
    if (interrupt && url.EndsWith(".zip", StringComparison.Ordinal))
    {
        interrupt = false;
        using var response = await http.OpenAsync(new Uri(url), token);
        await using var stream = await response.Content.ReadAsStreamAsync(token);
        byte[] buffer = new byte[32768];
        interruptedBytes = await stream.ReadAsync(buffer, token);
        if (interruptedBytes == 0) throw new InvalidDataException("Empty response before interruption.");
        if (!initial.SequenceEqual(await File.ReadAllBytesAsync(Path.Combine(installed, "manifest.json")))
            || File.Exists(Path.Combine(data, "icon-updates", "ready.txt")))
            throw new InvalidDataException("Interrupted download changed the installed pack.");
        throw new IOException("Intentional interruption after receiving data.");
    }
    return await http.GetBytesAsync(new Uri(url), limit, token);
});
if (!await updater.CheckWithRetryAsync(feedUrl, CancellationToken.None, _ => Task.CompletedTask))
    throw new InvalidDataException("Retry did not stage the update.");
if (interruptedBytes == 0) throw new InvalidDataException("Interruption did not occur.");
if (!initial.SequenceEqual(await File.ReadAllBytesAsync(Path.Combine(installed, "manifest.json"))))
    throw new InvalidDataException("The update activated before restart.");
if (!updater.ActivatePrepared()) throw new InvalidDataException("Activation failed.");
string target = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(Path.Combine(installed, "manifest.json")))).ToLowerInvariant();
if (target != "c39e0f672867c7ee59fe9f7865510d95a0f2bbbf6d47f56a21f9a95e134752f0")
    throw new InvalidDataException("Installed manifest differs from r3.");
string fresh = Path.Combine(proof, "fresh-data");
string fullZip = Path.Combine(repo, "out", "photo-effect-icons-20261110",
    "NikkiSync-ClothingAndPhotoEffects-WebP-20261110-r3.zip");
var initialInstaller = new IconPackUpdater(fresh, DesktopRelease.ReadPublicKey(),
    (_, _, _) => throw new InvalidOperationException("Initial installation must be offline."));
using var fullSource = File.OpenRead(fullZip);
if (!initialInstaller.InstallInitialPack(fullSource, CancellationToken.None))
    throw new InvalidDataException("Initial full-pack installation failed.");
string initialHash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(
    Path.Combine(fresh, "clothing-icons", "manifest.json")))).ToLowerInvariant();
if (initialHash != target) throw new InvalidDataException("Initial full pack differs from update target.");
var report = new { interruptedBytes, retried = true, stagedBeforeRestart = true, activated = true,
    initialInstalled = true, targetManifestSha256 = target, installed };
await File.WriteAllTextAsync(Path.Combine(proof, "report.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine(JsonSerializer.Serialize(report));
