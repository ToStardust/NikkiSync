using System.IO;
using System.Windows;
using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell;

// Native download guidance remains available when the local photo service cannot start.
public sealed partial class UpdateWindow : Window
{
    private readonly MainWindow _owner;
    private readonly CancellationTokenSource _cancel = new();
    private CancellationTokenSource? _operation;
    private bool _busy;
    private VerifiedUpdate? _update;

    public UpdateWindow(MainWindow owner, VerifiedUpdate? available = null)
    {
        _owner = owner;
        Owner = owner;
        InitializeComponent();
        Height = Math.Min(Height, SystemParameters.WorkArea.Height * .92);
        Width = Math.Min(Width, SystemParameters.WorkArea.Width * .94);
        MinWidth = Math.Min(MinWidth, Width);
        MinHeight = Math.Min(MinHeight, Height);
        _version.Text = $"当前 {DesktopRelease.Version}";
        _status.Text = "点击检查获取新版本，或从上方网盘下载安装包。";
        try { _source.Text = ReadSource() ?? ""; }
        catch { _status.Text = "自定义更新源配置无法读取，可从上方网盘下载安装包。"; }
        _quark.Click += (_, _) => OpenDownload("quark");
        _baidu.Click += (_, _) => OpenDownload("downloads");
        _github.Click += (_, _) => OpenDownload("releases");
        _action.Click += async (_, _) => { if (_update is null) await CheckAsync(); else await InstallAsync(); };
        _cancelDownload.Click += (_, _) => { _cancelDownload.IsEnabled = false; _operation?.Cancel(); };
        _saveSource.Click += async (_, _) =>
        {
            if (_busy) return;
            try
            {
                var text = _source.Text.Trim();
                if (text.Length > 2048) throw new InvalidDataException("地址过长。");
                if (text.Length > 0) UpdateHttp.RequireHttps(new Uri(text));
                Directory.CreateDirectory(DesktopRelease.UpdateRoot);
                UpdateFiles.RejectLinks(DesktopRelease.UpdateRoot);
                File.WriteAllText(Path.Combine(DesktopRelease.UpdateRoot, "source.txt"), text);
            }
            catch { _status.Text = "请填写有效的 HTTPS 更新清单地址，并确认配置目录可写。"; return; }
            _update = null;
            _action.Content = "检查更新";
            await CheckAsync();
        };
        Closed += (_, _) => _cancel.Cancel();
        if (available is not null) ShowAvailable(available);
    }

    private void OpenDownload(string name)
    {
        var url = DesktopProjectLinks.Resolve(name);
        if (url is null) return;
        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true }); }
        catch
        {
            try { System.Windows.Clipboard.SetText(url); _status.Text = "无法打开浏览器，下载链接已复制。"; }
            catch { _status.Text = "暂时无法打开浏览器，请稍后重试。"; }
        }
    }

    public static string? ReadSource()
    {
        var path = Path.Combine(DesktopRelease.UpdateRoot, "source.txt");
        UpdateFiles.RejectLinks(path);
        if (!File.Exists(path)) return null;
        if (new FileInfo(path).Length > 4096) throw new InvalidDataException("更新源配置过大。");
        var text = File.ReadAllText(path).Trim();
        return string.IsNullOrEmpty(text) ? null : text;
    }

    private void ShowAvailable(VerifiedUpdate update)
    {
        _update = update;
        _status.Text = $"发现 {update.Manifest.Version} · 安装包 {update.Manifest.Size / 1048576d:F1} MB";
        _notes.Text = update.Manifest.Notes;
        _notesPanel.Visibility = string.IsNullOrWhiteSpace(_notes.Text) ? Visibility.Collapsed : Visibility.Visible;
        _action.Content = "下载并重启更新";
    }

    private void SetBusy(bool busy)
    {
        _busy = busy;
        _action.IsEnabled = !busy;
        _source.IsEnabled = !busy;
        _saveSource.IsEnabled = !busy;
    }

    private async Task CheckAsync()
    {
        if (_busy) return;
        SetBusy(true);
        _status.Text = "正在检查更新… 如果等待较久，可直接使用上方网盘下载。";
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(_cancel.Token);
            timeout.CancelAfter(TimeSpan.FromSeconds(35));
            using var http = new UpdateHttp();
            var update = await new DesktopUpdateSource(http, DesktopRelease.CreateVerifier(), DesktopRelease.Build)
                .CheckAsync(ReadSource() ?? DesktopRelease.DefaultManifestUrl, timeout.Token);
            if (update is null)
            {
                _update = null;
                _notes.Text = "";
                _notesPanel.Visibility = Visibility.Collapsed;
                _status.Text = "当前已是更新源中的最新版本。网盘中的版本可打开文件夹查看。";
                _action.Content = "重新检查";
            }
            else ShowAvailable(update);
        }
        catch (OperationCanceledException) { if (!_cancel.IsCancellationRequested) _status.Text = "检查超时，推荐从夸克或百度网盘下载新版。"; }
        catch (Exception e) { _status.Text = e is InvalidDataException ? "更新信息未通过安全校验，请联系开发者。" : "暂时无法连接更新服务，推荐从夸克或百度网盘下载新版。"; }
        finally { SetBusy(false); }
    }

    private async Task InstallAsync()
    {
        if (_busy || _update is null) return;
        SetBusy(true);
        _progress.Value = 0;
        _progress.Visibility = Visibility.Visible;
        _cancelDownload.IsEnabled = true;
        _cancelDownload.Visibility = Visibility.Visible;
        _status.Text = "正在下载并校验更新。若速度较慢，可取消后从网盘下载。";
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(_cancel.Token);
        _operation = timeout;
        timeout.CancelAfter(TimeSpan.FromMinutes(20));
        try
        {
            using var http = new UpdateHttp();
            var candidate = await new UpdateDownloader(http, DesktopRelease.UpdateRoot, patchTool: _owner.UpdatePatchTool)
                .DownloadAsync(_update, new Progress<double>(p => _progress.Value = p * 100), timeout.Token);
            timeout.Token.ThrowIfCancellationRequested();
            using var helper = UpdateInstaller.LaunchHelper(candidate);
            _status.Text = "校验完成，正在重启…";
            await _owner.ExitAsync();
        }
        catch (OperationCanceledException) { if (!_cancel.IsCancellationRequested) _status.Text = "下载已取消或超时，可重试，或使用上方网盘下载。原程序和数据保留。"; }
        catch (Exception e) { _status.Text = e is UnauthorizedAccessException ? "程序所在文件夹不可写，请将 EXE 移到自己的文件夹后重试。" : e is InvalidDataException ? "更新未通过安全校验，原程序未替换。" : "更新未完成，可重试或从网盘下载。原程序和数据保留。"; }
        finally
        {
            _operation = null;
            _cancelDownload.Visibility = Visibility.Collapsed;
            _progress.Visibility = Visibility.Collapsed;
            SetBusy(false);
        }
    }
}
