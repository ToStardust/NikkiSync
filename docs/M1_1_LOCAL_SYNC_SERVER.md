# M1.1 Local Sync Server

## Status

Implemented and integration-tested on top of the M1.0 Scanner/SQLite source of truth.

## Architecture

```text
Infinity Nikki hidden originals
        ↓
ScannerService
        ↓
SQLite assets/resources + change_journal
        ↓
LocalSyncServer
 ├─ HTTPS REST
 ├─ Range resource streaming
 ├─ revision recovery
 ├─ WebSocket event acceleration
 ├─ one-time pairing + Ed25519 device auth
 └─ _nikkisync._tcp.local mDNS
```

`PcCompanionRuntime` owns the process lifecycle. It opens one SQLite database, completes the initial Scanner full scan, then starts the LAN server. The watcher and server continue sharing the same DB; server-side WebSocket events are produced by polling the authoritative `change_journal`, not by coupling the server directly to filesystem watcher events.

## Implemented routes

- `GET /v1/server` — unauthenticated discovery metadata and current library revision.
- `POST /v1/pair` — consumes a one-time pairing session.
- `GET /v1/assets` — signed, cursor-paginated remote library listing.
- `GET /v1/assets/{assetId}` — signed canonical Asset/Resource detail.
- `GET|HEAD /v1/assets/{assetId}/resources/{resourceId}` — signed source streaming with Range support.
- `GET /v1/changes?after=N` — signed reconnect recovery from revision journal.
- `WS /ws/v1` — signed WebSocket handshake; emits `server.hello` and journal-backed asset events.

## Resource transfer

Resources are streamed directly from the original read-only game file path; they are not loaded into memory as one large buffer and are never rewritten.

Responses include:

- `Accept-Ranges: bytes`
- `Content-Length`
- `Content-Range` for partial responses
- `ETag: "sha256:<hash>"`
- `X-NikkiSync-SHA256`
- source MIME type and UTF-8 filename

Invalid/unsatisfiable ranges return `416` with `Content-Range: bytes */<size>`.

## Pairing and authentication

1. PC creates a random, short-lived one-time pairing token and stores only its SHA-256 hash in `pairing_sessions`.
2. The mobile device owns an Ed25519 keypair and sends only its public key.
3. Successful pairing consumes the token and persists the device public key in `paired_devices`.
4. All protected requests sign the frozen Protocol v1 canonical string:

```text
METHOD
PATH_AND_CANONICAL_QUERY
TIMESTAMP
NONCE
SHA256_BODY_HEX
```

5. Server rejects stale timestamps, duplicate nonces, revoked/unknown devices and invalid Ed25519 signatures.

The PC also has a persistent Ed25519 server identity used in the pairing response.

## TLS identity

No cloud CA or external OpenSSL executable is required. `LocalTlsIdentityService` uses Node crypto only to generate a local RSA-2048 self-signed X.509 certificate and persists it in `app_settings`. `PcCompanionRuntime` enables HTTPS by default using this identity.

Pairing QR generation includes the certificate SHA-256 fingerprint. The future mobile client must pin that fingerprint during the first pairing and persist it alongside `serverId`; it must not trust the self-signed certificate globally.

Current hardening note: TLS private key material is stored locally in SQLite. Moving that private material behind Windows DPAPI/OS credential protection is a P1 hardening item before public release, but it does not change Protocol v1.

## mDNS

`MdnsAdvertiser` announces `_nikkisync._tcp.local` with PTR/SRV/TXT/A records, periodically refreshes the announcement, joins the standard IPv4 mDNS multicast group, and responds when `_nikkisync`/`_tcp` queries are observed.

TXT currently carries `serverId`, protocol version and port. IP address changes therefore do not alter logical server identity.

## Revision semantics

The server does not trust WebSocket delivery as durable state. It records the library revision at server startup, broadcasts new `change_journal` rows in order, and exposes `/v1/changes?after=N` for reconnect recovery.

If the requested revision predates retained journal history, the API returns `fullResyncRequired=true`; otherwise changes are returned in ascending revision order.

## Database additions

No migration/schema change was required for M1.1. Existing M0 tables already contained `paired_devices`, `pairing_sessions`, `device_sync_state`, `app_settings` and the journal.

Added repositories/helpers:

- `SyncReadRepository` — stable read model for assets/resources/changes and current/minimum revision.
- `AppSettingsRepository` — persistent local server/TLS identity.
- pairing session create/consume and device last-seen helpers.

## Acceptance tests

Automated LocalSyncServer integration test covers:

- unauthenticated `/v1/server`
- one-time pairing and replay rejection
- protected route rejection without a signature
- valid Ed25519 signed asset listing/detail
- byte-range source download and SHA-256 response header
- `/v1/changes?after=0`
- authenticated raw WebSocket upgrade and `server.hello`
- journal mutation after connection producing an `asset.created` WebSocket event
- stable generated TLS identity/fingerprint persistence

Repository validation after M1.1:

```text
TypeScript strict typecheck: PASS
Node tests:                27 / 27 PASS
SQLite foreign_key_check: ok
SQLite quick_check:       ok
```

M1.0 Scanner real-library acceptance remains the upstream source-of-truth baseline: 418 files observed, 288 accepted source resources, 174 assets, and a second unchanged full scan generated zero additional revisions.

## Open issues

### P0

None found in the M1.1 local transport foundation.

### P1

- Protect persisted TLS/server private key material with Windows DPAPI or equivalent OS-backed secret storage before public distribution.
- Mobile implementation must enforce certificate fingerprint pinning; accepting arbitrary self-signed certificates would defeat the pairing trust model.

### P2

- Add IPv6 mDNS/AUTO discovery support (`AAAA`) after the Android/iOS LAN client exists.
- Add journal retention/compaction policy once real mobile reconnect behavior and library scale are measured.
- Add production tray UI for pairing QR and connected-device status.

## Next milestone

M2.0 Mobile Gallery MVP should now consume the frozen Local Sync Server instead of reading game files directly:

```text
discover PC → pair once → fetch Asset summaries → cache preview metadata → live revision updates → user-selected original download
```

Motion Photo/Live Photo platform packaging and full Infinity metadata enrichment remain separate later milestones.
