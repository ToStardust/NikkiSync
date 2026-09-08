# M4.2.7 — Public clothing dictionary adapter

## Goal

Turn clothing entity IDs already decoded from Infinity Nikki photo metadata into useful display metadata without requiring NikkiSync APK/EXE updates for every game content patch.

This stage deliberately does **not** resume encrypted game-archive extraction. It adds an optional online dictionary source that can be refreshed independently of the binaries.

## Implemented source adapter

`NikkiAlbumsMetadataDictionaryProvider` supports the public hot-update feed used by the MIT-licensed `RanAxro/nikki_albums` project.

Upstream interoperability evidence:

- hot-update manifest: `https://nikki.ranaxro.com/app_api/hot_update.json`
- language overlay group: `infinity_nikki`, including locale `.bin` files
- structured metadata group: `nuan5_database`, currently `v1.db`
- upstream package reader uses AES-256-GCM with HKDF-SHA256 and the public package key embedded in its MIT source
- language `.bin` decrypts to MessagePack
- `v1.db` decrypts to protobuf `Nuan5Config`
- `Nuan5Config.cloth` maps clothing IDs to `cloth_type`
- `Nuan5Config.network_image.cloth` provides `base_url` + replacement token for clothing icons
- the upstream UI resolves a clothing display name at `infinity_nikki.cloth.<id>`

NikkiSync implements only the minimal package/MessagePack/protobuf subset needed for this adapter and introduces no new runtime dependency.

## Canonical mapping

For every `Nuan5Config.cloth[id]`, NikkiSync emits a metadata dictionary entry:

```json
{
  "kind": "clothing",
  "id": "1020810145",
  "name": "<localized name when present>",
  "category": "baseMakeup",
  "thumbnail": "https://.../1020810145...",
  "raw": {
    "clothType": 81,
    "source": "nikki-albums-public"
  }
}
```

The category uses stable canonical keys (`hair`, `dresses`, `outerwear`, `tops`, `bottoms`, `socks`, `shoes`, accessories, makeup slots, etc.). Unknown `cloth_type` values are preserved in `raw.clothType` and do not receive a guessed category.

### Rarity

The inspected upstream `Nuan5Cloth` / `Nuan5NikkiClothInfo` schema does not expose a trustworthy clothing rarity/star field. M4.2.7 therefore **does not infer rarity from IDs, slots, outfits, or visual appearance**. `rarity` remains absent until a separately evidenced provider supplies it.

This is intentional: the resolver pipeline can later merge a rarity-capable provider without replacing the higher-priority name/category/icon data.

## Privacy and network behavior

The adapter is a dictionary provider, not a photo resolver.

It performs only bodyless HTTP `GET` requests for:

1. the hot-update manifest;
2. the selected locale package;
3. the public metadata package.

It never sends:

- UID;
- photo ID / asset ID;
- native parameter token;
- native parameter payload;
- MD5/hash derived from a photo;
- JPEG/MP4/media bytes.

Remote dictionary updates retain the existing ETag / Last-Modified cache state through `MetadataDictionaryUpdateService`.

## Explicit opt-in

Nothing is enabled merely by compiling this code. To use this source, `%LOCALAPPDATA%\NikkiSync\metadata-dictionary-remote.json` must explicitly contain `enabled: true`.

Example:

```json
{
  "enabled": true,
  "provider": {
    "type": "nikki-albums-public",
    "locale": "zh-CN",
    "intervalMs": 21600000
  }
}
```

Optional fields:

```json
{
  "id": "nikki-albums-public",
  "manifestEndpoint": "https://nikki.ranaxro.com/app_api/hot_update.json",
  "locale": "zh-CN",
  "timeoutMs": 15000,
  "headers": {}
}
```

A configured custom `manifestEndpoint` must use HTTPS. Download URLs supplied by the manifest must also use HTTPS.

The existing `remote-json` dictionary config remains supported unchanged.

## Update semantics

The emitted canonical manifest version is:

```text
<language-versionId>:<database-versionId>
```

When either upstream package version changes, `MetadataDictionaryUpdateService` installs the new snapshot and re-enriches already-resolved assets using the existing user-override protection rules.

That means new clothing names/icons/categories can appear in NikkiSync without updating the Android APK or Windows EXE.

## Tests

`apps/pc-companion/test/nikki-albums-metadata-dictionary-provider.test.ts` uses local synthetic fixtures only:

- builds a minimal protobuf `Nuan5Config` containing a real-shaped 10-digit clothing ID;
- builds a MessagePack language overlay;
- encrypts both using the documented public hot-update package format;
- stubs `fetch` for HTTPS fixture URLs;
- verifies the final canonical `clothing` entry;
- verifies all requests are GET-only and contain no photo identifier/body;
- verifies explicit opt-in and HTTPS config validation.

No test contacts the real third-party endpoint.

## Third-party notice

The package format/schema interoperability was derived from `RanAxro/nikki_albums`, copyright (c) 2025 Ran, licensed under the MIT License. The upstream repository's MIT notice must be retained when substantial upstream code is copied. NikkiSync's implementation is intentionally small and independently expressed, but this provenance must remain documented.

The hot-update data and images may have their own provenance/usage terms independent of the MIT software license. NikkiSync therefore does not vendor or redistribute those data files in the repository; it only provides an explicit opt-in runtime adapter to URLs advertised by the upstream service.

## Next milestone

M4.2.8 should expose the enriched clothing objects and thumbnails cleanly in the Android photo-detail UI and add a PC-side thumbnail proxy/cache so Android does not need to trust or directly contact every third-party image host.
