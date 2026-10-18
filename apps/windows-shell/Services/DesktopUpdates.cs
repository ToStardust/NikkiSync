using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

namespace NikkiSync.WindowsShell.Services;

public static class DesktopRelease
{
    public const string ManifestName = "MomoCamera-Windows-update.json";
    public const string SignatureName = ManifestName + ".sig";
    public const string ReleasesUrl = "https://github.com/ToStardust/NikkiSync/releases";
    public static string Version => typeof(DesktopRelease).Assembly.GetName().Version?.ToString(3) ?? "1.0.1";
    public static long Build => long.Parse(typeof(DesktopRelease).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().Single(a => a.Key == "DesktopBuild").Value!);
    public static string UpdateRoot => Path.Combine(RuntimePayload.UserDirectory, "updates");
    public static UpdateVerifier CreateVerifier()
    {
        using var stream = typeof(DesktopRelease).Assembly.GetManifestResourceStream("MomoCamera.UpdatePublicKey") ?? throw new InvalidDataException("缺少更新验证公钥。");
        using var reader = new StreamReader(stream);
        return new(reader.ReadToEnd());
    }
}

public sealed record UpdateManifest(int Schema, string AppId, string Version, long Build, string Channel, string Notes, string DownloadUrl, string Sha256, long Size);
public sealed record VerifiedUpdate(UpdateManifest Manifest, byte[] ManifestBytes, byte[] Signature);

public sealed class UpdateVerifier(string publicKey)
{
    public UpdateManifest Verify(byte[] bytes, byte[] signature, long currentBuild)
    {
        if (bytes.Length is 0 or > 65536 || signature.Length is < 128 or > 1024) throw new InvalidDataException("更新清单大小无效。");
        using var rsa = RSA.Create(); rsa.ImportFromPem(publicKey);
        if (!rsa.VerifyData(bytes, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)) throw new InvalidDataException("更新签名不匹配，已拒绝安装。");
        var m = JsonSerializer.Deserialize<UpdateManifest>(bytes) ?? throw new InvalidDataException("更新清单无效。");
        if (m.Schema != 1 || m.AppId != "MomoCamera.Windows" || m.Build <= currentBuild || m.Channel is not ("public-beta" or "stable")
            || !System.Version.TryParse(m.Version, out _) || m.Notes is null || m.Notes.Length > 12000 || m.Size is < 2 or > 536870912
            || m.Sha256 is null || m.Sha256.Length != 64 || !m.Sha256.All(Uri.IsHexDigit)) throw new InvalidDataException("更新版本或文件信息无效。");
        UpdateHttp.RequireHttps(new Uri(m.DownloadUrl));
        return m;
    }
}

// Redirects are followed explicitly: a valid HTTPS URL must never downgrade to HTTP.
public sealed class UpdateHttp : IDisposable
{
    private readonly HttpClient _client;
    public UpdateHttp(HttpMessageHandler? handler = null)
    {
        _client = new(handler ?? new HttpClientHandler { AllowAutoRedirect = false, AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate }) { Timeout = Timeout.InfiniteTimeSpan };
        _client.DefaultRequestHeaders.UserAgent.ParseAdd("MomoCamera-Updater/1.0");
        _client.DefaultRequestHeaders.Accept.ParseAdd("application/json, application/octet-stream");
    }
    public static void RequireHttps(Uri url)
    {
        if (!url.IsAbsoluteUri || url.Scheme != "https" || !string.IsNullOrEmpty(url.UserInfo) || url.IsLoopback || !string.IsNullOrEmpty(url.Fragment)) throw new InvalidDataException("更新地址必须是有效的 HTTPS 下载地址。");
    }
    public async Task<HttpResponseMessage> OpenAsync(Uri url, CancellationToken ct)
    {
        for (var hop = 0; hop < 6; hop++)
        {
            RequireHttps(url);
            var response = await _client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
            if ((int)response.StatusCode is >= 300 and < 400)
            {
                var location = response.Headers.Location; response.Dispose();
                if (location is null) throw new InvalidDataException("下载重定向缺少地址。");
                url = new Uri(url, location); continue;
            }
            if (!response.IsSuccessStatusCode) { var code = response.StatusCode; response.Dispose(); throw new HttpRequestException("更新服务暂不可用。", null, code); }
            return response;
        }
        throw new InvalidDataException("下载重定向次数过多。");
    }
    public async Task<byte[]> GetBytesAsync(Uri url, int limit, CancellationToken ct)
    {
        using var response = await OpenAsync(url, ct);
        if (response.Content.Headers.ContentLength > limit) throw new InvalidDataException("更新响应超过大小限制。");
        await using var source = await response.Content.ReadAsStreamAsync(ct);
        using var output = new MemoryStream(); var buffer = new byte[8192]; int n;
        while ((n = await source.ReadAsync(buffer, ct)) > 0)
        { if (output.Length + n > limit) throw new InvalidDataException("更新响应超过大小限制。"); output.Write(buffer, 0, n); }
        return output.ToArray();
    }
    public void Dispose() => _client.Dispose();
}

public sealed class DesktopUpdateSource(UpdateHttp http, UpdateVerifier verifier, long currentBuild)
{
    public async Task<VerifiedUpdate?> CheckAsync(string? manifestUrl, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(manifestUrl))
        {
            var url = new Uri(manifestUrl); UpdateHttp.RequireHttps(url);
            var signatureUrl = new Uri(url.GetLeftPart(UriPartial.Path) + ".sig" + url.Query);
            return await ReadAsync(url, signatureUrl, ct);
        }
        var releases = await http.GetBytesAsync(new Uri("https://api.github.com/repos/ToStardust/NikkiSync/releases?per_page=20"), 1048576, ct);
        using var json = JsonDocument.Parse(releases);
        if (json.RootElement.ValueKind != JsonValueKind.Array) throw new InvalidDataException("发布列表无效。");
        VerifiedUpdate? best = null;
        foreach (var release in json.RootElement.EnumerateArray())
        {
            if (!release.TryGetProperty("draft", out var draft) || draft.GetBoolean() || !release.TryGetProperty("assets", out var assets)) continue;
            string? manifest = null, signature = null;
            foreach (var asset in assets.EnumerateArray())
            {
                var name = asset.GetProperty("name").GetString(); var url = asset.GetProperty("browser_download_url").GetString();
                if (name == DesktopRelease.ManifestName) manifest = url;
                if (name == DesktopRelease.SignatureName) signature = url;
            }
            if (manifest is null || signature is null) continue;
            var update = await ReadAsync(new Uri(manifest), new Uri(signature), ct);
            if (update is not null && (best is null || update.Manifest.Build > best.Manifest.Build)) best = update;
        }
        return best;
    }
    private async Task<VerifiedUpdate?> ReadAsync(Uri url, Uri signatureUrl, CancellationToken ct)
    {
        var bytes = await http.GetBytesAsync(url, 65536, ct);
        var signature = await http.GetBytesAsync(signatureUrl, 1024, ct);
        // Validate old releases as well; untrusted version fields never decide trust.
        var manifest = verifier.Verify(bytes, signature, 0);
        return manifest.Build > currentBuild ? new(manifest, bytes, signature) : null;
    }
}

public sealed class UpdateDownloader(UpdateHttp http, string root)
{
    public async Task<string> DownloadAsync(VerifiedUpdate update, IProgress<double>? progress, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        UpdateFiles.RejectLinks(root);
        var directory = Path.Combine(root, Guid.NewGuid().ToString("N")); Directory.CreateDirectory(directory);
        var partial = Path.Combine(directory, "download.part"); var candidate = Path.Combine(directory, "candidate.exe");
        try
        {
            using var response = await http.OpenAsync(new Uri(update.Manifest.DownloadUrl), ct);
            if (response.Content.Headers.ContentLength is long length && length != update.Manifest.Size) throw new InvalidDataException("下载文件大小不匹配。");
            await using (var source = await response.Content.ReadAsStreamAsync(ct))
            await using (var destination = new FileStream(partial, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, true))
            {
                var buffer = new byte[65536]; long total = 0; int n;
                while ((n = await source.ReadAsync(buffer, ct)) > 0)
                {
                    total += n; if (total > update.Manifest.Size) throw new InvalidDataException("下载文件超过预期大小。");
                    await destination.WriteAsync(buffer.AsMemory(0, n), ct); progress?.Report((double)total / update.Manifest.Size);
                }
                if (total != update.Manifest.Size) throw new InvalidDataException("下载未完成。");
                await destination.FlushAsync(ct);
            }
            ct.ThrowIfCancellationRequested(); UpdateFiles.VerifyExecutable(partial, update.Manifest);
            File.WriteAllBytes(Path.Combine(directory, "manifest.json"), update.ManifestBytes);
            File.WriteAllBytes(Path.Combine(directory, "manifest.sig"), update.Signature);
            File.Move(partial, candidate); return candidate;
        }
        finally { if (File.Exists(partial)) File.Delete(partial); }
    }
}

public static class UpdateFiles
{
    public static string Hash(string path) { using var stream=File.OpenRead(path); return Convert.ToHexString(SHA256.HashData(stream)); }
    public static void VerifyExecutable(string path, UpdateManifest manifest)
    {
        RejectLinks(path);
        if(new FileInfo(path).Length!=manifest.Size || !Hash(path).Equals(manifest.Sha256,StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("安装包校验失败。");
        using var file=File.OpenRead(path); if(file.ReadByte()!=77 || file.ReadByte()!=90)throw new InvalidDataException("更新文件不是 Windows 程序。");
    }
    public static void RejectLinks(string path)
    {
        for(var current=Path.GetFullPath(path); !string.IsNullOrEmpty(current); current=Path.GetDirectoryName(current))
            if((File.Exists(current)||Directory.Exists(current)) && (File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new InvalidDataException("更新路径不能包含链接或重定向目录。");
    }
}

public static class UpdateReplacement
{
    // Only executable files are touched here, never the database, identity or photo directories.
    public static async Task ReplaceAndLaunchAsync(string candidate,string target,UpdateManifest manifest,string originalHash,Func<string,Task> launchAndCheck)
    {
        UpdateFiles.RejectLinks(target); UpdateFiles.VerifyExecutable(candidate,manifest);
        if(!UpdateFiles.Hash(target).Equals(originalHash,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("原程序已变化，请重新检查更新。");
        var suffix=Guid.NewGuid().ToString("N"); var stage=target+".update-"+suffix; var backup=target+".previous-"+suffix;
        try
        {
            File.Copy(candidate,stage,false); UpdateFiles.VerifyExecutable(stage,manifest);
            await ReplaceWithRetryAsync(stage,target,backup);
            try { await launchAndCheck(target); }
            catch { await ReplaceWithRetryAsync(backup,target,stage); throw; }
            try { if(File.Exists(backup))File.Delete(backup); } catch(IOException) { /* A retained EXE backup is harmless. */ }
        }
        finally { if(File.Exists(stage))File.Delete(stage); }
    }
    private static async Task ReplaceWithRetryAsync(string source,string target,string backup)
    {
        for(var attempt=0;;attempt++)
        {
            try { File.Replace(source,target,backup); return; }
            catch(IOException) when(attempt<19) { await Task.Delay(250); }
        }
    }
}
