# M4.2.8 — Clothing detail UI and thumbnail proxy/cache

## Goal

Expose the canonical clothing metadata produced by M4.2.7 in the Android photo-detail screen while keeping third-party image hosts behind the paired PC boundary.

The Android client should display useful clothing information even when an icon cannot be fetched. Photo viewing, metadata viewing/editing and original-media export must not depend on the third-party thumbnail service being online.

## Data path

```text
remote/public dictionary
        ↓
MetadataDictionaryService
        ↓
InfinityPhotoMetadata.dressing.clothes[]
        ↓
AssetDetail over existing signed LAN API
        ↓
Android photo detail
```

A canonical clothing object can contain:

```json
{
  "id": "1020810145",
  "name": "<localized clothing name>",
  "category": "baseMakeup",
  "thumbnail": "https://<upstream-cdn>/..."
}
```

The existing metadata object remains the source of truth. M4.2.8 does not create a second clothing database on Android.

## Android UI

`MainActivity.showViewer()` is now scrollable so a complete outfit cannot push the existing editor/save controls off-screen.

When `dressing.clothes` contains canonical entities, the detail page renders:

- `穿搭 · N 件` heading;
- one row per clothing ID;
- localized clothing name when available, with `服装 <id>` fallback;
- Chinese slot/category label;
- the original 10-digit clothing ID;
- an optional icon loaded through the paired PC.

Unknown category keys are displayed rather than silently guessed. Known canonical keys map to Chinese labels such as `baseMakeup → 底妆`, `contacts → 美瞳`, `hair → 发型`, `dresses → 连衣裙`, etc.

If the icon path fails, the metadata text remains usable. The detail page itself does not fail.

## PC thumbnail route

Additive Protocol v1 route:

```text
GET|HEAD /v1/assets/:assetId/clothing/:clothingId/thumbnail
```

This route is behind the same Ed25519 signed-request authentication as the other post-pair LAN routes.

Crucially, the client does **not** submit a URL to proxy. The server:

1. loads the requested asset from SQLite;
2. parses that asset's canonical metadata;
3. finds the requested `clothingId` inside `dressing.clothes`;
4. accepts only that entity's already-recorded HTTPS `thumbnail` value;
5. fetches/caches it on the PC;
6. streams the cached bytes back to Android.

An arbitrary URL supplied by a mobile client is therefore not part of this API.

## PC cache

`MetadataThumbnailCache` stores metadata icons under the PC application data directory:

```text
%LOCALAPPDATA%\NikkiSync\metadata-thumbnails
```

Portable/fallback APP_DATA behavior follows the existing Windows app-data selection logic.

The cache key is SHA-256 over:

```text
<dictionary provider version>\n<normalized source URL>
```

This gives deterministic reuse while naturally invalidating when a dictionary refresh advertises a new version or source URL.

Each cached object has an `.img` payload and a small JSON record containing source URL, version key, MIME type, byte size and SHA-256.

## Network safety boundaries

The cache is deliberately bounded:

- HTTPS source URLs only;
- URL credentials rejected;
- `localhost`, `.localhost`, `.local`, private/local literal IPv4 targets and common local IPv6 ranges rejected;
- redirects are re-checked when the final URL is exposed by `fetch`;
- accepted MIME types: `image/png`, `image/jpeg`, `image/webp`;
- default maximum object size: 2 MiB, enforced both from `Content-Length` and while streaming;
- default timeout: 10 seconds;
- concurrent identical requests share one in-flight download;
- response to Android includes SHA-256 and an ETag.

This route is not intended as a general-purpose HTTP proxy. DNS-level rebinding protection is not claimed; the primary trust boundary remains the explicitly enabled dictionary provider plus the fact that mobile cannot supply a source URL.

## Mobile networking

Android calls only the paired PC route using the existing pinned-TLS and signed-request client:

```text
NikkiSyncClient.clothingThumbnail(assetId, clothingId)
```

`ImageLoader` reuses its existing memory/disk image cache for these responses. It does not embed a third-party image host and does not open the canonical `thumbnail` URL directly.

## Tests and source-contract checks

Added Node tests:

- `apps/pc-companion/test/metadata-thumbnail-cache.test.ts`
  - HTTPS image caching and cache reuse;
  - SHA-256/MIME/size metadata;
  - reject HTTP, local/private literal targets, non-image content and oversized objects.
- `apps/pc-companion/test/metadata-thumbnail-proxy.test.ts`
  - signed route required;
  - route resolves only an ID already present in the asset metadata;
  - successful proxy response preserves image bytes and hash;
  - second request is served from PC cache;
  - unknown clothing ID does not trigger an upstream request.
- `packages/protocol/test/protocol.test.ts`
  - additive route builder encodes asset/clothing identifiers.

`apps/mobile/scripts/validate-m2.mjs` now also requires:

- clothing detail rendering in `MainActivity`;
- scrollable photo detail;
- paired-PC `/clothing/` route usage;
- `ImageLoader.loadClothingThumbnail`;
- no embedded third-party clothing host in the Android image loader.

## Verification status in this GitHub-only session

Source and test changes were written on branch:

```text
feature/m4-2-8-clothing-detail
```

This ChatGPT session does not have the NikkiSync local `apply_patch`/command runner that the repository handoff requires. Therefore the following are **not claimed as passing yet**:

```powershell
npm run typecheck
npm test -- --runInBand
npm run mobile:validate
npm run mobile:build
```

A local/Work or Codex environment must run those commands before M4.2.8 is marked GREEN or merged to `main`.

## Acceptance checklist

Automated/local acceptance still required:

1. TypeScript build/typecheck exits 0.
2. New cache and proxy tests pass together with the full Node regression suite.
3. `mobile:validate` exits 0.
4. Android debug APK builds.
5. Real paired device opens a resolved photo and shows clothing name/category/ID.
6. At least one clothing icon loads through PC while Android has no direct connection to the upstream host.
7. With upstream icon access unavailable, the same detail page still shows clothing text and remains usable.
