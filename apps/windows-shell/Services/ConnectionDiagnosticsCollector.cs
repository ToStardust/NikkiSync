using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

namespace NikkiSync.WindowsShell.Services;

public sealed class ConnectionDiagnosticsCollector:IConnectionDiagnosticCollector
{
    public const string Resource="MomoCamera.ConnectionDiagnostics";
    public async Task<DiagnosticCollection> CollectAsync(int desktopPort,CancellationToken cancellationToken)
    {
        var directory=Path.Combine(Path.GetTempPath(),"MomoCamera-Diagnostics-"+Guid.NewGuid().ToString("N"));
        var script=Path.Combine(directory,"Collect.ps1");
        try
        {
            ConnectionDiagnosticsPackage.RejectLinks(directory);Directory.CreateDirectory(directory);
            using(var embedded=Assembly.GetExecutingAssembly().GetManifestResourceStream(Resource)??throw new InvalidDataException())
            await using(var file=new FileStream(script,FileMode.CreateNew,FileAccess.Write,FileShare.None))await embedded.CopyToAsync(file,cancellationToken);
            var info=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe")){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden};
            foreach(var value in new[]{"-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",script,"-OutputDirectory",directory,"-DesktopPort",desktopPort.ToString(System.Globalization.CultureInfo.InvariantCulture)})info.ArgumentList.Add(value);
            using var process=Process.Start(info)??throw new IOException();
            using var deadline=CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);deadline.CancelAfter(TimeSpan.FromSeconds(45));
            try{await process.WaitForExitAsync(deadline.Token);}
            catch(OperationCanceledException){try{process.Kill(true);await process.WaitForExitAsync(CancellationToken.None);}catch(InvalidOperationException){}cancellationToken.ThrowIfCancellationRequested();return new("timeout");}
            if(process.ExitCode!=0)return new("failed",ExitCode:process.ExitCode);
            var files=Directory.GetFiles(directory,"ConnectionReport-*.txt");if(files.Length!=1)return new("unavailable");
            ConnectionDiagnosticsPackage.RejectLinks(files[0]);if(new FileInfo(files[0]).Length>131072)return new("unavailable");
            return new("ok",await File.ReadAllTextAsync(files[0],Encoding.UTF8,cancellationToken));
        }
        catch(System.ComponentModel.Win32Exception error){return new("unavailable",NativeErrorCode:error.NativeErrorCode);}
        catch(Exception error) when(error is IOException or InvalidDataException or UnauthorizedAccessException or System.Security.SecurityException){return new("unavailable");}
        finally
        {
            // Our random directory contains only our script and generated flat report.
            try{foreach(var file in Directory.GetFiles(directory)){ConnectionDiagnosticsPackage.RejectLinks(file);File.Delete(file);}Directory.Delete(directory);}catch(Exception error) when(error is IOException or InvalidDataException or UnauthorizedAccessException){}
        }
    }
}
