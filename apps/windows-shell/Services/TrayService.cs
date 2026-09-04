using Forms = System.Windows.Forms;
using Drawing = System.Drawing;

namespace NikkiSync.WindowsShell.Services;

public sealed class TrayService : IDisposable
{
    private readonly Forms.NotifyIcon _icon;
    public event EventHandler? ShowRequested;
    public event EventHandler? ExitRequested;

    public TrayService()
    {
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("显示 NikkiSync", null, (_, _) => ShowRequested?.Invoke(this, EventArgs.Empty));
        menu.Items.Add("退出 NikkiSync", null, (_, _) => ExitRequested?.Invoke(this, EventArgs.Empty));
        _icon = new Forms.NotifyIcon { Icon = Drawing.SystemIcons.Application, Text = "NikkiSync PC", ContextMenuStrip = menu, Visible = true };
        _icon.DoubleClick += (_, _) => ShowRequested?.Invoke(this, EventArgs.Empty);
    }

    public void Dispose() { _icon.Visible = false; _icon.Dispose(); }
}
