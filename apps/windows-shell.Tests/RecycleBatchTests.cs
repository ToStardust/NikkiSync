using System.IO;
using System.Security.Cryptography;
using NikkiSync.WindowsShell.Services;
using Xunit;

public sealed class RecycleBatchTests
{
    [Fact] public void A_verified_lease_blocks_writes_and_detects_a_replacement_without_hashing_again()
    {
        string folder=Path.Combine(Path.GetTempPath(),"momo-batch-lease-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(folder);
        try
        {
            string file=Path.Combine(folder,"fixture.jpeg");File.WriteAllText(file,"generated original");
            string hash=Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))).ToLowerInvariant();
            using(var lease=RecycleOnly.OpenVerified(file,hash,new FileInfo(file).Length))
            {
                Assert.NotNull(lease);Assert.True(lease.IsCurrent());
                Assert.ThrowsAny<IOException>(()=>File.WriteAllText(file,"changed"));
                File.Move(file,file+".moved");File.WriteAllText(file,"generated replacement");Assert.False(lease.IsCurrent());
            }
            Assert.Null(RecycleOnly.OpenVerified(file,hash,new FileInfo(file).Length));
        }
        finally{Directory.Delete(folder,true);}
    }
    [Fact] public void Batch_request_validation_rejects_duplicates_nonmedia_and_invalid_fingerprints()
    {
        Assert.False(RecycleOnly.ValidBatch([new("relative.jpeg",new string('a',64),1)]));
        Assert.False(RecycleOnly.ValidBatch([new(@"C:\fixture.jpeg",new string('a',64),1),new(@"C:\fixture.jpeg",new string('a',64),1)]));
        Assert.False(RecycleOnly.ValidBatch([new(@"C:\settings.json",new string('a',64),1)]));
        Assert.False(RecycleOnly.ValidBatch([new(@"C:\fixture.jpeg","bad",1)]));
        Assert.False(RecycleOnly.ValidBatch([]));
    }
}
