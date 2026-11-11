using System.IO;
using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell.Tests;

public sealed class DesktopUpdateTests : IDisposable
{
    private readonly RSA _key = RSA.Create(2048);
    private readonly string _root = Path.Combine(Path.GetTempPath(), "Momo-update-test-" + Guid.NewGuid().ToString("N"));
    private static readonly byte[] Exe = Encoding.UTF8.GetBytes("MZ signed test executable");
    private UpdateManifest Manifest(long build = 2) => new(1, "MomoCamera.Windows", "1.0.2", build, "public-beta", "测试更新", "https://downloads.example.com/MomoCamera-PC.exe", Convert.ToHexString(SHA256.HashData(Exe)), Exe.Length);
    private byte[] Bytes(UpdateManifest manifest) => JsonSerializer.SerializeToUtf8Bytes(manifest);
    private byte[] Sign(byte[] bytes) => _key.SignData(bytes, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
    private UpdateVerifier Verifier() => new(_key.ExportSubjectPublicKeyInfoPem());

    [Fact]
    public void Requires_signed_bytes_app_identity_newer_build_and_https()
    {
        var bytes = Bytes(Manifest());
        Assert.Equal(2, Verifier().Verify(bytes, Sign(bytes), 1).Build);
        Assert.ThrowsAny<Exception>(() => Verifier().Verify(bytes.Concat(new byte[] { 32 }).ToArray(), Sign(bytes), 1));
        Assert.Throws<InvalidDataException>(() => Verifier().Verify(bytes, Sign(bytes), 2));
        foreach (var bad in new[] { Manifest() with { AppId = "OtherApp" }, Manifest() with { DownloadUrl = "http://downloads.example.com/app.exe" }, Manifest() with { Size = 0 }, Manifest() with { Sha256 = "invalid" } })
        { var data = Bytes(bad); Assert.Throws<InvalidDataException>(() => Verifier().Verify(data, Sign(data), 1)); }
    }

    [Fact]
    public void Schema_two_verifies_every_signed_patch_field()
    {
        var delta = new UpdateDelta(1, new string('A', 64), "https://downloads.example.com/update.xdelta3", new string('B', 64), 4, "xdelta3-vcdiff");
        var manifest = Manifest() with { Schema = 2, Deltas = [delta] };
        var bytes = Bytes(manifest);
        Assert.Single(Verifier().Verify(bytes, Sign(bytes), 1).Deltas!);
        foreach (var bad in new[] { delta with { BaseBuild = 2 }, delta with { DownloadUrl = "http://downloads.example.com/patch" },
                     delta with { BaseSha256 = "wrong" }, delta with { Size = manifest.Size }, delta with { Algorithm = "unknown" } })
        {
            var invalid = Bytes(manifest with { Deltas = [bad] });
            Assert.Throws<InvalidDataException>(() => Verifier().Verify(invalid, Sign(invalid), 1));
        }
        var legacy = Bytes(manifest with { Schema = 1 });
        Assert.Throws<InvalidDataException>(() => Verifier().Verify(legacy, Sign(legacy), 1));
    }

    [Fact]
    public async Task Reconstructs_exact_exe_from_patch_and_falls_back_when_patch_is_corrupt()
    {
        Directory.CreateDirectory(_root);
        var original = Path.Combine(_root, "old.exe"); var target = Path.Combine(_root, "new.exe"); var patch = Path.Combine(_root, "sample.xdelta3");
        var oldBytes = RandomNumberGenerator.GetBytes(1024 * 1024);
        oldBytes[0] = 77; oldBytes[1] = 90;
        var newBytes = (byte[])oldBytes.Clone();
        newBytes.AsSpan(10000, 64).Fill(42);
        File.WriteAllBytes(original, oldBytes); File.WriteAllBytes(target, newBytes);
        var tool = Path.Combine(AppContext.BaseDirectory, "xdelta3.exe");
        var info = new ProcessStartInfo(tool) { UseShellExecute = false, CreateNoWindow = true };
        foreach (var arg in new[] { "-e", "-s", original, target, patch }) info.ArgumentList.Add(arg);
        using (var process = Process.Start(info)!) { await process.WaitForExitAsync(); Assert.Equal(0, process.ExitCode); }
        var patchBytes = File.ReadAllBytes(patch);
        Assert.True(patchBytes.Length < newBytes.Length * .9);
        var build = DesktopRelease.Build;
        var delta = new UpdateDelta(build, UpdateFiles.Hash(original), "https://example.com/patch", Convert.ToHexString(SHA256.HashData(patchBytes)), patchBytes.Length, "xdelta3-vcdiff");
        var manifest = new UpdateManifest(2, "MomoCamera.Windows", "1.0.40", build + 1, "public-beta", "test", "https://example.com/full", Convert.ToHexString(SHA256.HashData(newBytes)), newBytes.Length, [delta]);
        var bytes = Bytes(manifest); var update = new VerifiedUpdate(Verifier().Verify(bytes, Sign(bytes), build), bytes, Sign(bytes));
        var fullRequests = 0;
        using (var http = new UpdateHttp(new StubHandler(r =>
        {
            if (r.RequestUri!.AbsolutePath == "/full") fullRequests++;
            return new(HttpStatusCode.OK) { Content = new ByteArrayContent(r.RequestUri.AbsolutePath == "/patch" ? patchBytes : newBytes) };
        })))
        {
            var result = await new UpdateDownloader(http, _root, original, tool, build).DownloadAsync(update, null, CancellationToken.None);
            Assert.Equal(newBytes, File.ReadAllBytes(result));
            Assert.Equal(0, fullRequests);
        }
        var damaged = (byte[])patchBytes.Clone(); damaged[^1] ^= 1;
        using (var http = new UpdateHttp(new StubHandler(r =>
        {
            if (r.RequestUri!.AbsolutePath == "/full") fullRequests++;
            return new(HttpStatusCode.OK) { Content = new ByteArrayContent(r.RequestUri.AbsolutePath == "/patch" ? damaged : newBytes) };
        })))
        {
            var result = await new UpdateDownloader(http, _root, original, tool, build).DownloadAsync(update, null, CancellationToken.None);
            Assert.Equal(newBytes, File.ReadAllBytes(result));
            Assert.Equal(1, fullRequests);
        }
        File.WriteAllBytes(original, newBytes);
        using (var http = new UpdateHttp(new StubHandler(r =>
        {
            Assert.Equal("/full", r.RequestUri!.AbsolutePath);
            fullRequests++;
            return new(HttpStatusCode.OK) { Content = new ByteArrayContent(newBytes) };
        })))
        {
            var result = await new UpdateDownloader(http, _root, original, tool, build).DownloadAsync(update, null, CancellationToken.None);
            Assert.Equal(newBytes, File.ReadAllBytes(result));
            Assert.Equal(2, fullRequests);
        }
    }

    [Fact]
    public async Task Resumes_a_partial_download_with_a_verified_range()
    {
        Directory.CreateDirectory(_root);
        var manifest = Manifest(); var bytes = Bytes(manifest); var offset = 9;
        var requests = 0;
        using var http = new UpdateHttp(new StubHandler(request =>
        {
            requests++;
            if (requests == 1)
            {
                Assert.Null(request.Headers.Range);
                return new(HttpStatusCode.OK) { Content = new StreamContent(new NonSeekableStream(Exe[..offset])) };
            }
            Assert.Equal(offset, request.Headers.Range?.Ranges.Single().From);
            var response = new HttpResponseMessage(HttpStatusCode.PartialContent) { Content = new ByteArrayContent(Exe[offset..]) };
            response.Content.Headers.ContentRange = new ContentRangeHeaderValue(offset, Exe.Length - 1, Exe.Length);
            return response;
        }));
        var downloader = new UpdateDownloader(http, _root);
        var update = new VerifiedUpdate(manifest, bytes, Sign(bytes));
        await Assert.ThrowsAsync<IOException>(() => downloader.DownloadAsync(update, null, CancellationToken.None));
        var partial = Path.Combine(_root, "partial-" + manifest.Sha256 + ".part");
        Assert.Equal(offset, new FileInfo(partial).Length);
        Assert.Empty(Directory.GetFiles(_root, "candidate.exe", SearchOption.AllDirectories));
        var result = await downloader.DownloadAsync(update, null, CancellationToken.None);
        Assert.Equal(Exe, File.ReadAllBytes(result));
        Assert.Equal(2, requests);
    }

    [Fact]
    public async Task Restarts_safely_when_server_ignores_range_request()
    {
        Directory.CreateDirectory(_root);
        var manifest = Manifest(); var bytes = Bytes(manifest);
        File.WriteAllBytes(Path.Combine(_root, "partial-" + manifest.Sha256 + ".part"), Exe[..5]);
        using var http = new UpdateHttp(new StubHandler(request =>
        {
            Assert.Equal(5, request.Headers.Range?.Ranges.Single().From);
            return new(HttpStatusCode.OK) { Content = new ByteArrayContent(Exe) };
        }));
        var result = await new UpdateDownloader(http, _root).DownloadAsync(new(manifest, bytes, Sign(bytes)), null, CancellationToken.None);
        Assert.Equal(Exe, File.ReadAllBytes(result));
    }

    [Fact]
    public async Task Streams_download_verifies_size_and_hash_and_does_not_publish_bad_bytes()
    {
        var manifest = Manifest(); var bytes = Bytes(manifest);
        var update = new VerifiedUpdate(manifest, bytes, Sign(bytes));
        using var http = new UpdateHttp(new StubHandler(_ => new(HttpStatusCode.OK) { Content = new ByteArrayContent(Exe) }));
        var path = await new UpdateDownloader(http, _root).DownloadAsync(update, null, CancellationToken.None);
        Assert.Equal(Exe, File.ReadAllBytes(path));
        using var badHttp = new UpdateHttp(new StubHandler(_ => new(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[Exe.Length]) }));
        await Assert.ThrowsAsync<InvalidDataException>(() => new UpdateDownloader(badHttp, _root).DownloadAsync(update, null, CancellationToken.None));
        Assert.Single(Directory.GetFiles(_root, "candidate.exe", SearchOption.AllDirectories));
        Assert.Empty(Directory.GetFiles(_root, "*.part", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Cancellation_does_not_leave_an_installable_partial_download()
    {
        using var http = new UpdateHttp(new StubHandler(_ => new(HttpStatusCode.OK) { Content = new ByteArrayContent(Exe) }));
        var manifest = Manifest(); var bytes = Bytes(manifest); using var cancel = new CancellationTokenSource(); cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new UpdateDownloader(http, _root).DownloadAsync(new(manifest, bytes, Sign(bytes)), null, cancel.Token));
        Assert.False(Directory.Exists(_root) && Directory.GetFiles(_root, "candidate.exe", SearchOption.AllDirectories).Length > 0);
    }

    [Fact]
    public async Task Rejects_http_redirect_before_following_and_caps_responses()
    {
        var requests = 0;
        using var http = new UpdateHttp(new StubHandler(_ => { requests++; var r = new HttpResponseMessage(HttpStatusCode.Redirect); r.Headers.Location = new Uri("http://downloads.example.com/unsafe"); return r; }));
        await Assert.ThrowsAsync<InvalidDataException>(() => http.GetBytesAsync(new Uri("https://example.com/file"), 512, CancellationToken.None));
        Assert.Equal(1, requests);
        using var large = new UpdateHttp(new StubHandler(_ => new(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[513]) }));
        await Assert.ThrowsAsync<InvalidDataException>(() => large.GetBytesAsync(new Uri("https://example.com/file"), 512, CancellationToken.None));
    }

    [Fact]
    public async Task Github_source_skips_unrelated_releases_and_selects_highest_signed_build()
    {
        var bytes = Bytes(Manifest()); var sig = Sign(bytes);
        var json = JsonSerializer.SerializeToUtf8Bytes(new object[] {
            new { draft=false, assets=new object[] {new {name="Other.apk",browser_download_url="https://example.com/other"}}},
            new { draft=false, assets=new object[] {new {name=DesktopRelease.ManifestName,browser_download_url="https://example.com/manifest"},new {name=DesktopRelease.SignatureName,browser_download_url="https://example.com/signature"}}}
        });
        using var http = new UpdateHttp(new StubHandler(r => new(HttpStatusCode.OK) { Content = new ByteArrayContent(r.RequestUri!.AbsolutePath switch { "/manifest" => bytes, "/signature" => sig, _ => json }) }));
        var result = await new DesktopUpdateSource(http, Verifier(), 1).CheckAsync(null, CancellationToken.None);
        Assert.Equal(2, result!.Manifest.Build);
    }

    [Fact]
    public async Task Atomic_install_and_failed_start_rollback_never_touch_user_data()
    {
        Directory.CreateDirectory(_root);
        var target = Path.Combine(_root, "MomoCamera-PC.exe");
        var data = Path.Combine(_root, "user-data"); Directory.CreateDirectory(data);
        var marker = Path.Combine(data, "pairing.db"); File.WriteAllText(marker, "keep pairing and indexes");
        File.WriteAllText(target, "old executable");
        var candidate = Path.Combine(_root, "candidate.exe"); File.WriteAllBytes(candidate, Exe);
        var originalHash = UpdateFiles.Hash(target);
        await Assert.ThrowsAsync<IOException>(() => UpdateReplacement.ReplaceAndLaunchAsync(candidate, target, Manifest(), originalHash, _ => throw new IOException("launch failed")));
        Assert.Equal("old executable", File.ReadAllText(target));
        Assert.Equal("keep pairing and indexes", File.ReadAllText(marker));
        await UpdateReplacement.ReplaceAndLaunchAsync(candidate, target, Manifest(), originalHash, _ => Task.CompletedTask);
        Assert.Equal(Exe, File.ReadAllBytes(target));
        Assert.Equal("keep pairing and indexes", File.ReadAllText(marker));
    }

    [Fact]
    public async Task Changed_target_or_replaced_candidate_is_rejected_before_touching_target()
    {
        Directory.CreateDirectory(_root); var target=Path.Combine(_root,"app.exe"); var candidate=Path.Combine(_root,"candidate.exe");
        File.WriteAllText(target,"existing"); File.WriteAllBytes(candidate,Exe);
        await Assert.ThrowsAsync<InvalidDataException>(()=>UpdateReplacement.ReplaceAndLaunchAsync(candidate,target,Manifest(),new string('0',64),_=>Task.CompletedTask));
        File.WriteAllText(candidate,"tampered");
        await Assert.ThrowsAsync<InvalidDataException>(()=>UpdateReplacement.ReplaceAndLaunchAsync(candidate,target,Manifest(),UpdateFiles.Hash(target),_=>Task.CompletedTask));
        Assert.Equal("existing",File.ReadAllText(target));
    }

    [Fact]
    public async Task Custom_mirror_requires_signature_and_does_not_offer_current_build()
    {
        var data=Bytes(Manifest());var signature=Sign(data);
        using var http=new UpdateHttp(new StubHandler(r=>new(HttpStatusCode.OK){Content=new ByteArrayContent(r.RequestUri!.AbsolutePath.EndsWith(".sig")?signature:data)}));
        Assert.Null(await new DesktopUpdateSource(http,Verifier(),2).CheckAsync("https://mirror.example.com/update.json",CancellationToken.None));
        Assert.Equal(2,(await new DesktopUpdateSource(http,Verifier(),1).CheckAsync("https://mirror.example.com/update.json",CancellationToken.None))!.Manifest.Build);
        using var tampered=new UpdateHttp(new StubHandler(r=>new(HttpStatusCode.OK){Content=new ByteArrayContent(r.RequestUri!.AbsolutePath.EndsWith(".sig")?new byte[256]:data)}));
        await Assert.ThrowsAsync<InvalidDataException>(()=>new DesktopUpdateSource(tampered,Verifier(),1).CheckAsync("https://mirror.example.com/update.json",CancellationToken.None));
    }

    [Fact]
    public void Helper_rejects_jobs_outside_its_owned_update_directory()
    {
        Assert.Throws<InvalidDataException>(()=>UpdateInstaller.ValidateDirectory(_root));
        Assert.Throws<InvalidDataException>(()=>UpdateInstaller.ValidateDirectory(Path.Combine(DesktopRelease.UpdateRoot,"..","arbitrary")));
        Assert.Throws<InvalidDataException>(()=>UpdateInstaller.ValidateDirectory(Path.Combine(DesktopRelease.UpdateRoot,"not-a-generated-job")));
    }

    private sealed class StubHandler(Func<HttpRequestMessage,HttpResponseMessage> handle) : HttpMessageHandler
    { protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellationToken) { cancellationToken.ThrowIfCancellationRequested(); return Task.FromResult(handle(request)); } }
    private sealed class NonSeekableStream(byte[] bytes) : MemoryStream(bytes)
    {
        public override bool CanSeek => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    }
    public void Dispose() { _key.Dispose(); if(Directory.Exists(_root))Directory.Delete(_root,true); }
}
