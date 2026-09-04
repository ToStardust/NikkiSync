using Cue4ParseProbe;
using Xunit;

namespace Cue4ParseProbe.Tests;

public sealed class PaksDirectoryTests
{
    [Fact]
    public void ValidateAndFingerprint_rejects_a_filesystem_root()
    {
        var type = typeof(ProgramAnchor).Assembly.GetType("Cue4ParseProbe.PaksDirectory");
        var method = type?.GetMethod("ValidateAndFingerprint");
        Assert.NotNull(method);
        var root = Path.GetPathRoot(Path.GetTempPath())!;
        var error = Assert.ThrowsAny<System.Reflection.TargetInvocationException>(() => method!.Invoke(null, [root]));
        Assert.IsType<ArgumentException>(error.InnerException);
    }
}
