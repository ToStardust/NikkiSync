using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using NikkiSync.WindowsShell.Services;
using Button = System.Windows.Controls.Button;
using TextBox = System.Windows.Controls.TextBox;
using ProgressBar = System.Windows.Controls.ProgressBar;
using Color = System.Windows.Media.Color;

namespace NikkiSync.WindowsShell;

// A native update surface stays available even if the local photo service cannot start.
public sealed class UpdateWindow : Window
{
    private readonly MainWindow _owner;
    private readonly TextBlock _status = new(){TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,12,0,12)};
    private readonly TextBlock _notes = new(){TextWrapping=TextWrapping.Wrap,MaxHeight=180};
    private readonly ProgressBar _progress = new(){Height=6,Minimum=0,Maximum=100,Visibility=Visibility.Collapsed};
    private readonly Button _action = new(){Content="检查更新",Padding=new Thickness(18,9,18,9),Margin=new Thickness(0,18,0,0)};
    private readonly TextBox _source = new(){Margin=new Thickness(0,6,0,0),MinHeight=30};
    private readonly CancellationTokenSource _cancel=new();
    private bool _busy;
    private VerifiedUpdate? _update;

    public UpdateWindow(MainWindow owner,VerifiedUpdate? available=null)
    {
        _owner=owner;Owner=owner;Title="大喵相机助手 · 软件更新";Width=520;Height=570;MinHeight=450;ResizeMode=ResizeMode.CanResize;
        WindowStartupLocation=WindowStartupLocation.CenterOwner;Background=new SolidColorBrush(Color.FromRgb(255,248,240));Foreground=new SolidColorBrush(Color.FromRgb(89,71,94));
        var stack=new StackPanel{Margin=new Thickness(28)};
        stack.Children.Add(new TextBlock{Text="软件更新",FontSize=23,FontWeight=FontWeights.SemiBold});
        stack.Children.Add(new TextBlock{Text=$"当前版本 {DesktopRelease.Version} · 公测版",Margin=new Thickness(0,8,0,0)});
        stack.Children.Add(_status);stack.Children.Add(new ScrollViewer{Content=_notes,MaxHeight=185,VerticalScrollBarVisibility=ScrollBarVisibility.Auto});
        stack.Children.Add(_progress);stack.Children.Add(_action);
        var expander=new Expander{Header="国内更新源（可选）",Margin=new Thickness(0,20,0,0)};
        var advanced=new StackPanel();advanced.Children.Add(new TextBlock{Text="填写开发者提供的 HTTPS 更新清单地址；留空使用 GitHub。普通网盘分享链接不能用于自动更新。",TextWrapping=TextWrapping.Wrap});
        _source.Text=ReadSource()??"";advanced.Children.Add(_source);
        var save=new Button{Content="保存并检查",HorizontalAlignment=System.Windows.HorizontalAlignment.Left,Margin=new Thickness(0,8,0,0),Padding=new Thickness(10,5,10,5)};
        save.Click+=async(_,_)=>
        {
            if(_busy)return;
            try { var text=_source.Text.Trim();if(text.Length>2048)throw new InvalidDataException("地址过长。");if(text.Length>0)UpdateHttp.RequireHttps(new Uri(text));
                Directory.CreateDirectory(DesktopRelease.UpdateRoot);UpdateFiles.RejectLinks(DesktopRelease.UpdateRoot);
                File.WriteAllText(Path.Combine(DesktopRelease.UpdateRoot,"source.txt"),text);_update=null;await CheckAsync(); }
            catch(Exception){_status.Text="请填写有效的 HTTPS 更新清单地址。";}
        };
        advanced.Children.Add(save);expander.Content=advanced;stack.Children.Add(expander);
        stack.Children.Add(new TextBlock{Text="更新只替换电脑程序，保留现有配对、设置和相册索引。更新时会短暂断开手机连接。",TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,18,0,0),FontSize=12});
        Content=new ScrollViewer{Content=stack,VerticalScrollBarVisibility=ScrollBarVisibility.Auto};
        _action.Click+=async(_,_)=>{if(_update is null)await CheckAsync();else await InstallAsync();};
        Closed+=(_,_)=>_cancel.Cancel();
        if(available is not null)ShowAvailable(available);else _status.Text="点击检查，获取最新公测版本。";
    }
    public static string? ReadSource()
    {
        var path=Path.Combine(DesktopRelease.UpdateRoot,"source.txt");UpdateFiles.RejectLinks(path);
        if(!File.Exists(path))return null;
        if(new FileInfo(path).Length>4096)throw new InvalidDataException("更新源配置过大。");
        var text=File.ReadAllText(path).Trim();return string.IsNullOrEmpty(text)?null:text;
    }
    private void ShowAvailable(VerifiedUpdate update)
    {
        _update=update;_status.Text=$"发现 {update.Manifest.Version} · {update.Manifest.Size/1048576d:F1} MB";
        _notes.Text=update.Manifest.Notes;_action.Content="下载并重启更新";
    }
    private async Task CheckAsync()
    {
        if(_busy)return;_busy=true;_action.IsEnabled=false;_source.IsEnabled=false;_status.Text="正在检查更新…";
        try
        {
            using var timeout=CancellationTokenSource.CreateLinkedTokenSource(_cancel.Token);timeout.CancelAfter(TimeSpan.FromSeconds(35));
            using var http=new UpdateHttp();var update=await new DesktopUpdateSource(http,DesktopRelease.CreateVerifier(),DesktopRelease.Build).CheckAsync(ReadSource(),timeout.Token);
            if(update is null){_update=null;_notes.Text="";_status.Text="当前已是最新可用版本。";_action.Content="重新检查";}
            else ShowAvailable(update);
        }
        catch(OperationCanceledException){if(!_cancel.IsCancellationRequested)_status.Text="检查超时，请稍后重试，或填写开发者提供的国内更新源。";}
        catch(Exception e){_status.Text=e is InvalidDataException?"更新信息未通过安全校验，请联系开发者。":"暂时无法连接更新服务，请重试或设置国内更新源。";}
        finally{_busy=false;_action.IsEnabled=true;_source.IsEnabled=true;}
    }
    private async Task InstallAsync()
    {
        if(_busy||_update is null)return;_busy=true;_action.IsEnabled=false;_source.IsEnabled=false;_progress.Visibility=Visibility.Visible;_status.Text="正在下载并校验更新，关闭此窗口可取消。";
        try
        {
            using var timeout=CancellationTokenSource.CreateLinkedTokenSource(_cancel.Token);timeout.CancelAfter(TimeSpan.FromMinutes(20));
            using var http=new UpdateHttp();
            var candidate=await new UpdateDownloader(http,DesktopRelease.UpdateRoot).DownloadAsync(_update,new Progress<double>(p=>_progress.Value=p*100),timeout.Token);
            _cancel.Token.ThrowIfCancellationRequested();
            using var helper=UpdateInstaller.LaunchHelper(candidate);
            _status.Text="校验完成，正在重启…";
            await _owner.ExitAsync();
        }
        catch(OperationCanceledException){if(!_cancel.IsCancellationRequested)_status.Text="下载超时，原程序和数据未更改，请重试。";}
        catch(Exception e){_status.Text=e is UnauthorizedAccessException?"程序所在文件夹不可写，请将 EXE 移到自己的文件夹后重试。":e is InvalidDataException?"更新未通过安全校验，原程序未替换。":"更新未完成，原程序和数据保留，请重试。";}
        finally{_busy=false;_action.IsEnabled=true;_source.IsEnabled=true;}
    }
}
