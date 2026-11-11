using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell.Tests;

public sealed class IconPackUpdateTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Signed_catalog_stages_every_missing_delta_and_activates_latest_snapshot(bool startAtR3)
    {
        string root = Path.Combine(Path.GetTempPath(), "icon-catalog-test-" + Guid.NewGuid().ToString("N"));
        string active = Path.Combine(root, "clothing-icons");
        Directory.CreateDirectory(active);
        byte[] image = [82,73,70,70,18,0,0,0,87,69,66,80,86,80,56,76,5,0,0,0,47,0,0,0,0,0];
        byte[] r2 = JsonSerializer.SerializeToUtf8Bytes(new {
            schemaVersion = 2, imageFormat = "webp", version = "r2", source = "test", entries = Array.Empty<object>()
        });
        var effect = new { id = "123", kind = "pose", file = "effects/pose-123.webp",
            sha256 = Hash(image), sizeBytes = image.Length, width = 1, height = 1 };
        byte[] r3 = JsonSerializer.SerializeToUtf8Bytes(new {
            schemaVersion = 2, imageFormat = "webp", version = "r3", source = "test", entries = Array.Empty<object>(),
            effectEntries = new[] { effect }
        });
        byte[] r4 = JsonSerializer.SerializeToUtf8Bytes(new {
            schemaVersion = 2, imageFormat = "webp", version = "r4", source = "test",
            entries = new[] { new { id = "456", file = "icons/456.webp", sha256 = Hash(image),
                sizeBytes = image.Length, width = 1, height = 1 } }, effectEntries = new[] { effect }
        });
        byte[] first = Delta(r2, r3, "r2", "r3", "effects/pose-123.webp", image);
        byte[] second = Delta(r3, r4, "r3", "r4", "icons/456.webp", image);
        File.WriteAllBytes(Path.Combine(active, "manifest.json"), startAtR3 ? r3 : r2);
        if (startAtR3)
        {
            Directory.CreateDirectory(Path.Combine(active, "effects"));
            File.WriteAllBytes(Path.Combine(active, "effects", "pose-123.webp"), image);
        }
        using var key = RSA.Create(2048);
        byte[] catalog = JsonSerializer.SerializeToUtf8Bytes(new IconUpdateCatalog(2, "NikkiSync.Icons", "r4", Hash(r4), [
            new("r2", "r3", Hash(r2), Hash(r3), "https://example.com/r2-r3.zip", Hash(first), first.Length),
            new("r3", "r4", Hash(r3), Hash(r4), "https://example.com/r3-r4.zip", Hash(second), second.Length)
        ]));
        byte[] signature = key.SignData(catalog, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var downloads = new List<string>();
        var updater = new IconPackUpdater(root, key.ExportSubjectPublicKeyInfoPem(), (url, _, _) => {
            if (url.EndsWith(".zip", StringComparison.Ordinal)) downloads.Add(url);
            return Task.FromResult(url switch {
                "https://example.com/catalog.json" => catalog,
                "https://example.com/catalog.json.sig" => signature,
                "https://example.com/r2-r3.zip" => first,
                "https://example.com/r3-r4.zip" => second,
                _ => throw new InvalidDataException("Unexpected request")
            });
        });
        try
        {
            Assert.True(await updater.CheckAndStageAsync("https://example.com/catalog.json", CancellationToken.None));
            Assert.Equal(startAtR3 ? ["https://example.com/r3-r4.zip"]
                : ["https://example.com/r2-r3.zip", "https://example.com/r3-r4.zip"], downloads);
            Assert.Equal(startAtR3 ? r3 : r2, File.ReadAllBytes(Path.Combine(active, "manifest.json")));
            Assert.True(updater.ActivatePrepared());
            Assert.Equal(r4, File.ReadAllBytes(Path.Combine(active, "manifest.json")));
            Assert.Equal(image, File.ReadAllBytes(Path.Combine(active, "icons", "456.webp")));
            Assert.False(await updater.CheckAndStageAsync("https://example.com/catalog.json", CancellationToken.None));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Interrupted_download_retries_and_only_activates_verified_candidate(bool interruptedDuringActivation)
    {
        string root = Path.Combine(Path.GetTempPath(), "icon-update-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "clothing-icons", "icons"));
        byte[] baseManifest = Encoding.UTF8.GetBytes("{\"version\":\"r2\",\"entries\":[]}");
        File.WriteAllBytes(Path.Combine(root, "clothing-icons", "manifest.json"), baseManifest);
        byte[] image = [82,73,70,70,18,0,0,0,87,69,66,80,86,80,56,76,5,0,0,0,47,0,0,0,0,0];
        byte[] targetManifest = JsonSerializer.SerializeToUtf8Bytes(new {
            schemaVersion = 2, imageFormat = "webp", version = "r3", source = "test", entries = Array.Empty<object>(),
            effectEntries = new[] { new { id = "123", kind = "pose", file = "effects/pose-123.webp",
                sha256 = Hash(image), sizeBytes = image.Length, width = 1, height = 1 } }
        });
        byte[] package;
        using (var memory = new MemoryStream())
        {
            using (var zip = new ZipArchive(memory, ZipArchiveMode.Create, true))
            {
                Add(zip, "manifest.json", targetManifest);
                Add(zip, "update.json", JsonSerializer.SerializeToUtf8Bytes(new {
                    schemaVersion = 1, baseVersion = "r2", targetVersion = "r3",
                    baseManifestSha256 = Hash(baseManifest), targetManifestSha256 = Hash(targetManifest),
                    files = new[] { new { path = "effects/pose-123.webp", sha256 = Hash(image), size = image.Length } }
                }));
                Add(zip, "effects/pose-123.webp", image);
            }
            package = memory.ToArray();
        }
        using var key = RSA.Create(2048);
        var feed = JsonSerializer.SerializeToUtf8Bytes(new IconUpdateFeed(1, "NikkiSync.Icons",
            Hash(baseManifest), Hash(targetManifest), "https://example.com/delta.zip", Hash(package), package.Length));
        byte[] signature = key.SignData(feed, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        int attempts = 0;
        var broken = new InterruptedStream(package);
        using var http = new UpdateHttp(new TestHandler(request => {
            HttpContent content;
            if (request.RequestUri!.AbsolutePath.EndsWith(".sig")) content = new ByteArrayContent(signature);
            else if (request.RequestUri.AbsolutePath.EndsWith("feed.json")) content = new ByteArrayContent(feed);
            else content = attempts++ switch {
                0 => new ByteArrayContent(new byte[package.Length]),
                1 => new StreamContent(broken),
                _ => new ByteArrayContent(package)
            };
            if (request.RequestUri.AbsolutePath.EndsWith("delta.zip")) content.Headers.ContentLength = package.Length;
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
        }));
        var updater = new IconPackUpdater(root, key.ExportSubjectPublicKeyInfoPem(),
            (url, limit, token) => http.GetBytesAsync(new Uri(url), limit, token));
        try
        {
            await Assert.ThrowsAsync<InvalidDataException>(() => updater.CheckAndStageAsync("https://example.com/feed.json", CancellationToken.None));
            Assert.Equal(baseManifest, File.ReadAllBytes(Path.Combine(root, "clothing-icons", "manifest.json")));
            Assert.False(updater.ActivatePrepared());
            Assert.True(await updater.CheckWithRetryAsync("https://example.com/feed.json", CancellationToken.None,
                _ => Task.CompletedTask));
            Assert.True(broken.DeliveredBytes > 0);
            Assert.Equal(baseManifest, File.ReadAllBytes(Path.Combine(root, "clothing-icons", "manifest.json")));
            if (interruptedDuringActivation)
            {
                string id = File.ReadAllText(Path.Combine(root, "icon-updates", "ready.txt")).Trim();
                Directory.Move(Path.Combine(root, "clothing-icons"), Path.Combine(root, "icon-updates", id, "previous"));
            }
            Assert.True(updater.ActivatePrepared());
            Assert.Equal(targetManifest, File.ReadAllBytes(Path.Combine(root, "clothing-icons", "manifest.json")));
            Assert.Equal(image, File.ReadAllBytes(Path.Combine(root, "clothing-icons", "effects", "pose-123.webp")));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public void Rejects_modified_initial_pack_without_creating_an_installed_pack()
    {
        string root = Path.Combine(Path.GetTempPath(), "icon-initial-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        string sidecar = Path.Combine(root, IconPackUpdater.InitialPackFileName);
        File.WriteAllBytes(sidecar, Encoding.UTF8.GetBytes("not the signed full pack"));
        var updater = new IconPackUpdater(root, "unused", (_, _, _) => throw new InvalidOperationException());
        try
        {
            Assert.Throws<InvalidDataException>(() => updater.InstallInitialPack(sidecar, CancellationToken.None));
            Assert.False(Directory.Exists(Path.Combine(root, "clothing-icons")));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Rejects_signed_catalog_with_a_broken_version_chain_before_downloading_images()
    {
        string root = Path.Combine(Path.GetTempPath(), "icon-catalog-invalid-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "clothing-icons"));
        byte[] installed = Encoding.UTF8.GetBytes("{}");
        File.WriteAllBytes(Path.Combine(root, "clothing-icons", "manifest.json"), installed);
        using var key = RSA.Create(2048);
        string middle = new('b', 64), wrongBase = new('a', 64), latest = new('c', 64);
        byte[] catalog = JsonSerializer.SerializeToUtf8Bytes(new IconUpdateCatalog(2, "NikkiSync.Icons", "r4", latest, [
            new("r2", "r3", Hash(installed), middle, "https://example.com/r2-r3.zip", Hash(installed), 2),
            new("r3", "r4", wrongBase, latest, "https://example.com/r3-r4.zip", Hash(installed), 2)
        ]));
        byte[] signature = key.SignData(catalog, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var updater = new IconPackUpdater(root, key.ExportSubjectPublicKeyInfoPem(), (url, _, _) =>
            Task.FromResult(url.EndsWith(".sig", StringComparison.Ordinal) ? signature : catalog));
        try
        {
            await Assert.ThrowsAsync<InvalidDataException>(() => updater.CheckAndStageAsync(
                "https://example.com/catalog.json", CancellationToken.None));
            Assert.False(Directory.Exists(Path.Combine(root, "icon-updates")));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Rejects_unsigned_feed_before_downloading_payload()
    {
        using var key = RSA.Create(2048);
        string root = Path.Combine(Path.GetTempPath(), "icon-update-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "clothing-icons"));
        File.WriteAllText(Path.Combine(root, "clothing-icons", "manifest.json"), "{}");
        var updater = new IconPackUpdater(root, key.ExportSubjectPublicKeyInfoPem(),
            (url, limit, token) => Task.FromResult(url.EndsWith(".sig") ? new byte[256] : Encoding.UTF8.GetBytes("{}")));
        try { await Assert.ThrowsAnyAsync<CryptographicException>(() => updater.CheckAndStageAsync("https://example.com/feed.json", CancellationToken.None)); }
        finally { Directory.Delete(root, true); }
    }

    private static string Hash(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
    private static byte[] Delta(byte[] oldManifest, byte[] newManifest, string oldVersion, string newVersion,
        string path, byte[] image)
    {
        using var memory = new MemoryStream();
        using (var zip = new ZipArchive(memory, ZipArchiveMode.Create, true))
        {
            Add(zip, "manifest.json", newManifest);
            Add(zip, "update.json", JsonSerializer.SerializeToUtf8Bytes(new {
                schemaVersion = 1, baseVersion = oldVersion, targetVersion = newVersion,
                baseManifestSha256 = Hash(oldManifest), targetManifestSha256 = Hash(newManifest),
                files = new[] { new { path, sha256 = Hash(image), size = image.Length } }
            }));
            Add(zip, path, image);
        }
        return memory.ToArray();
    }
    private static void Add(ZipArchive archive, string name, byte[] bytes)
    {
        using var stream = archive.CreateEntry(name).Open();
        stream.Write(bytes);
    }

    private sealed class TestHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) =>
            Task.FromResult(respond(request));
    }

    private sealed class InterruptedStream(byte[] bytes) : MemoryStream(bytes)
    {
        public int DeliveredBytes { get; private set; }
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken token = default)
        {
            if (DeliveredBytes > 0) throw new IOException("Connection interrupted after partial response.");
            int read = await base.ReadAsync(buffer[..Math.Min(buffer.Length, 16)], token);
            DeliveredBytes += read;
            return read;
        }
    }
}
