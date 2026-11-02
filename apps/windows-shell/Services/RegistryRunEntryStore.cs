using Microsoft.Win32;

namespace NikkiSync.WindowsShell.Services;

public sealed class RegistryRunEntryStore : IRunEntryStore
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "NikkiSync PC";

    public string? Value
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: false);
            return key?.GetValue(ValueName) as string;
        }
        set
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKey, writable: true);
            if (value is null) key.DeleteValue(ValueName, throwOnMissingValue: false);
            else key.SetValue(ValueName, value, RegistryValueKind.String);
        }
    }
}
