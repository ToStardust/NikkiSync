using Cue4ParseProbe;
using Xunit;

namespace Cue4ParseProbe.Tests;

public sealed class GameArchiveDirectoriesTests
{
    [Fact]
    public void Discovery_returns_only_existing_standard_archive_directories()
    {
        using var fixture = GameFixture.Create();
        var type = typeof(ProgramAnchor).Assembly.GetType("Cue4ParseProbe.GameArchiveDirectories");
        var method = type?.GetMethod("Discover");

        Assert.NotNull(method);
        var paths = Assert.IsAssignableFrom<IReadOnlyList<string>>(method!.Invoke(null, [fixture.GameRoot])!);

        Assert.Equal(
        [
            Path.Combine(fixture.GameRoot, "Content", "Paks"),
            Path.Combine(fixture.GameRoot, "Saved", "Paks")
        ], paths);
    }

    private sealed class GameFixture : IDisposable
    {
        private readonly string _root;
        public string GameRoot { get; }

        private GameFixture(string root)
        {
            _root = root;
            GameRoot = Path.Combine(root, "X6Game");
        }

        public static GameFixture Create()
        {
            var root = Path.Combine(Path.GetTempPath(), "Cue4ParseProbeTests", Guid.NewGuid().ToString("N"));
            var fixture = new GameFixture(root);
            Directory.CreateDirectory(Path.Combine(fixture.GameRoot, "Content", "Paks"));
            Directory.CreateDirectory(Path.Combine(fixture.GameRoot, "Saved", "Paks"));
            return fixture;
        }

        public void Dispose()
        {
            if (Directory.Exists(_root)) Directory.Delete(_root, true);
        }
    }
}
