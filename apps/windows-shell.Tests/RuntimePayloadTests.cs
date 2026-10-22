using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell.Tests;

public sealed class RuntimePayloadTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "NikkiSync-payload-test-" + Guid.NewGuid().ToString("N"));
    private static readonly byte[] Content = Encoding.UTF8.GetBytes("test service bytes");
    private static readonly PayloadFile File = new("runtime/NikkiSync-PC-service.exe", Content.Length, Hash(Content));
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));
    private static byte[] Archive(params (string Path, byte[] Bytes)[] files)
    {
        using var memory = new MemoryStream();
        using (var zip = new ZipArchive(memory, ZipArchiveMode.Create, true))
            foreach (var file in files) { using var entry = zip.CreateEntry(file.Path).Open(); entry.Write(file.Bytes); }
        return memory.ToArray();
    }

    [Fact]
    public void Extracts_exact_payload_and_reuses_verified_files_without_rewriting()
    {
        var zip = Archive((File.Path, Content));
        var path = RuntimePayload.Deploy(new MemoryStream(zip), Hash(zip), _root, [File]);
        var service = Path.Combine(path, File.Path);
        var originalTime = DateTime.UtcNow.AddDays(-1);
        System.IO.File.SetLastWriteTimeUtc(service, originalTime);
        Assert.Equal(path, RuntimePayload.Deploy(new MemoryStream(zip), Hash(zip), _root, [File]));
        Assert.Equal(originalTime, System.IO.File.GetLastWriteTimeUtc(service));
        Assert.Equal(Content, System.IO.File.ReadAllBytes(service));
    }

    [Fact]
    public void Repairs_corrupt_cached_file_without_trusting_a_completion_marker()
    {
        var zip = Archive((File.Path, Content));
        var path = RuntimePayload.Deploy(new MemoryStream(zip), Hash(zip), _root, [File]);
        System.IO.File.WriteAllBytes(Path.Combine(path, File.Path), Encoding.UTF8.GetBytes("corrupt"));
        RuntimePayload.Deploy(new MemoryStream(zip), Hash(zip), _root, [File]);
        Assert.Equal(Content, System.IO.File.ReadAllBytes(Path.Combine(path, File.Path)));
    }

    [Fact]
    public void Fresh_deploy_and_verified_reuse_report_their_actual_steps()
    {
        var zip=Archive((File.Path,Content));var steps=new List<PayloadPreparationStep>();
        RuntimePayload.Deploy(new MemoryStream(zip),Hash(zip),_root,[File],step:steps.Add);
        Assert.Contains(PayloadPreparationStep.ValidateArchive,steps);
        Assert.Contains(PayloadPreparationStep.ExtractFiles,steps);
        Assert.Contains(PayloadPreparationStep.PublishCache,steps);
        Assert.Equal(PayloadPreparationStep.Ready,steps[^1]);
        steps.Clear();
        RuntimePayload.Deploy(new MemoryStream(zip),Hash(zip),_root,[File],step:steps.Add);
        Assert.Contains(PayloadPreparationStep.ValidateCache,steps);
        Assert.DoesNotContain(PayloadPreparationStep.ExtractFiles,steps);
        Assert.Equal(PayloadPreparationStep.Ready,steps[^1]);
    }

    [Fact]
    public void Actual_exclusive_file_lock_reports_validation_step_and_sharing_violation()
    {
        var zip=Archive((File.Path,Content));
        var path=RuntimePayload.Deploy(new MemoryStream(zip),Hash(zip),_root,[File]);
        using var locked=new FileStream(Path.Combine(path,File.Path),FileMode.Open,FileAccess.Read,FileShare.None);
        var steps=new List<PayloadPreparationStep>();
        var error=Assert.Throws<IOException>(()=>RuntimePayload.Deploy(new MemoryStream(zip),Hash(zip),_root,[File],step:steps.Add));
        Assert.Equal(PayloadPreparationStep.ValidateCache,steps[^1]);
        Assert.Equal("FILE_BUSY",StartupFailure.FromException(error).Code);
    }

    [Fact]
    public void Corrupt_archive_stops_at_archive_validation_and_is_not_published()
    {
        var zip=Archive((File.Path,Content));var steps=new List<PayloadPreparationStep>();
        Assert.Throws<InvalidDataException>(()=>RuntimePayload.Deploy(new MemoryStream(zip),new string('0',64),_root,[File],step:steps.Add));
        Assert.Equal(PayloadPreparationStep.ValidateArchive,steps[^1]);
        Assert.Empty(Directory.GetDirectories(_root));
    }

    [Theory]
    [InlineData("../escape.exe")]
    [InlineData("runtime/../../escape.exe")]
    [InlineData("C:/escape.exe")]
    [InlineData("runtime/evil.exe:stream")]
    public void Rejects_archive_traversal_and_unlisted_files(string extraPath)
    {
        var zip = Archive((File.Path, Content), (extraPath, Content));
        Assert.Throws<InvalidDataException>(() => RuntimePayload.Deploy(new MemoryStream(zip), Hash(zip), _root, [File]));
        Assert.False(System.IO.File.Exists(Path.Combine(_root, "escape.exe")));
    }

    [Fact]
    public void Rejects_wrong_archive_hash_and_file_hash_before_publishing()
    {
        var zip = Archive((File.Path, Content));
        Assert.Throws<InvalidDataException>(() => RuntimePayload.Deploy(new MemoryStream(zip), new string('0', 64), _root, [File]));
        Assert.Throws<InvalidDataException>(() => RuntimePayload.Deploy(new MemoryStream(zip), Hash(zip), _root, [File with { Sha256 = new string('0', 64) }]));
        Assert.False(Directory.Exists(Path.Combine(_root, Hash(zip))));
    }

    [Fact]
    public void Concurrent_launches_publish_one_complete_payload()
    {
        var zip = Archive((File.Path, Content));
        var paths = new string[4];
        Parallel.For(0, 4, i => paths[i] = RuntimePayload.Deploy(new MemoryStream(zip), Hash(zip), _root, [File]));
        Assert.Single(paths.Distinct());
        Assert.Equal(Content, System.IO.File.ReadAllBytes(Path.Combine(paths[0], File.Path)));
        Assert.Empty(Directory.GetDirectories(_root, "*.tmp-*"));
    }

    public void Dispose() { if (Directory.Exists(_root)) Directory.Delete(_root, true); }
}
