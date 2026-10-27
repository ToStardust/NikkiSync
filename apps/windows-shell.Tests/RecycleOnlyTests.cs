using System.IO;
using System.Security.Cryptography;
using NikkiSync.WindowsShell.Services;
using Xunit;

public class RecycleOnlyTests
{
    [Fact]public void PermanentDeleteOrChangedFileIsVetoedBeforeOperation()
    {
        var safe=new RecycleOnly.RecycleSink(()=>true);
        Assert.True(safe.PreDeleteItem(0,null!)<0);
        Assert.Equal(0,safe.PreDeleteItem(0x80,null!));
        Assert.True(new RecycleOnly.RecycleSink(()=>false).PreDeleteItem(0x80,null!)<0);
        Assert.True(new RecycleOnly.RecycleSink(()=>throw new IOException()).PreDeleteItem(0x80,null!)<0);
        safe.PostDeleteItem(0x80,null!,0,null);Assert.False(safe.Recycled);
    }
    [Fact]public void FingerprintGuardsPreserveReplacementAndRejectNonMedia()
    {
        string dir=Path.Combine(Path.GetTempPath(),"momo-recycle-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(dir);
        try{string file=Path.Combine(dir,"sample.jpeg");File.WriteAllText(file,"original");string hash=Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))).ToLowerInvariant();
            Assert.True(RecycleOnly.Validate(file,hash,8));File.WriteAllText(file,"replaced");Assert.False(RecycleOnly.Validate(file,hash,8));Assert.NotEqual(0,RecycleOnly.Run(file,hash,"8"));Assert.Equal("replaced",File.ReadAllText(file));
            Assert.False(RecycleOnly.Validate("relative.jpeg",hash,8));Assert.False(RecycleOnly.Validate(Path.Combine(dir,"settings.json"),hash,8));
        }finally{Directory.Delete(dir,true);}
    }
    [Fact]public async Task StopDoesNotDisableAnExistingSystemHotspot()
    {
        var hotspot=new TemporaryHotspot();Assert.False(hotspot.StartedHere);
        var result=await hotspot.ChangeAsync(true);Assert.Contains("已有系统热点保持不变",result.Message);
    }
}
