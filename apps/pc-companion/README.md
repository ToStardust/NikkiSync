# PC Companion

M1.1 Windows source-of-truth process. Scanner + local LAN transport now share one SQLite library; mobile UI and platform Live Photo/Motion Photo export remain deferred.

`discoverInfinityNikkiInstallation()` automatically resolves the installation from an internal cached path, the portable app/workspace ancestor, or a running `InfinityNikki.exe`. It prioritizes hidden `X6Game/Saved/GamePlayPhotos` originals and their UID-scoped `Videos` directories, then falls back to `X6Game/ScreenShot` + `X6Game/Video` exports when the original library does not exist. These paths are not user-facing required settings.

## M1.0 scanner

`ScannerService` runs the frozen pipeline: `GamePlayPhotos -> stability guard -> resource classifier -> AssetResolver v1 -> SQLite -> revision journal`.

`start()` completes a full scan before starting the internal `fs.watch` watcher. Repeated scans are idempotent. HQ/LQ resources are grouped by UID and normalized stem; a motion asset requires a same-UID `_cover` + MP4 bundle. `.bin`, `PendingUp`, unknown images and unsupported files are ignored. Deterministic SHA-256-derived IDs prevent asset churn; missing source files are soft-deleted and resources marked missing.

## M1.1 local sync server

`LocalSyncServer` exposes Protocol v1 over the LAN:

- `GET /v1/server`
- `POST /v1/pair`
- signed `GET /v1/assets` and asset detail
- signed `GET/HEAD /v1/assets/{assetId}/resources/{resourceId}` with HTTP Range, ETag and source SHA-256
- signed `GET /v1/changes?after=N`
- signed `WS /ws/v1` for `server.hello` and journal-backed asset events
- `_nikkisync._tcp.local` mDNS announcements and query responses

Pairing sessions are one-time and persistent device identities use Ed25519 request signatures. `PcCompanionRuntime` automatically creates and persists a local self-signed TLS identity on first run, and the QR pins its SHA-256 certificate fingerprint. `LocalSyncServer` can still run plain HTTP when instantiated directly for isolated development tests.

`PcCompanionRuntime` starts the full scan before opening the LAN server, then leaves the watcher and local transport running against the same database.
