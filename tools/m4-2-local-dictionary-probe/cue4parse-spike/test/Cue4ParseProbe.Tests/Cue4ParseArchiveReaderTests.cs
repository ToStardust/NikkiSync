using Cue4ParseProbe;
using Xunit;

namespace Cue4ParseProbe.Tests;

public sealed class Cue4ParseArchiveReaderTests
{
    [Fact]
    public void Invalid_archive_is_skipped_without_writing_to_it()
    {
        using var fixture = InvalidArchiveFixture.Create();
        var reader = new Cue4ParseArchiveReader();
        var paths = reader.ListVirtualPaths(fixture.PaksPath);

        Assert.Empty(paths);
        Assert.Equal([1, 2, 3], File.ReadAllBytes(Path.Combine(fixture.PaksPath, "Invalid.utoc")));
    }

    private sealed class InvalidArchiveFixture : IDisposable
    {
        private readonly string _root;
        public string PaksPath { get; }

        private InvalidArchiveFixture(string root)
        {
            _root = root;
            PaksPath = Path.Combine(root, "Paks");
        }

        public static InvalidArchiveFixture Create()
        {
            var root = Path.Combine(Path.GetTempPath(), "Cue4ParseProbeTests", Guid.NewGuid().ToString("N"));
            var fixture = new InvalidArchiveFixture(root);
            Directory.CreateDirectory(fixture.PaksPath);
            File.WriteAllBytes(Path.Combine(fixture.PaksPath, "Invalid.utoc"), [1, 2, 3]);
            return fixture;
        }

        public void Dispose()
        {
            if (Directory.Exists(_root)) Directory.Delete(_root, true);
        }
    }
}
