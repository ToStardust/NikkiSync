# M4.2 Metadata Dictionary Design

## Goal

Add a provider-neutral, versioned metadata dictionary layer on the PC side so opaque Infinity Nikki IDs returned by the verified M4.1 resolver can be enriched into stable, user-facing names and optional artwork references without requiring an Android APK update.

## Scope

M4.2 covers dictionary infrastructure and canonical enrichment for these entity families:

- clothes
- filter
- lighting
- pose / interaction
- location

The first milestone does **not** enable NUAN5 batch resolving, does not change Live Photo behavior, and does not upload source media.

## Architecture

The PC Companion remains the source of truth. A new `MetadataDictionaryService` owns a versioned dictionary snapshot and enriches already-decoded `InfinityPhotoMetadata`. Android continues to receive canonical metadata over the existing LAN API; it never fetches game dictionaries directly.

Dictionary data is represented by a provider-neutral manifest. The manifest may come from a local file or a future remote provider. Provider identity, provider version, game/data version, retrieval time, and source URL are tracked separately from individual entries so a provider can be replaced without changing consumers.

The dictionary service never rewrites scanner-owned native payload/token fields. It only adds normalized display data next to existing IDs and preserves unknown IDs losslessly.

## Dictionary Manifest

The canonical manifest is JSON with this logical shape:

```json
{
  "schemaVersion": 1,
  "provider": "example-provider",
  "providerVersion": "2026.09.03",
  "gameVersion": "optional",
  "generatedAt": "2026-09-03T00:00:00.000Z",
  "entries": [
    {
      "kind": "clothing",
      "id": "12345",
      "name": "Example",
      "category": "hair",
      "rarity": 5,
      "thumbnail": "https://example.invalid/12345.webp",
      "raw": {}
    }
  ]
}
```

Required per-entry fields are `kind` and string `id`. Names, category, rarity, thumbnail and provider-specific `raw` data are optional. Unknown fields are ignored at the canonical boundary.

## Persistence

Use SQLite rather than hard-coded APK resources. Add dictionary snapshot metadata and dictionary entries to the existing database migration path. The PC can replace one provider snapshot transactionally while assets continue to reference stable IDs.

Persist:

- provider id
- provider version
- optional game version
- generated / fetched timestamps
- entity kind + id
- localized/display name
- category
- rarity
- thumbnail URL
- raw JSON

No image bytes are stored in the database in M4.2.

## Enrichment Rules

`MetadataDictionaryService.enrich(metadata)` is deterministic and local.

- `filter.id` maps to `filter.name` when a dictionary entry exists.
- `lighting.id` maps to `lighting.name` when a dictionary entry exists.
- `dressing.clothes` accepts existing primitive IDs or objects. Primitive IDs are converted to objects containing at least `id`; dictionary matches add `name`, `category`, `rarity`, and `thumbnail`.
- interaction / pose IDs are enriched into objects without losing unknown provider fields.
- location IDs gain `name` when matched; world coordinates remain untouched.
- Unknown IDs remain present with their original ID and are never dropped.
- Existing user-authored canonical names override dictionary names unless the existing value is absent.

The service records dictionary provenance under `metadata.raw.dictionary` with provider/version and the time enrichment occurred. Large dictionary payloads are never copied into per-photo metadata.

## Update Model

M4.2 separates **dictionary update** from **photo resolver requests**.

- Loading/replacing a dictionary must not contact NUAN5.
- Re-enrichment of already-resolved local photos is local-only.
- A provider version change can re-enrich cached photos without re-resolving their native photo envelope.
- Remote dictionary fetching, when configured later, is opt-in and PC-only.
- The Android APK only consumes canonical metadata and optional thumbnail URLs returned by the PC API.

## API Boundary

Keep protocol v1 asset routes stable. Enriched values are returned inside the existing `InfinityPhotoMetadata` structure.

Add a PC-local dictionary status surface only if required for diagnostics; do not make Android depend on provider-specific manifest schemas.

## Thumbnail Policy

M4.2 stores only a thumbnail reference. A future cache/proxy layer may fetch and cache thumbnails on the PC, but M4.2 must not introduce an Android-to-third-party dependency.

If a remote thumbnail URL is present in the dictionary, it remains provider metadata until a controlled PC proxy/cache is implemented. Android UI work may initially show names without loading third-party thumbnails.

## Failure Behavior

- Invalid manifests are rejected before replacing the active snapshot.
- A failed update leaves the previous valid dictionary intact.
- Unknown entity kinds are ignored rather than breaking photo metadata.
- Missing dictionary entries are treated as normal and preserved as IDs.
- Dictionary failures never block gallery synchronization or original-photo export.

## Testing

Tests must cover:

- manifest validation
- transactional snapshot replacement
- filter/light name mapping
- clothes ID enrichment with category/rarity/thumbnail
- unknown ID preservation
- existing canonical name preservation
- local re-enrichment without invoking a photo resolver
- LAN redaction remaining unchanged for native payload fields

The complete `npm test` suite must remain green. Android validation/build is required if shared types or LAN payload behavior changes.

## Non-Goals

- No default NUAN5 enablement.
- No NUAN5 batch resolver authorization.
- No source JPEG/MP4 upload.
- No hard-coded game dictionary inside Android.
- No assumption that one third-party provider will remain stable forever.
- No `[V2]` native photo protocol work.

