# M4.3 Windows Desktop Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package NikkiSync as a normal WPF/WebView2 Windows app that manages the local sync service, shows first-run pairing, reports live status, supports manual QR renewal, and offers current-user autostart.

**Architecture:** Keep the Bun executable as a sibling service process that owns scanning, SQLite, HTTPS/mDNS, and a loopback-only control page. Add a WPF `NikkiSync-PC.exe` host that starts/stops the service, displays that page in WebView2, exposes only an autostart bridge to it, and owns the tray lifecycle. The control page determines first-run pairing from its local paired-device count.

**Tech Stack:** Node.js 24 + Bun compiled Windows service; .NET 8 WPF; `Microsoft.Web.WebView2` NuGet package; `System.Windows.Forms.NotifyIcon`; Windows current-user Run registry key.

**Spec:** `docs/superpowers/specs/2026-09-03-m4-3-windows-desktop-shell-design.md`

## Global Constraints

- Require .NET SDK 8.x for Windows-shell compilation; this machine currently has .NET runtimes but no SDK.
- Use WebView2 Runtime already installed on the target machine; do not add Electron or launch a default browser.
- Bind control UI to `127.0.0.1` only; do not expose it through mDNS or the LAN API.
- Closing the window hides it to tray; only explicit tray Exit stops the service.
- Autostart writes only `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`; no administrator/system-wide registration.
- Preserve all M4.1/M4.2 network boundaries: no new NUAN5 behavior, no media upload, no remote UI endpoint.

---

## File Structure

- `apps/pc-companion/src/windows-app.ts`: service executable entry point; remove browser launching and expose the loopback control-page API/UI.
- `apps/pc-companion/src/desktop/DesktopStatusService.ts`: reads local database state into a narrow control-page status model.
- `apps/pc-companion/test/windows-app.test.ts`: exercises first-run/paired UI status and QR renewal response without a browser.
- `packages/database/src/pairing-repository.ts`: adds a narrow active paired-device count used by the desktop status service.
- `packages/database/test/database.test.ts`: verifies revoked devices are excluded from the paired-device count.
- `apps/windows-shell/NikkiSync.WindowsShell.csproj`: WPF project and WebView2 dependency.
- `apps/windows-shell/App.xaml`, `App.xaml.cs`: desktop application lifetime and unhandled-error entry point.
- `apps/windows-shell/MainWindow.xaml`, `MainWindow.xaml.cs`: visible WebView2 window, allowed-origin bridge, close-to-tray behavior.
- `apps/windows-shell/Services/ServiceProcessHost.cs`: starts/health-checks/stops sibling Bun service.
- `apps/windows-shell/Services/AutostartService.cs`: narrow current-user Run-key abstraction and registry implementation.
- `apps/windows-shell/Services/TrayService.cs`: NotifyIcon menu and show/exit commands.
- `apps/windows-shell.Tests/*.cs`: xUnit tests for service argument/cleanup, autostart abstraction, and window state view model.
- `apps/windows-shell/package.ps1`: publishes WPF host and stages it with service exe and migration.
- `release/NikkiSync/`: final `NikkiSync-PC.exe`, `NikkiSync-PC-service.exe`, and migrations.

## Task 1: Add loopback desktop status API and first-run control page

**Files:**
- Create: `apps/pc-companion/src/desktop/DesktopStatusService.ts`
- Modify: `apps/pc-companion/src/windows-app.ts`
- Create: `apps/pc-companion/test/windows-app.test.ts`
- Modify: `packages/database/src/pairing-repository.ts`
- Modify: `packages/database/test/database.test.ts`

**Interfaces:**
- Produces `PairingRepository.countActiveDevices(): number` and `DesktopStatusService.getStatus(): { service: 'ready'; host: string; port: number; assets: number; pairedDevices: number; firstRun: boolean }`.
- Produces loopback endpoints `GET /api/status`, `POST /api/pairing`, and a WebView2-only `GET /` page.

- [ ] **Step 1: Write the failing paired-device count and first-run status tests**

```ts
test('paired-device count excludes revoked devices', () => {
  pairing.pairDevice({ deviceId: 'active', deviceName: 'A', platform: 'android', publicKey: 'key-a', credentialHash: 'hash-a' })
  pairing.pairDevice({ deviceId: 'revoked', deviceName: 'B', platform: 'android', publicKey: 'key-b', credentialHash: 'hash-b' })
  pairing.revoke('revoked')
  assert.equal(pairing.countActiveDevices(), 1)
})

test('desktop status marks an empty device list as first run', () => {
  const status = new DesktopStatusService(database).getStatus({ host: '192.168.1.8', port: 28080, assets: 12 })
  assert.deepEqual(status, { service: 'ready', host: '192.168.1.8', port: 28080, assets: 12, pairedDevices: 0, firstRun: true })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:pc; node --test --test-isolation=none apps/pc-companion/dist/test/windows-app.test.js`

Expected: FAIL because `PairingRepository.countActiveDevices` and `DesktopStatusService` do not exist.

- [ ] **Step 3: Implement the smallest database-backed status service**

```ts
export class DesktopStatusService {
  constructor(private readonly database: DatabaseManager) {}
  getStatus(input: { host: string; port: number; assets: number }) {
    const pairedDevices = new PairingRepository(this.database).countActiveDevices()
    return { service: 'ready' as const, ...input, pairedDevices, firstRun: pairedDevices === 0 }
  }
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm run build:pc; node --test --test-isolation=none apps/pc-companion/dist/test/windows-app.test.js`

Expected: PASS with both focused tests.

- [ ] **Step 5: Add the browser-free control page behavior**

Remove `openBrowser`. Bind the dashboard HTTP server to `127.0.0.1`, return the full status object, and render QR only when `firstRun` is true; `POST /api/pairing` must always issue a fresh QR modal response.

- [ ] **Step 6: Add and run HTTP behavior tests**

Add a localhost test proving zero paired devices render the QR card and an existing paired device renders only `生成新二维码`; then run:

Run: `npm run build && node --test --test-isolation=none apps/pc-companion/dist/test/windows-app.test.js apps/pc-companion/dist/test/local-sync-server.test.js`

Expected: PASS.

## Task 2: Scaffold and test the WPF service/registry boundary

**Files:**
- Create: `apps/windows-shell/NikkiSync.WindowsShell.csproj`
- Create: `apps/windows-shell/Services/ServiceProcessHost.cs`
- Create: `apps/windows-shell/Services/AutostartService.cs`
- Create: `apps/windows-shell.Tests/NikkiSync.WindowsShell.Tests.csproj`
- Create: `apps/windows-shell.Tests/ServiceProcessHostTests.cs`
- Create: `apps/windows-shell.Tests/AutostartServiceTests.cs`

**Interfaces:**
- Produces `IServiceProcessHost.StartAsync(string releaseDirectory, CancellationToken): Task<Uri>` and `StopAsync(): Task`.
- Produces `IAutostartService.IsEnabled()` and `SetEnabled(bool enabled, string executablePath)`.

- [ ] **Step 1: Install build prerequisites with user approval**

Run: `winget install --id Microsoft.DotNet.SDK.8 --exact --source winget`

Expected: .NET SDK 8.x becomes available. Then run `dotnet --list-sdks` and record its exact installed version.

- [ ] **Step 2: Write failing service-host tests**

```csharp
[Fact]
public async Task StartAsync_stops_child_when_local_health_never_becomes_ready()
{
    var child = new FakeChildProcess();
    var host = new ServiceProcessHost(new FakeProcessFactory(child), new FailingHealthClient());
    await Assert.ThrowsAsync<ServiceStartException>(() => host.StartAsync(@"C:\Release", CancellationToken.None));
    Assert.True(child.KillCalled);
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `dotnet test apps/windows-shell.Tests/NikkiSync.WindowsShell.Tests.csproj`

Expected: FAIL because the project/classes do not exist.

- [ ] **Step 4: Create the WPF/xUnit projects and minimal abstractions**

Use `net8.0-windows`, `<UseWPF>true</UseWPF>`, and a fixed `Microsoft.Web.WebView2` package version resolved during restore. Define injectable process factory, child process, health client, and registry key abstractions so tests do not touch real processes or registry.

- [ ] **Step 5: Implement service health cleanup and autostart behavior**

`ServiceProcessHost` starts `NikkiSync-PC-service.exe --desktop-port 0`, polls only a returned loopback URL, and kills the child on startup failure. `AutostartService` writes/removes one quoted executable path under the current-user Run key. It rejects empty paths and never opens `HKLM`.

- [ ] **Step 6: Run focused tests**

Run: `dotnet test apps/windows-shell.Tests/NikkiSync.WindowsShell.Tests.csproj`

Expected: PASS including failed-health cleanup, healthy URL return, disabled autostart removal, and enabled autostart value assertions.

## Task 3: Add WebView2 window, bridge, and tray lifecycle

**Files:**
- Create: `apps/windows-shell/App.xaml`
- Create: `apps/windows-shell/App.xaml.cs`
- Create: `apps/windows-shell/MainWindow.xaml`
- Create: `apps/windows-shell/MainWindow.xaml.cs`
- Create: `apps/windows-shell/Services/TrayService.cs`
- Create: `apps/windows-shell.Tests/MainWindowViewModelTests.cs`

**Interfaces:**
- Consumes `IServiceProcessHost` and `IAutostartService` from Task 2.
- Produces host bridge messages `{ type: 'getAutostart' }` and `{ type: 'setAutostart', enabled: boolean }` only for the exact loopback control origin.

- [ ] **Step 1: Write failing lifecycle/view-model tests**

```csharp
[Fact]
public void CloseWindow_hides_to_tray_without_stopping_service()
{
    var model = new MainWindowViewModel();
    model.OnWindowClosing(userRequestedExit: false);
    Assert.True(model.HideWindow);
    Assert.False(model.StopService);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test apps/windows-shell.Tests/NikkiSync.WindowsShell.Tests.csproj --filter MainWindowViewModelTests`

Expected: FAIL because the view model does not exist.

- [ ] **Step 3: Implement WPF host window and WebView2 bridge**

Initialize WebView2 after `ServiceProcessHost.StartAsync`; navigate only to its `http://127.0.0.1:<port>/`. Reject every `WebMessageReceived` sender whose `Source` origin does not equal the service origin. Route only the two autostart messages and post JSON replies.

- [ ] **Step 4: Implement native tray behavior**

Create a `NotifyIcon` menu with exactly `显示 NikkiSync` and `退出 NikkiSync`. Window close sets `e.Cancel = true` and hides. Explicit exit stops the service, disposes the tray icon/WebView2, then calls application shutdown.

- [ ] **Step 5: Run WPF tests and build**

Run: `dotnet test apps/windows-shell.Tests/NikkiSync.WindowsShell.Tests.csproj; dotnet build apps/windows-shell/NikkiSync.WindowsShell.csproj -c Release`

Expected: both commands exit 0.

## Task 4: Package, document, and run release verification

**Files:**
- Create: `apps/windows-shell/package.ps1`
- Modify: `apps/pc-companion/package.json`
- Modify: root `package.json`
- Modify: `docs/GPT_HANDOFF_2026-09-02.md`
- Modify: `docs/M4_METADATA_READ_WRITE.md` only if new desktop endpoint documentation needs a boundary note.

**Interfaces:**
- Produces release files `release/NikkiSync/NikkiSync-PC.exe`, `release/NikkiSync/NikkiSync-PC-service.exe`, and `release/NikkiSync/migrations/0001_initial.sql`.

- [ ] **Step 1: Write the failing package-layout verification**

Add a PowerShell check that returns nonzero unless all three required release paths exist and the host/service filenames differ.

- [ ] **Step 2: Run it to verify it fails before packaging**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps/windows-shell/package.ps1 -VerifyOnly`

Expected: FAIL because the WPF host/service split is not staged yet.

- [ ] **Step 3: Implement staging**

Compile the Bun service to `NikkiSync-PC-service.exe`, publish the WPF host as self-contained or framework-dependent according to the installed SDK/runtime decision, copy migration files, then run the verification mode.

- [ ] **Step 4: Run automated verification**

Run: `npm test; dotnet test apps/windows-shell.Tests/NikkiSync.WindowsShell.Tests.csproj; npm run pc:exe; powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps/windows-shell/package.ps1 -VerifyOnly`

Expected: every command exits 0.

- [ ] **Step 5: Perform manual Windows acceptance**

Launch `release/NikkiSync/NikkiSync-PC.exe`. Verify first-run QR, pair one phone, restart and verify no automatic QR, click `生成新二维码`, toggle autostart, close to tray, select Exit, and confirm the service process exits.

- [ ] **Step 6: Update handoff evidence**

Record exact build/test command results, package paths, the explicit non-goals, and any manual acceptance result in `docs/GPT_HANDOFF_2026-09-02.md`.
