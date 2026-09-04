# M4.3 Windows Desktop Shell Design

## Goal

Turn NikkiSync PC from a consoleless background executable that opens a browser tab into a normal Windows desktop application. The application must show a QR code automatically only before the first phone is paired, then provide a small status surface, a manual QR refresh action, and an opt-in current-user startup setting.

## Scope

M4.3 introduces a Windows-only WPF host using Microsoft Edge WebView2 and a separate local service process. It does not change the Android protocol, pairing protocol, photo resolver, dictionary provider, SQLite schema, or scanning rules.

## Packaging

The release directory contains:

- `NikkiSync-PC.exe`: the WPF desktop host. It owns the visible window, WebView2 lifecycle, tray icon, Run-key startup preference, and service process lifecycle.
- `NikkiSync-PC-service.exe`: the existing Bun application, changed to run the scanner/LAN server/local control page without launching a browser.
- `migrations/0001_initial.sql`: unchanged database migration dependency.

The host starts the sibling service executable with a loopback-only control-page port. It waits for a local health response before navigating WebView2. It terminates the child service when the user selects Exit from the tray menu. Closing the main window hides it to the tray rather than ending synchronization.

## Local Control Page

The service continues to render the control page but binds it only to `127.0.0.1`. The page never becomes a LAN API and is not exposed through mDNS.

Its status response contains only operational information:

- service ready/error state;
- LAN host and port used for phone pairing;
- scanned asset count;
- paired-device count;
- whether a fresh pairing QR is currently displayed.

On startup the page asks the status endpoint whether at least one device is paired. With zero devices it shows the pairing QR automatically. With one or more devices it shows the status bar and a `生成新二维码` button; the button requests a new short-lived pairing token and displays its QR code in a modal. Existing paired devices remain valid.

## UI

The window is a compact Chinese UI titled `NikkiSync PC`:

- header: app name and a connected/starting/error state chip;
- status bar: `同步服务`, `已扫描照片`, and `已配对设备`;
- primary action: `生成新二维码`;
- setting: `开机时自动启动 NikkiSync` toggle;
- first-run QR card or manual-QR modal;
- an actionable service-start failure view that keeps the diagnostic path local.

The native tray menu contains `显示 NikkiSync` and `退出 NikkiSync`.

## Native Bridge and Startup Preference

Only the locally hosted WebView2 page is permitted to use the host bridge. The page may request `getAutostart` and `setAutostart`; the WPF host maps these to a narrow autostart abstraction backed by the current-user `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run` entry. The value starts `NikkiSync-PC.exe` from its installed release folder. It never writes a machine-wide setting and never sends this preference over the LAN.

## Failure Behavior

- Missing WebView2 runtime: show a native explanatory dialog and retain the service-error log path; do not open a browser as a fallback.
- Service start or health-check failure: show an in-window error and leave no orphan service process.
- Normal window close: hide to tray and continue service.
- Explicit tray Exit: stop the service, dispose WebView2, then exit the host.
- The service can still run its existing scanner/LAN sync when the UI is hidden.

## Tests and Verification

- Unit-test the control-page view model for first-run vs paired-device state, status formatting, and QR renewal.
- Unit-test the autostart abstraction with an in-memory implementation; integration-test the Windows registry implementation only when running on Windows.
- Test service-process argument construction and health-check failure cleanup through injectable process/clock abstractions.
- Keep existing Node tests green; add a Windows-shell build check and package the host plus service together.
- Manual acceptance: launch the release executable; verify first-run QR, pair one phone, restart to verify QR remains hidden, renew a QR manually, toggle autostart, close to tray, then exit from tray.

## Non-goals and Safety Boundaries

- No Electron dependency and no default browser launch.
- No administrator requirement, system-wide startup entry, telemetry, or remote UI endpoint.
- No change to NUAN5 authorization or any photo/dictionary request policy.
- No unverified clothing-ID mapping or thumbnail download work.
