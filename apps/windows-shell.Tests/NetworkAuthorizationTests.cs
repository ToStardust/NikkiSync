using System.Security.Cryptography;
using System.IO;
using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell.Tests;

public class NetworkAuthorizationTests
{
    [Fact]
    public void OptInActualRuleRoundTripAddsReadsDeduplicatesAndRemovesOnlyItsUniqueFixture()
    {
        if(Environment.GetEnvironmentVariable("MOMO_NETWORK_RULE_WRITE_TEST")!="1") return;
        var fixture=Path.Combine(Path.GetTempPath(),"MomoCamera-rule-"+Guid.NewGuid().ToString("N"),"NikkiSync-PC-service.exe");
        var plan=NetworkAuthorizationPlan.Create(fixture,28080);
        var policy=Activator.CreateInstance(Type.GetTypeFromProgID("HNetCfg.FwPolicy2")!)!;
        try
        {
            var type=typeof(NetworkAuthorization).GetNestedType("WindowsRules",System.Reflection.BindingFlags.NonPublic)!;
            var rules=(INetworkAuthorizationRules)Activator.CreateInstance(type,policy)!;
            Assert.Null(rules.Find(plan));
            try
            {
                Assert.Equal(0,NetworkAuthorization.ApplyRules(rules,plan,false));
                Assert.Equal(new NetworkRulePresence(true,true),rules.Find(plan));
                Assert.Equal(8,NetworkAuthorization.ApplyRules(rules,plan,false));
                Assert.Equal(9,NetworkAuthorization.ApplyRules(rules,plan,true));
                Assert.Null(rules.Find(plan));
            }
            finally { rules.Remove(plan.RuleName); }
        }
        finally { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(policy); }
    }
    [Fact]
    public void ActualWindowsRuleLookupReturnsMissingInsteadOfFailingTheHelper()
    {
        var policy=Activator.CreateInstance(Type.GetTypeFromProgID("HNetCfg.FwPolicy2")!)!;
        try
        {
            var type=typeof(NetworkAuthorization).GetNestedType("WindowsRules",System.Reflection.BindingFlags.NonPublic)!;
            var rules=(INetworkAuthorizationRules)Activator.CreateInstance(type,policy)!;
            Assert.Null(rules.Find(NetworkAuthorizationPlan.Create(@"C:\MomoCamera-nonexistent-test\NikkiSync-PC-service.exe",28080)));
        }
        finally { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(policy); }
    }

    [Theory]
    [InlineData(202,"读取规则")]
    [InlineData(203,"添加规则")]
    [InlineData(204,"撤销规则")]
    [InlineData(6,"NET-AUTH-6")]
    public void FailedAuthorizationReportsItsExactOperation(int code,string expected) => Assert.Contains(expected,NetworkAuthorization.ResultMessage(code));
    private sealed class Rules:INetworkAuthorizationRules
    {
        public NetworkRulePresence? Value;
        public int Adds,Removes;
        public NetworkRulePresence? Find(NetworkAuthorizationPlan plan)=>Value;
        public void Add(NetworkAuthorizationPlan plan) { Adds++;Value=new(true,true); }
        public void Remove(string name) { Removes++;Value=null; }
    }

    [Fact]
    public void RepeatedAuthorizationIsIdempotentAndRevocationOnlyRemovesOurRule()
    {
        var plan=NetworkAuthorizationPlan.Create(@"C:\example\NikkiSync-PC-service.exe",28080);
        var rules=new Rules();
        Assert.Equal(0,NetworkAuthorization.ApplyRules(rules,plan,false));
        Assert.Equal(8,NetworkAuthorization.ApplyRules(rules,plan,false));
        Assert.Equal(1,rules.Adds);
        Assert.Equal(9,NetworkAuthorization.ApplyRules(rules,plan,true));
        Assert.Equal(9,NetworkAuthorization.ApplyRules(rules,plan,true));
        Assert.Equal(1,rules.Removes);
    }

    [Fact]
    public void UnexpectedRulesAreNeverOverwrittenOrDeleted()
    {
        var plan=NetworkAuthorizationPlan.Create(@"C:\example\NikkiSync-PC-service.exe",28080);
        var rules=new Rules{Value=new(false,false)};
        Assert.Equal(6,NetworkAuthorization.ApplyRules(rules,plan,false));
        Assert.Equal(6,NetworkAuthorization.ApplyRules(rules,plan,true));
        rules.Value=new(true,false);
        Assert.Equal(6,NetworkAuthorization.ApplyRules(rules,plan,false));
        Assert.Equal(0,rules.Adds);Assert.Equal(0,rules.Removes);
    }
    [Fact]
    public void WindowsAcceptsTheNarrowRuleWithoutAddingItToTheFirewall() =>
        Assert.True(NetworkAuthorization.VerifyRuleConstruction(NetworkAuthorizationPlan.Create(@"C:\example\NikkiSync-PC-service.exe",28080)));

    [Fact]
    public void PermissionIsBoundToBackendPortAndLocalSubnet()
    {
        var plan = NetworkAuthorizationPlan.Create(@"C:\Users\Example\cache\runtime\NikkiSync-PC-service.exe", 28080);
        Assert.Equal(6, plan.Protocol);
        Assert.Equal(1, plan.Direction);
        Assert.Equal(6, plan.Profiles); // Private + Public, never Domain.
        Assert.Equal("LocalSubnet", plan.RemoteAddresses);
        Assert.Equal("28080", plan.LocalPorts);
        Assert.False(plan.EdgeTraversal);
        Assert.Equal(plan, NetworkAuthorizationPlan.Create(plan.Program.ToUpperInvariant(), 28080));
        Assert.NotEqual(plan.RuleName, NetworkAuthorizationPlan.Create(@"C:\Other\runtime\NikkiSync-PC-service.exe", 28080).RuleName);
    }

    [Theory]
    [InlineData("relative.exe",28080)]
    [InlineData(@"C:\Windows\System32\cmd.exe",28080)]
    [InlineData(@"\\server\share\NikkiSync-PC-service.exe",28080)]
    [InlineData(@"C:\runtime\NikkiSync-PC-service.exe",0)]
    [InlineData(@"C:\runtime\NikkiSync-PC-service.exe",65536)]
    public void RejectsArbitraryProgramsAndPorts(string program,int port) =>
        Assert.Throws<InvalidDataException>(()=>NetworkAuthorizationPlan.Create(program,port));

    [Fact]
    public void OnlyTheEmbeddedBackendBytesCanBeAuthorized()
    {
        var directory=Path.Combine(Path.GetTempPath(),"MomoCamera-auth-test-"+Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var path=Path.Combine(directory,"NikkiSync-PC-service.exe");
        try
        {
            File.WriteAllBytes(path,[1,2,3]);
            var expected=new PayloadFile("runtime/NikkiSync-PC-service.exe",3,Convert.ToHexString(SHA256.HashData(new byte[]{1,2,3})));
            using(var verified=NetworkAuthorization.ValidateBackend(path,expected)) Assert.Equal(3,verified.Length);
            File.WriteAllBytes(path,[3,2,1]);
            Assert.Throws<InvalidDataException>(()=>NetworkAuthorization.ValidateBackend(path,expected));
            Assert.Throws<InvalidDataException>(()=>NetworkAuthorization.ValidateBackend(path,expected with {Path="runtime/other.exe"}));
        }
        finally { File.Delete(path);Directory.Delete(directory); }
    }

    [Fact]
    public void HelperUsesStructuredArgumentsAndExplicitElevation()
    {
        var plan=NetworkAuthorizationPlan.Create(@"C:\cache with spaces\runtime\NikkiSync-PC-service.exe",28080);
        var info=NetworkAuthorization.CreateElevationStartInfo(@"C:\test app\MomoCamera.exe",plan,false);
        Assert.True(info.UseShellExecute);
        Assert.Equal("runas",info.Verb);
        Assert.Equal(new[]{"--authorize-network",plan.Program,"28080","allow"},info.ArgumentList);
        Assert.Equal("remove",NetworkAuthorization.CreateElevationStartInfo(info.FileName,plan,true).ArgumentList[3]);
    }

    [Theory]
    [InlineData(0,"已添加")]
    [InlineData(8,"已经")]
    [InlineData(9,"已撤销")]
    [InlineData(3,"校验")]
    [InlineData(5,"权限")]
    [InlineData(6,"未完成")]
    public void FeedbackNeverPromisesPhoneReachability(int code,string text) => Assert.Contains(text,NetworkAuthorization.ResultMessage(code));
}
