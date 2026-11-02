using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;

namespace NikkiSync.WindowsShell.Services;

/// <summary>Uses the Windows Mobile Hotspot API, preserving the user's name/password and pre-existing hotspot.</summary>
public sealed class TemporaryHotspot
{
    public bool StartedHere { get; private set; }
    private bool _busy;
    public async Task<(string Message,string Credentials)> ChangeAsync(bool stop)
    {
        if(stop)while(_busy)await Task.Delay(100);
        if(_busy)return ("正在处理临时组网，请稍候。","");
        if(stop&&!StartedHere)return ("没有由本次助手开启的热点；已有系统热点保持不变。","");
        _busy=true;
        try
        {
            var script=Script+(stop?"\nInvoke-Hotspot $true":"\nInvoke-Hotspot $false");
            var info=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe")){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8};
            info.ArgumentList.Add("-NoProfile");info.ArgumentList.Add("-NonInteractive");info.ArgumentList.Add("-EncodedCommand");info.ArgumentList.Add(Convert.ToBase64String(Encoding.Unicode.GetBytes(script)));
            using var process=Process.Start(info)??throw new InvalidOperationException();
            var output=process.StandardOutput.ReadToEndAsync();var error=process.StandardError.ReadToEndAsync();
            using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(40));
            try{await process.WaitForExitAsync(timeout.Token);}catch{try{process.Kill(true);}catch{}throw;}
            await error;using var result=JsonDocument.Parse(await output);
            if(!result.RootElement.GetProperty("ok").GetBoolean())return (stop?"Windows 未能关闭热点，请打开系统热点设置手动关闭。":"Windows 暂时不能开启热点。请打开系统热点设置，检查无线网卡和可共享的网络；助手没有修改防火墙或原有网络配置。","");
            if(stop){StartedHere=false;return ("临时组网已结束。手机可重新连接平时使用的 Wi-Fi。","");}
            StartedHere|=result.RootElement.GetProperty("started").GetBoolean();
            return (StartedHere?"热点已开启。手机连接下方 Wi-Fi 后，返回 App 扫描电脑二维码；使用完请点击结束临时组网。":"电脑热点原本已开启，继续使用现有热点。助手不会自动关闭它。",
                "网络名称："+result.RootElement.GetProperty("ssid").GetString()+"\n密码："+result.RootElement.GetProperty("password").GetString());
        }
        catch{return ("临时组网未完成，请打开系统热点设置操作。若系统已开启热点，使用完请在系统设置关闭。","");}
        finally{_busy=false;}
    }
    public const string Script="""
    $ErrorActionPreference='Stop'
    [Console]::OutputEncoding=[Text.Encoding]::UTF8
    function Await-Result($operation,$resultType) {
      $method=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
      $task=$method.MakeGenericMethod($resultType).Invoke($null,@($operation))
      $task.GetAwaiter().GetResult()
    }
    function Invoke-Hotspot([bool]$stop) {
      try {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        $null=[Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]
        $null=[Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]
        $resultType=[Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]
        $profile=[Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
        if($null -eq $profile){throw 'no_profile'}
        $manager=[Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
        $started=$false
        if($stop){$result=Await-Result ($manager.StopTetheringAsync()) $resultType;if([string]$result.Status -ne 'Success'){throw 'stop_failed'};@{ok=$true;started=$false;ssid='';password=''}|ConvertTo-Json -Compress;return}
        $config=$manager.GetCurrentAccessPointConfiguration()
        if([string]$manager.TetheringOperationalState -ne 'On'){
          $result=Await-Result ($manager.StartTetheringAsync()) $resultType
          if([string]$result.Status -ne 'Success'){throw 'start_failed'}
          $started=$true
        }
        @{ok=$true;started=$started;ssid=$config.Ssid;password=$config.Passphrase}|ConvertTo-Json -Compress
      } catch { @{ok=$false}|ConvertTo-Json -Compress }
    }
    """;
}
