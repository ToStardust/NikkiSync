using System.IO;
using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace NikkiSync.WindowsShell.Tests;

public sealed class NativeRecoveryEntryTests
{
    [Fact]
    public void Recovery_actions_are_native_and_outside_the_replaceable_web_or_error_surface()
    {
        var xaml=XDocument.Load(Source("../windows-shell/MainWindow.xaml"));
        XNamespace presentation="http://schemas.microsoft.com/winfx/2006/xaml/presentation",x="http://schemas.microsoft.com/winfx/2006/xaml";
        var footer=xaml.Descendants().SingleOrDefault(element=>(string?)element.Attribute(x+"Name")=="NativeRecoveryPanel");
        Assert.NotNull(footer);Assert.Equal("Bottom",(string?)footer.Attribute("DockPanel.Dock"));
        Assert.Null(footer.Attribute("Visibility"));
        Assert.DoesNotContain(footer.Ancestors(),element=>(string?)element.Attribute(x+"Name")=="MainSurface");
        foreach(var (name,label,handler) in new[]{("NativeRestartButton","重启同步服务","OnNativeRestartClick"),("NativeExportButton","导出诊断包","OnNativeExportClick")})
        {
            var button=footer.Descendants(presentation+"Button").Single(element=>(string?)element.Attribute(x+"Name")==name);
            Assert.Equal(label,(string?)button.Attribute("Content"));Assert.Equal(handler,(string?)button.Attribute("Click"));Assert.Null(button.Attribute("Visibility"));
        }
    }
    private static string Source(string relative,[CallerFilePath]string caller="")=>Path.GetFullPath(Path.Combine(Path.GetDirectoryName(caller)!,relative));
}
