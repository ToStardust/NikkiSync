# M2.0 Mobile Gallery MVP

## Status

Implemented the first native Android client for the local-only NikkiSync pipeline.

```text
Infinity Nikki
  -> PC Scanner / AssetResolver
  -> SQLite revision journal
  -> pinned HTTPS + WebSocket + mDNS
  -> Android Gallery
  -> explicit original save to MediaStore
```

M2.0 targets Android 13+ (`minSdk 33`) for the first compatibility baseline. No cloud relay, cloud account, external media storage service, or third-party runtime networking/image/QR SDK is used.

## Pair once

PC Protocol v1 now has a canonical pairing URI helper:

```text
nikki-sync://pair?serverId=...&host=...&port=...&token=...&protocol=1&expiresAt=...&tls=...
```

`PcCompanionRuntime.createPairingUri()` exposes it to future tray UI. `apps/pc-companion/src/dev-server.ts` provides an immediate developer workflow: it starts Scanner + HTTPS server and prints a five-minute one-use pairing URI. Android accepts that URI as a deep link (so a system camera can open it from a future QR) and also allows manual paste for MVP testing.

The Android device creates an Ed25519 identity. The private PKCS#8 bytes are encrypted by an AES-GCM key generated in `AndroidKeyStore`; only the public SPKI key leaves the phone during pairing. The PC TLS certificate is trusted only when its SHA-256 leaf fingerprint matches the fingerprint delivered by the one-time pairing URI.

After pairing, every protected request signs Protocol v1 canonical data:

```text
METHOD
PATH_AND_QUERY
TIMESTAMP
NONCE
SHA256(BODY)
```

## Discovery and reconnect

`NsdDiscovery` listens for `_nikkisync._tcp.`. A discovery result is accepted for endpoint migration only when its TXT `serverId` equals the already paired server. Changing DHCP addresses therefore updates host/port without changing device trust. A spoofed mDNS result still cannot pass the pinned TLS fingerprint.

`RealtimeWebSocket` connects to `/ws/v1`. A WebSocket event is only a wake-up hint: the mobile client compares revision and requests `/v1/changes?after=<lastRevision>`. Full resync is used when the server reports journal history is too old.

## Gallery

- Three-column lazy Android `GridView`.
- AssetSummary is paged in batches of 100.
- PC `previewResourceId` now falls back in this order: `derived_preview -> source_low_quality -> source_primary -> source_high_quality`, allowing M2 to render the existing M1 library without waiting for a future thumbnail generator.
- In-memory bitmap LRU cache.
- `LIVE` badge for `motion_photo` assets.
- Tap opens a larger viewer; long-press begins multi-selection.

Persistent/disk thumbnail cache and a dedicated PC resize pipeline remain performance follow-ups; they are not required for correctness of the M2 sync loop.

## Original save

The user explicitly selects assets and chooses **保存原图**. For each selection Android requests Asset Detail and chooses:

1. `source_high_quality`, otherwise
2. `source_primary`.

It then streams the resource into `MediaStore.Images` under `Pictures/NikkiSync` with `IS_PENDING=1`, computes SHA-256 while writing, compares against `X-NikkiSync-SHA256`, and only clears `IS_PENDING` after the hashes match. A mismatch or interrupted transfer deletes the incomplete MediaStore row.

For a `motion_photo` M2 saves the original still resource. Native Android Motion Photo packaging is intentionally M3.0 work; the gallery already preserves and marks motion assets instead of flattening their PC data model.

## PC integration added for M2

- `buildPairingUri()` in Protocol v1 utilities (wire fields unchanged).
- `PcCompanionRuntime.createPairingUri()`.
- `dev-server.ts` for immediate pair/testing workflow.
- AssetSummary best-display resource fallback.
- Scanner startup optimization: an old/openable file is accepted immediately as stable; only recently modified files retain the three-check stability wait. Unsupported/companion files are no longer SHA-256 hashed by Scanner.

Real source-of-truth smoke test on 2026-09-02 successfully started against the current Infinity Nikki library and reported:

```text
scan: 174 created, 0 updated, 0 deleted
HTTPS server: started
pairing URI: generated
```

The smoke test used in-memory SQLite and did not modify the game tree.

## Validation

Executable in the current workspace:

```text
npm run typecheck       PASS
npm test                PASS (28/28)
npm run db:validate     PASS
npm run mobile:validate PASS
real PC runtime smoke   PASS
```

On 2026-09-02, the project was compiled using the existing local Android environment already used by the Neon Road project: JBR 17, Android SDK Platform 35, Build Tools 35.0.1 and Gradle 8.13. The resulting debug APK passed v2 signature verification and Android manifest verification.

```text
package: app.nikkisync.mobile
minSdk: 33
targetSdk: 35
APK SHA-256: 4459DD346066C6DC8B3BA162B071E331EFF65EEA77E0C6822D052979274E3040
```

`apps/mobile/scripts/build-android.ps1` is the project-local adapter for this reusable environment. Run `npm run mobile:build` to compile and validate the APK, or `npm run mobile:install` when an authorized USB-debugging device is connected.

On the same date, the APK was installed and exercised on an Android 15 Xiaomi device over USB debugging. To keep the test server off the LAN, the PC server was bound to `127.0.0.1:28080` with `NIKKISYNC_BIND=127.0.0.1`, then exposed only to that device via `adb reverse tcp:28080 tcp:28080`. A one-time deep-link pairing succeeded, the native gallery displayed all 174 scanned assets with a live WebSocket connection, and one selected 4,848,274-byte JPEG was streamed, SHA-256 checked, and saved into the device's `Pictures/NikkiSync` MediaStore collection.

## Remaining issues

### P0

- Android compile, APK verification, installation and the physical PC-to-phone gallery/save smoke test have passed.

### P1

- Repeat the smoke test over ordinary Wi-Fi/mDNS before public release; this USB test deliberately bypassed router discovery and firewall variance.
- PC should move long-lived server/TLS private material from plain SQLite values behind Windows DPAPI before public release.
- Current fallback can download a full HQ JPEG for assets with no LowQuality/derived preview; add the dedicated thumbnail pipeline before large-library polish.

### P2

- Tray UI should render the pairing URI as a QR rather than requiring copy/paste in the developer flow.
- Disk thumbnail cache and finer targeted change application can reduce reload work further.

## M2.0 completion boundary

The implemented source now covers the requested MVP behavior:

```text
discover paired PC
-> browse current PC assets
-> receive new revision wakeups
-> recover missed changes
-> mark LIVE assets
-> manually select photos
-> save byte-identical original still images to the phone
```

M3.0 begins with platform-native Motion Photo / Live Photo export from the already-preserved still + motion resources.
