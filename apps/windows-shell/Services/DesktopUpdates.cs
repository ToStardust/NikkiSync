using System.IO;
using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

namespace NikkiSync.WindowsShell.Services;

public static class DesktopRelease
{
    public const string ManifestName = "MomoCamera-Windows-update.json";
    public const string SignatureName = ManifestName + ".sig";
    public const string DefaultManifestUrl = "https://cnb.cool/nikkisync/icon-packs/-/releases/download/windows-update/MomoCamera-Windows-update.json";
    public const string ReleasesUrl = "https://github.com/ToStardust/NikkiSync/releases";
    public const string DownloadsUrl = "https://pan.baidu.com/s/5bb_o2A8iJ2MR4f_hRBlPCw";
    public const string QuarkDownloadsUrl = "https://pan.quark.cn/s/3d5a764a196c";
    public const string AndroidDirectUrl = "https://cnb.cool/nikkisync/icon-packs/-/releases/download/android-update-test/MomoCamera-Android-1.0.39.apk";
    public static string Version => typeof(DesktopRelease).Assembly.GetName().Version?.ToString(3) ?? "1.0.1";
    public static long Build => long.Parse(typeof(DesktopRelease).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().Single(a => a.Key == "DesktopBuild").Value!);
    public static string UpdateRoot => Path.Combine(RuntimePayload.UserDirectory, "updates");
    public static string ReadPublicKey()
    {
        using var stream = typeof(DesktopRelease).Assembly.GetManifestResourceStream("MomoCamera.UpdatePublicKey") ?? throw new InvalidDataException("缺少更新验证公钥。");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
    public static UpdateVerifier CreateVerifier() => new(ReadPublicKey());
}

public sealed record UpdateDelta(long BaseBuild, string BaseSha256, string DownloadUrl, string Sha256, long Size, string Algorithm);
public sealed record UpdateManifest(int Schema, string AppId, string Version, long Build, string Channel, string Notes, string DownloadUrl, string Sha256, long Size, UpdateDelta[]? Deltas = null);
public sealed record VerifiedUpdate(UpdateManifest Manifest, byte[] ManifestBytes, byte[] Signature);

public sealed class UpdateVerifier(string publicKey)
{
    public UpdateManifest Verify(byte[] bytes, byte[] signature, long currentBuild)
    {
        if (bytes.Length is 0 or > 65536 || signature.Length is < 128 or > 1024) throw new InvalidDataException("更新清单大小无效。");
        using var rsa = RSA.Create(); rsa.ImportFromPem(publicKey);
        if (!rsa.VerifyData(bytes, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)) throw new InvalidDataException("更新签名不匹配，已拒绝安装。");
        var m = JsonSerializer.Deserialize<UpdateManifest>(bytes) ?? throw new InvalidDataException("更新清单无效。");
        if (m.Schema is not (1 or 2) || m.AppId != "MomoCamera.Windows" || m.Build <= currentBuild || m.Channel is not ("public-beta" or "stable")
            || !System.Version.TryParse(m.Version, out _) || m.Notes is null || m.Notes.Length > 12000 || m.Size is < 2 or > 536870912
            || m.Sha256 is null || m.Sha256.Length != 64 || !m.Sha256.All(Uri.IsHexDigit)) throw new InvalidDataException("更新版本或文件信息无效。");
        UpdateHttp.RequireHttps(new Uri(m.DownloadUrl));
        if (m.Schema == 1 && m.Deltas is { Length: > 0 }) throw new InvalidDataException("旧版清单不能包含差分包。");
        if (m.Deltas is { Length: > 8 }) throw new InvalidDataException("差分包数量过多。");
        var bases = new HashSet<long>();
        foreach (var delta in m.Deltas ?? [])
        {
            if (delta is null || delta.BaseBuild <= 0 || delta.BaseBuild >= m.Build || !bases.Add(delta.BaseBuild)
                || delta.BaseSha256 is null || delta.BaseSha256.Length != 64 || !delta.BaseSha256.All(Uri.IsHexDigit)
                || delta.Sha256 is null || delta.Sha256.Length != 64 || !delta.Sha256.All(Uri.IsHexDigit)
                || delta.Size is < 1 or > 536870912 || delta.Size >= m.Size || delta.Algorithm != "xdelta3-vcdiff")
                throw new InvalidDataException("差分包信息无效。");
            UpdateHttp.RequireHttps(new Uri(delta.DownloadUrl));
        }
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
    public async Task<HttpResponseMessage> OpenAsync(Uri url, CancellationToken ct, long? offset = null)
    {
        for (var hop = 0; hop < 6; hop++)
        {
            RequireHttps(url);
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            if (offset is > 0) request.Headers.Range = new RangeHeaderValue(offset, null);
            var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
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

public sealed class UpdateDownloader(UpdateHttp http, string root, string? currentExecutable = null, string? patchTool = null, long? currentBuild = null)
{
    private static readonly SemaphoreSlim DownloadGate = new(1, 1);

    public async Task<string> DownloadAsync(VerifiedUpdate update, IProgress<double>? progress, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        UpdateFiles.RejectLinks(root);
        var directory = Path.Combine(root, Guid.NewGuid().ToString("N")); Directory.CreateDirectory(directory);
        var candidate = Path.Combine(directory, "candidate.exe");
        try
        {
            var original = currentExecutable ?? Environment.ProcessPath;
            var delta = update.Manifest.Deltas?.FirstOrDefault(item => item.BaseBuild == (currentBuild ?? DesktopRelease.Build)
                && item.Size < update.Manifest.Size * .9);
            if (delta is not null && original is not null && File.Exists(original) && patchTool is not null && File.Exists(patchTool))
            {
                UpdateFiles.RejectLinks(original);
                UpdateFiles.RejectLinks(patchTool);
                var originalHash = await Task.Run(() => UpdateFiles.Hash(original), ct);
                if (originalHash.Equals(delta.BaseSha256, StringComparison.OrdinalIgnoreCase))
                {
                    try
                    {
                        var patch = Path.Combine(directory, "patch.xdelta3");
                        await DownloadArtifactAsync(delta.DownloadUrl, delta.Sha256, delta.Size, patch, progress, ct);
                        await UpdateDeltaApplier.ApplyAsync(patchTool, original, patch, candidate, ct);
                        UpdateFiles.VerifyExecutable(candidate, update.Manifest);
                    }
                    catch (OperationCanceledException) { throw; }
                    catch (HttpRequestException error) when (error.StatusCode != HttpStatusCode.NotFound) { throw; }
                    catch (Exception error) when (error is InvalidDataException or IOException or HttpRequestException)
                    {
                        if (File.Exists(candidate)) File.Delete(candidate);
                    }
                }
            }
            if (!File.Exists(candidate))
            {
                await DownloadArtifactAsync(update.Manifest.DownloadUrl, update.Manifest.Sha256, update.Manifest.Size, candidate, progress, ct);
                UpdateFiles.VerifyExecutable(candidate, update.Manifest);
            }
            File.WriteAllBytes(Path.Combine(directory, "manifest.json"), update.ManifestBytes);
            File.WriteAllBytes(Path.Combine(directory, "manifest.sig"), update.Signature);
            return candidate;
        }
        catch
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
            throw;
        }
    }

    private async Task DownloadArtifactAsync(string url, string hash, long size, string destination, IProgress<double>? progress, CancellationToken ct)
    {
        await DownloadGate.WaitAsync(ct);
        try
        {
            Directory.CreateDirectory(root);
            UpdateFiles.RejectLinks(root);
            var partial = Path.Combine(root, "partial-" + hash.ToUpperInvariant() + ".part");
            UpdateFiles.RejectLinks(partial);
            var offset = File.Exists(partial) ? new FileInfo(partial).Length : 0;
            if (offset > size) { File.Delete(partial); offset = 0; }
            if (offset < size)
            {
                using var response = await http.OpenAsync(new Uri(url), ct, offset);
                if (offset > 0 && response.StatusCode == HttpStatusCode.OK) { File.Delete(partial); offset = 0; }
                else if (offset > 0 && (response.StatusCode != HttpStatusCode.PartialContent
                    || response.Content.Headers.ContentRange?.From != offset
                    || response.Content.Headers.ContentRange?.Length != size))
                    throw new InvalidDataException("续传响应范围不正确。");
                else if (offset == 0 && response.StatusCode != HttpStatusCode.OK)
                    throw new InvalidDataException("更新下载响应无效。");
                if (response.Content.Headers.ContentLength is long length && length != size - offset)
                    throw new InvalidDataException("下载文件大小不匹配。");
                await using var source = await response.Content.ReadAsStreamAsync(ct);
                await using var output = new FileStream(partial, offset == 0 ? FileMode.Create : FileMode.Open,
                    FileAccess.Write, FileShare.None, 65536, true);
                output.Position = offset;
                var buffer = new byte[65536]; var total = offset; int count;
                progress?.Report((double)total / size);
                while ((count = await source.ReadAsync(buffer, ct)) > 0)
                {
                    total += count;
                    if (total > size) throw new InvalidDataException("下载文件超过预期大小。");
                    await output.WriteAsync(buffer.AsMemory(0, count), ct);
                    progress?.Report((double)total / size);
                }
                await output.FlushAsync(ct);
                if (total != size) throw new IOException("下载中断，已保留进度供下次续传。");
            }
            if (!UpdateFiles.Hash(partial).Equals(hash, StringComparison.OrdinalIgnoreCase))
            {
                File.Delete(partial);
                throw new InvalidDataException("下载文件校验失败。");
            }
            File.Move(partial, destination);
            progress?.Report(1);
        }
        finally { DownloadGate.Release(); }
    }
}

public static class UpdateDeltaApplier
{
    public const string ToolSha256 = "732980D52F9220DC81817CCDD0C295EADCE8A0048A24C2A771A73F791AC824E9";
    public static async Task ApplyAsync(string tool, string original, string patch, string candidate, CancellationToken ct)
    {
        UpdateFiles.RejectLinks(tool);
        UpdateFiles.RejectLinks(original);
        UpdateFiles.RejectLinks(patch);
        if (!UpdateFiles.Hash(tool).Equals(ToolSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("差分更新工具校验失败。");
        var info = new ProcessStartInfo(tool) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true };
        foreach (var argument in new[] { "-d", "-f", "-s", original, patch, candidate }) info.ArgumentList.Add(argument);
        using var process = Process.Start(info) ?? throw new IOException("差分更新工具未能启动。");
        try
        {
            var errors = process.StandardError.ReadToEndAsync(ct);
            await process.WaitForExitAsync(ct);
            var message = await errors;
            if (process.ExitCode != 0 || !File.Exists(candidate))
                throw new InvalidDataException("差分重建失败：" + message[..Math.Min(message.Length, 200)]);
        }
        catch
        {
            if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(); }
            throw;
        }
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
