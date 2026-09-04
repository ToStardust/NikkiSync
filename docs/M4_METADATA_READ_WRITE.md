# M4 Infinity Nikki Metadata Read / Write

Last updated: 2026-09-02

## Goal

M4 provides a completely local metadata path for Infinity Nikki photography assets. Source media under the game directory remains immutable. NikkiSync may read game-native identifiers from those files and stores normalized/editable metadata in its own SQLite database.

## M4.1 automatic resolver pipeline

The PC runtime now contains a provider-neutral automatic parameter-resolution pipeline:

```text
HighQuality JPEG
  -> UID + nativeParamPayload + nativeParamToken extraction
  -> MetadataResolverService
  -> PhotoMetadataResolver
  -> InfinityPhotoMetadata merge
  -> SQLite revision + WebSocket/changes propagation
```

Current invariants:

- Source JPEG/MP4 bytes are never sent by the resolver transport.
- Resolver input is the embedded parameter envelope, not the full image: UID + Base64 parameter payload + trailing token. The generic transport also supplies the payload MD5 for provider adapters that need a tuple/hash.
- Successfully resolved assets are cached in SQLite. Cache validity is keyed by the full native input fingerprint and optional provider version, so a changed photo payload or a provider/dictionary version bump triggers re-enrichment without an APK update.
- Failed requests record provider/error/attempt time and use retry backoff instead of retrying every scan.
- Scanner reconciliation preserves resolver output and user edits while refreshing scanner-owned native fields.
- The resolver implementation is injectable. A verified NUAN5-compatible provider, a future NikkiSync service, and a future local decoder can all implement the same interface.
- Current payload classification is explicit: Base64 payloads >= 1024 chars are `base64-large-v1`; small Base64 payloads are `base64-small-legacy` and are not assumed to share the current request format.
- The generic remote transport only prefers the full payload for `base64-large-v1`; legacy/outlier inputs fall back to the stable 32-byte token until verified.

Implementation files:

- `apps/pc-companion/src/metadata/types.ts`
- `apps/pc-companion/src/metadata/MetadataResolverService.ts`
- `apps/pc-companion/src/metadata/RemoteJsonMetadataResolver.ts`
- `apps/pc-companion/src/metadata/MetadataResolverConfigFile.ts`

For development, the generic remote provider can be enabled with `NIKKISYNC_METADATA_RESOLVER_URL`; it is intentionally **not enabled by default** until a real provider endpoint and response contract are verified.

The provider can also be configured outside the binary through:

```text
%LOCALAPPDATA%\NikkiSync\metadata-resolver.json
```

Example shape (the URL below is deliberately non-production):

```json
{
  "enabled": true,
  "provider": {
    "type": "remote-json",
    "id": "compatible-provider",
    "version": "2026.09",
    "endpoint": "https://example.invalid/v1/resolve"
  }
}
```

Keeping endpoint/provider version outside the executable allows a future resolver migration without changing the Android APK or rebuilding the PC executable. The file is read at PC Companion startup; a restart is sufficient to apply a changed provider configuration.

Public SpinningMomo source confirms a very similar separation: its Infinity Nikki extension contains separate scan/infra/extraction modules, structured NUAN5 response types, batching and send throttling. Its privacy statement says the optional online metadata feature may send UID and embedded photo parameters but does not upload the full image. This is being used as an architecture reference, not as proof of a reusable public API.

## Confirmed native-file structure

Real `NikkiPhotos_HighQuality` JPEG samples were re-inspected using both trailing JPEG EOI markers. The earlier interpretation that only the final 44 characters mattered was incomplete.

For current real samples:

- parseable HighQuality photos contain a **large printable Base64 payload between two trailing `FFD9` markers**;
- the second/final EOI is followed by exactly **44 printable ASCII bytes**;
- those 44 bytes are valid Base64 and decode to exactly **32 bytes**;
- standard JPEG APP metadata contains only normal JFIF data in inspected HighQuality samples; no EXIF/XMP/UserComment block carries the full Infinity Nikki photo parameters;
- a reverse search of a real token across the complete local `Saved` tree found it only in its source JPEG, not in another local cache/database file.

The large Base64 block is therefore the strongest candidate for the actual embedded photo-parameter payload; the 32-byte value is a separate opaque token/signature/key. On a verified real sample the payload contained 47,576 Base64 characters (35,680 decoded bytes). Its trailing token was neither `SHA-256(payload ASCII)` nor `SHA-256(decoded payload)`.

The scanner extracts it losslessly into:

```text
InfinityPhotoMetadata.raw.nativeParamToken
InfinityPhotoMetadata.raw.nativeParamPayload
```

`nativeParamPayload` is PC-only resolver input and is stripped from the LAN API before metadata is sent to Android. Do not pretend that either opaque field has been locally decoded until a verified decoder exists.

## Real-library verification

The current real local database scan reported:

```text
active assets:             175
assets with metadata:      175
assets with native token:  127
assets with native payload:127
```

An independent filesystem pass over 172 HighQuality files found 127 with a valid token, and **all 127 also had a payload**. Payload length ranged from 24 to 93,888 characters, with a median of about 48 KB. Most current samples cluster around 47–52 KB and some reach roughly 66–94 KB. The short 24/64-character envelopes must **not** be discarded based on size alone. This proves the two-part envelope extraction path works on the real Infinity Nikki library, not only synthetic fixtures.

Further binary-shape inspection corrected the earlier tentative `small = legacy/outlier` assumption:

- every inspected large Base64 payload decodes to a byte length exactly divisible by 16;
- the short 24/64-character forms likewise decode to complete 16/48-byte blocks;
- many large samples share identical 16-byte blocks at the same offsets across different photos;
- this strongly indicates a block-structured/encrypted envelope, but is **not sufficient evidence to name a cipher, mode, key derivation, or plaintext format**.

The resolver therefore treats any scanner-verified Base64 envelope losslessly as `base64-envelope`. Payload length is diagnostic only. Provider adapters receive the exact envelope, its ASCII MD5, decoded byte length, and the separate trailing token.

## Canonical editable metadata

`InfinityPhotoMetadata` remains the application-facing schema. M4.0 currently exposes the first editable camera fields on Android:

- focal length
- exposure
- brightness
- contrast
- saturation
- vibrance
- highlights
- shadows

The schema already reserves further sections for filter, lighting, photography, Nikki, dressing, interactions, and location.

## Read path

1. PC Scanner observes a HighQuality JPEG / motion cover.
2. `ResourceClassifier` checks the final 46 bytes (`FFD9` + 44-char token), then locates the preceding EOI and extracts the printable payload between them.
3. The two opaque fields are persisted under `raw.nativeParamPayload` and `raw.nativeParamToken`.
4. The resolver receives UID + payload + token + payload MD5. `AssetDetail` returns canonical decoded metadata and resolver status, but strips the large raw payload from the LAN response.
5. Android detail UI clearly distinguishes:
   - `暖暖原生参数：已读取（待本地解码）`
   - editable NikkiSync canonical fields.

## Write path

Android updates canonical metadata using:

```text
PATCH /v1/assets/:assetId/metadata
```

The PATCH body is covered by the existing Ed25519 request signature, including its real SHA-256 body hash.

Writable top-level sections are currently:

```text
capture
camera
filter
lighting
photography
nikki
dressing
interactions
location
```

`identity` and `raw` are scanner-owned/read-only through this API so a mobile client cannot overwrite UID/source identity/native token.

Every metadata edit allocates a normal asset revision and participates in the existing changes/WebSocket synchronization path.

## Scanner merge rule

Scanner reconciliation **merges** scanner-owned metadata into existing canonical metadata. It must not replace the full metadata object.

This means:

- rescanning can refresh `raw.nativeParamPayload` and `raw.nativeParamToken`;
- user-edited `camera.*` values survive rescans;
- future native decoding can populate normalized fields without redesigning mobile/template consumers.

Regression tests explicitly cover this behavior.

## Source immutability

M4.0 never edits Infinity Nikki source JPEGs. Database edits are NikkiSync metadata only.

When portable metadata-in-file export is added later, it must create a **derived copy** (for example a NikkiSync XMP-bearing JPEG) rather than modifying the game source or the user's requested original-byte export.

## Native decoding status

Full game-native parameter decoding is **not solved yet**, but the correct embedded input boundary is now substantially clearer.

Public SpinningMomo code exposes functions named `is_base64_text`, `find_roi`, `compute_md5_hex`, and `build_photo_tuple` before sending batches to the NUAN5-backed parser. This matches the newly confirmed large Base64 envelope far better than the old token-only model. Its privacy statement says the online feature sends UID and embedded photo parameters rather than the full image.

Current reverse-engineering priorities:

1. reproduce the public `find_roi` / `build_photo_tuple` transformation over `nativeParamPayload` and determine the exact request schema;
2. determine the separate role of the 32-byte token (key/signature/association data);
3. verify one real photograph end-to-end against a compatible resolver before enabling any provider by default;
4. map verified decoded values into `InfinityPhotoMetadata` so the Android UI and future template layer remain unchanged.

## M4.2 metadata dictionary layer

M4.2 adds a provider-neutral, versioned PC-side dictionary layer for turning resolver IDs into stable user-facing metadata without hard-coding game data into the Android APK.

Current implementation:

- Canonical dictionary kinds: `clothing`, `filter`, `lighting`, `pose`, `location`.
- `%LOCALAPPDATA%\\NikkiSync\\metadata-dictionary.json` is an optional local manifest loaded by the PC Companion. Missing/invalid files leave dictionary enrichment disabled and do not block startup.
- The active dictionary snapshot is persisted in SQLite and replaced transactionally.
- Existing resolved photos can be re-enriched locally when the dictionary provider/version changes; this does **not** invoke NUAN5 or upload source media.
- New resolver results are enriched with the active local dictionary before the metadata merge is committed.
- Unknown IDs remain present losslessly. Existing canonical/user-authored names override dictionary names.
- Clothing IDs may gain `name`, `category`, `rarity`, and a `thumbnail` reference. M4.2 does not fetch/store thumbnail image bytes and does not make Android depend directly on third-party image hosts.
- Dictionary provenance is stored under `raw.dictionary` rather than copying the complete dictionary into every photo.

### M4.2.1 remote dictionary update

Remote dictionary fetching is deliberately separate from the photo resolver and is disabled unless the PC user creates `%LOCALAPPDATA%\NikkiSync\metadata-dictionary-remote.json` with `enabled: true` and an HTTPS endpoint:

```json
{
  "enabled": true,
  "provider": {
    "type": "remote-json",
    "id": "your-dictionary-provider",
    "endpoint": "https://example.invalid/nikkisync/dictionary.json",
    "locale": "zh-CN",
    "intervalMs": 21600000,
    "timeoutMs": 12000
  }
}
```

The PC performs a bodyless GET at startup and at the configured interval (six hours by default). It sends only normal dictionary cache/locale headers: `Accept`, optional `Accept-Language`, `If-None-Match`, and `If-Modified-Since`. It never includes photo UID, photo metadata, resolver tuple, token, payload, MD5, or media bytes. A `304` makes no asset write; invalid responses and network failures preserve the prior SQLite snapshot.

On a dictionary version change, values are replaced only when the currently stored value still equals the prior dictionary's value. This updates dictionary-owned names/categories/rarity/thumbnail references while preserving values edited by the user. No third-party dictionary endpoint is configured by this repository.

Manifest schema v1 example:

```json
{
  "schemaVersion": 1,
  "provider": "example-provider",
  "providerVersion": "2026.09.03",
  "gameVersion": "optional",
  "entries": [
    { "kind": "filter", "id": "7", "name": "Example Filter" },
    { "kind": "clothing", "id": "101", "name": "Example Clothing", "category": "hair", "rarity": 5 }
  ]
}
```

M4.2 deliberately separates dictionary updates from photo resolver authorization. A dictionary update can re-label already-resolved IDs locally; it must not be treated as permission to enable or batch-run a remote photo resolver.

### M4.2.2 clothing entity-ID alignment

On 2026-09-03 the user explicitly authorized one repeat request for the same single real asset previously used for the M4.1 E2E. The request returned HTTP 200 and 14 `clothes[]` values:

```text
1020100111
1020600111
1020710111
1020730111
1020740111
1020750111
1020810145
1020820183
1020830126
1020840126
1020850162
1020900111
1020970111
1023860042
```

These values use the same 10-digit game entity-ID space independently observed in locally extracted/publicly exposed Infinity Nikki asset records (for example `1020100082`, `1020600082`, `1020980082`, `1020100396`, `1020740396`, `1020900396`). Known slot segments such as hair `10`, shoes `60`, neckwear `74`, bracelet `75`, and dress `90` recur in the live resolver response.

M4.2 therefore does not need a NUAN5-specific clothing-ID translation layer. The preferred next provider is a local-client dictionary extractor keyed directly by these game entity IDs. Exact meanings for currently unaligned segments (`71`, `73`, `81`–`85`, `97`, `386`) must remain unknown until supported by game-data table/string/localization evidence. See `docs/M4_2_2_CLOTHING_ID_ALIGNMENT_EVIDENCE.md`.

This extra single-photo request does not authorize batch resolution, background resolution, default provider enablement, or additional real-photo requests.
