using Cue4ParseProbe;
using Xunit;

namespace Cue4ParseProbe.Tests;

public sealed class ResourceClassifierTests
{
    [Theory]
    [InlineData("/Game/Data/Clothes/DT_Clothes.uasset", "data-table", true)]
    [InlineData("/Game/Localization/Default.locres", "localization", true)]
    [InlineData("/Game/Movies/Intro.bk2", "media", false)]
    public void Classify_is_conservative(string path, string expectedKind, bool expectedCandidate)
    {
        var type = typeof(ProgramAnchor).Assembly.GetType("Cue4ParseProbe.ResourceClassifier");
        var method = type?.GetMethod("Classify");
        Assert.NotNull(method);
        var result = method!.Invoke(null, [path]);
        Assert.NotNull(result);
        Assert.Equal(expectedKind, result!.GetType().GetProperty("ResourceKind")!.GetValue(result));
        Assert.Equal(expectedCandidate, result.GetType().GetProperty("Candidate")!.GetValue(result));
    }
}
