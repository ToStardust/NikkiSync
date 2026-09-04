using Cue4ParseProbe;
using Xunit;

namespace Cue4ParseProbe.Tests;

public sealed class ProbeRunnerTests
{
    [Fact]
    public void Inventory_command_writes_a_report_to_the_explicit_output_directory()
    {
        using var fixture = PaksFixture.Create();

        var exitCode = Program.Main(["inventory", fixture.PaksPath, "--out", fixture.OutputPath]);

        Assert.Equal(0, exitCode);
        Assert.True(File.Exists(Path.Combine(fixture.OutputPath, "inventory-report.json")));
    }

    [Fact]
    public void Inventory_writes_only_candidate_paths_and_preserves_input()
    {
        using var fixture = PaksFixture.Create();
        var runner = new ProbeRunner(new FakeArchiveReader(
            "/Game/Data/Clothes/DT_Clothes.uasset",
            "/Game/Movies/Intro.bk2"));
        var report = runner.Run(new ProbeRequest(ProbeCommand.Inventory, fixture.PaksPath, [], fixture.OutputPath));

        Assert.Single(report.Entries);
        Assert.Equal("/Game/Data/Clothes/DT_Clothes.uasset", report.Entries[0].VirtualPath);
        Assert.True(File.Exists(Path.Combine(fixture.OutputPath, "inventory-report.json")));
    }

    private sealed class FakeArchiveReader(params string[] paths) : IArchiveReader
    {
        public IReadOnlyList<string> ListVirtualPaths(string paksDirectory) => paths;
        public IReadOnlyList<EvidenceHit> FindEntityReferences(string paksDirectory, IReadOnlyList<string> entityIds) => [];
    }

    private sealed class PaksFixture : IDisposable
    {
        private readonly string _root;
        public string PaksPath { get; }
        public string OutputPath { get; }

        private PaksFixture(string root)
        {
            _root = root;
            PaksPath = Path.Combine(root, "Content", "Paks");
            OutputPath = Path.Combine(root, "out");
        }

        public static PaksFixture Create()
        {
            var root = Path.Combine(Path.GetTempPath(), "Cue4ParseProbeTests", Guid.NewGuid().ToString("N"));
            var fixture = new PaksFixture(root);
            Directory.CreateDirectory(fixture.PaksPath);
            File.WriteAllBytes(Path.Combine(fixture.PaksPath, "Default.utoc"), [1, 2, 3]);
            return fixture;
        }

        public void Dispose()
        {
            if (Directory.Exists(_root)) Directory.Delete(_root, true);
        }
    }
}
