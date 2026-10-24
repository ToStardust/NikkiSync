using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace NikkiSync.WindowsShell.Services;

public sealed record UpdateJob(int ParentId, long ParentStartedUtcTicks, string Target, string OriginalHash, long OriginalBuild, string Token);
public sealed record UpdateHealth(string Token, bool Ready, int ProcessId);

public static class UpdateInstaller
{
    public static Process LaunchHelper(string candidate)
    {
        var directory = ValidateDirectory(Path.GetDirectoryName(candidate)!);
        var current = Environment.ProcessPath ?? throw new InvalidOperationException("找不到当前程序。");
        UpdateFiles.RejectLinks(current);
        if (current.StartsWith(RuntimePayload.UserDirectory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("请把 EXE 放在用户数据目录以外再更新。");
        using (var probe = new FileStream(current + ".write-check-" + Guid.NewGuid().ToString("N"), FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.DeleteOnClose)) { }
        var manifestBytes = File.ReadAllBytes(Path.Combine(directory,"manifest.json"));
        var signature = File.ReadAllBytes(Path.Combine(directory,"manifest.sig"));
        var manifest = DesktopRelease.CreateVerifier().Verify(manifestBytes,signature,DesktopRelease.Build);
        UpdateFiles.VerifyExecutable(candidate,manifest);
        using var parent=Process.GetCurrentProcess();
        var job = new UpdateJob(parent.Id,parent.StartTime.ToUniversalTime().Ticks,current,UpdateFiles.Hash(current),DesktopRelease.Build,Guid.NewGuid().ToString("N"));
        File.WriteAllText(Path.Combine(directory,"job.json"),JsonSerializer.Serialize(job));
        var helper=Path.Combine(directory,"helper.exe"); File.Copy(current,helper,false);
        if(UpdateFiles.Hash(helper)!=job.OriginalHash)throw new InvalidDataException("更新助手校验失败。");
        var info = new ProcessStartInfo(helper) { UseShellExecute=false, CreateNoWindow=true, WorkingDirectory=directory };
        info.ArgumentList.Add("--apply-update"); info.ArgumentList.Add(directory);
        return Process.Start(info) ?? throw new IOException("更新助手未启动。");
    }
    public static string ValidateDirectory(string directory)
    {
        directory=Path.GetFullPath(directory);
        if(!string.Equals(Path.GetDirectoryName(directory),Path.GetFullPath(DesktopRelease.UpdateRoot),StringComparison.OrdinalIgnoreCase)
            || !Guid.TryParseExact(Path.GetFileName(directory),"N",out _))throw new InvalidDataException("更新工作目录无效。");
        UpdateFiles.RejectLinks(directory); return directory;
    }
    public static async Task ApplyAsync(string directory)
    {
        directory=ValidateDirectory(directory);
        var job=JsonSerializer.Deserialize<UpdateJob>(File.ReadAllText(Path.Combine(directory,"job.json"))) ?? throw new InvalidDataException("更新任务无效。");
        var helper=Environment.ProcessPath!;
        if(!string.Equals(helper,Path.Combine(directory,"helper.exe"),StringComparison.OrdinalIgnoreCase) || UpdateFiles.Hash(helper)!=job.OriginalHash
            || job.OriginalBuild!=DesktopRelease.Build || Path.GetExtension(job.Target)!=".exe" || job.Target.StartsWith("\\\\")
            || job.Target.StartsWith(RuntimePayload.UserDirectory+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)
            || !Guid.TryParseExact(job.Token,"N",out _))throw new InvalidDataException("更新任务与原程序不匹配。");
        var manifest=DesktopRelease.CreateVerifier().Verify(File.ReadAllBytes(Path.Combine(directory,"manifest.json")),File.ReadAllBytes(Path.Combine(directory,"manifest.sig")),job.OriginalBuild);
        try
        {
            using var parent=Process.GetProcessById(job.ParentId);
            if(parent.StartTime.ToUniversalTime().Ticks!=job.ParentStartedUtcTicks)throw new InvalidDataException("原程序进程已变化。");
            if(!await Task.Run(()=>parent.WaitForExit(60000)))throw new IOException("原程序未能退出，已保留原版本。");
        }
        catch(ArgumentException) { /* Parent completed its normal shutdown before helper startup. */ }
        Process? next=null;
        try
        {
            await UpdateReplacement.ReplaceAndLaunchAsync(Path.Combine(directory,"candidate.exe"),job.Target,manifest,job.OriginalHash,async target=>
            {
                var info=new ProcessStartInfo(target){UseShellExecute=false,WorkingDirectory=Path.GetDirectoryName(target)!};
                info.ArgumentList.Add("--update-health");info.ArgumentList.Add(directory);
                next=Process.Start(info) ?? throw new IOException("新版程序未能启动。");
                try
                {
                var deadline=DateTime.UtcNow.AddMinutes(5);
                while(DateTime.UtcNow<deadline)
                {
                    var healthPath=Path.Combine(directory,"health.json");
                    if(File.Exists(healthPath))
                    {
                        var health=JsonSerializer.Deserialize<UpdateHealth>(File.ReadAllText(healthPath));
                        if(health?.Token==job.Token && health.ProcessId==next.Id)
                        {if(health.Ready)return;throw new IOException("新版未完成启动，已恢复旧程序。");}
                    }
                    if(next.HasExited)throw new IOException("新版提前退出，已恢复旧程序。");
                    await Task.Delay(250);
                }
                throw new IOException("新版启动验证超时，已恢复旧程序。");
                }
                catch
                {
                    if(!next.HasExited){next.Kill(true);await next.WaitForExitAsync();}
                    throw;
                }
            });
            File.WriteAllText(Path.Combine(directory,"result.txt"),"updated");
        }
        catch
        {
            // Stop the new tree BEFORE rollback: Windows cannot replace a running EXE.
            // The callback below owns this shutdown; the outer guard is a fallback.
            if(next is {HasExited:false}){next.Kill(true);await next.WaitForExitAsync();}
            File.WriteAllText(Path.Combine(directory,"result.txt"),"failed");
            Process.Start(new ProcessStartInfo(job.Target){UseShellExecute=true,WorkingDirectory=Path.GetDirectoryName(job.Target)!});
            throw;
        }
        finally { next?.Dispose(); }
    }
    public static void ReportHealth(string directory,bool ready)
    {
        directory=ValidateDirectory(directory);
        var job=JsonSerializer.Deserialize<UpdateJob>(File.ReadAllText(Path.Combine(directory,"job.json")))!;
        if(!string.Equals(Path.GetFullPath(job.Target),Environment.ProcessPath,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("更新验证目标不匹配。");
        var manifest=DesktopRelease.CreateVerifier().Verify(File.ReadAllBytes(Path.Combine(directory,"manifest.json")),File.ReadAllBytes(Path.Combine(directory,"manifest.sig")),job.OriginalBuild);
        if(manifest.Build!=DesktopRelease.Build || manifest.Version!=DesktopRelease.Version || !UpdateFiles.Hash(Environment.ProcessPath!).Equals(manifest.Sha256,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("新版身份与更新清单不一致。");
        var path=Path.Combine(directory,"health.json");var temporary=path+".tmp";
        File.WriteAllText(temporary,JsonSerializer.Serialize(new UpdateHealth(job.Token,ready,Environment.ProcessId))); File.Move(temporary,path,true);
    }
}
