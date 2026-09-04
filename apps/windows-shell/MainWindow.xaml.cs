using System.Text.Json;
using System.Net.Http;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using NikkiSync.WindowsShell.Services;

namespace NikkiSync.WindowsShell;

public partial class MainWindow : Window
{
    private readonly DesktopWindowLifecycle _lifecycle = new();
    private readonly ServiceProcessHost _service = new(new ProcessServiceFactory(), new HttpHealthClient(new HttpClient()));
    private readonly AutostartService _autostart = new(new RegistryRunEntryStore());
    private readonly TrayService _tray = new();
    private Uri? _controlOrigin;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        Closing += OnClosing;
        _tray.ShowRequested += (_, _) => ActivateFromSecondaryInstance();
        _tray.ExitRequested += async (_, _) => await ExitAsync();
    }

    public void ActivateFromSecondaryInstance()
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.BeginInvoke(new Action(ActivateFromSecondaryInstance));
            return;
        }

        Show();
        WindowState = WindowState.Normal;
        Activate();
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            var endpoint = await _service.StartAsync(AppContext.BaseDirectory, CancellationToken.None);
            _controlOrigin = new Uri(endpoint.GetLeftPart(UriPartial.Authority));
            await ControlPage.EnsureCoreWebView2Async();
            ControlPage.CoreWebView2.NavigationStarting += OnNavigationStarting;
            ControlPage.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            ControlPage.Source = new Uri(_controlOrigin, "/");
        }
        catch (Exception error)
        {
            Content = new TextBlock { Text = $"NikkiSync 无法启动。请查看 %LOCALAPPDATA%\\NikkiSync\\startup-error.log\n\n{error.Message}", TextWrapping = TextWrapping.Wrap, Margin = new Thickness(24) };
        }
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (_controlOrigin is null || !Uri.TryCreate(e.Uri, UriKind.Absolute, out var target) || target.GetLeftPart(UriPartial.Authority) != _controlOrigin.GetLeftPart(UriPartial.Authority)) e.Cancel = true;
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (_controlOrigin is null || !Uri.TryCreate(e.Source, UriKind.Absolute, out var source) || source.GetLeftPart(UriPartial.Authority) != _controlOrigin.GetLeftPart(UriPartial.Authority)) return;
        using var message = JsonDocument.Parse(e.WebMessageAsJson);
        if (!message.RootElement.TryGetProperty("type", out var type)) return;
        if (type.GetString() == "getAutostart") ReplyAutostart();
        if (type.GetString() == "setAutostart" && message.RootElement.TryGetProperty("enabled", out var enabled) && (enabled.ValueKind is JsonValueKind.True or JsonValueKind.False))
        {
            _autostart.SetEnabled(enabled.GetBoolean(), Environment.ProcessPath ?? throw new InvalidOperationException("Current executable path is unavailable."));
            ReplyAutostart();
        }
    }

    private void ReplyAutostart() => ControlPage.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "autostart", enabled = _autostart.IsEnabled() }));

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        _lifecycle.OnWindowClosing();
        if (_lifecycle.HideWindow) { e.Cancel = true; Hide(); }
    }

    private async Task ExitAsync()
    {
        _lifecycle.OnExplicitExit();
        _tray.Dispose();
        await _service.StopAsync();
        System.Windows.Application.Current.Shutdown();
    }
}
