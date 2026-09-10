# M2.3 Mobile Navigation and Gallery UX Design

**Status:** approved direction, implementation begins with M2.3.1.

## Product structure

NikkiSync mobile uses a persistent three-tab bottom navigation:

1. **图库** — the complete PC-synced Infinity Nikki photo library. This is the default tab and the existing gallery evolves into this surface.
2. **已保存** — photos already saved/exported from NikkiSync to the phone. The long-term design must display the saved image itself rather than only a remote thumbnail or history row.
3. **我的** — user-centric summary including player UID and library/photo status. Future search can locate photos by individual clothing piece or outfit/set.

The three tabs are top-level destinations. Returning from a viewer/info surface returns to the originating tab rather than resetting to 图库.

## Future capability reservations

### 已保存: edited-output relinking

A user may edit an exported image after NikkiSync saved it. The Saved model must therefore leave room for a future explicit relink flow that associates a user-edited derivative back to the originating NikkiSync asset while keeping provenance clear.

Future association must distinguish at least:

- source NikkiSync `assetId`;
- original exported output;
- user-edited derivative selected from the system gallery;
- relationship/provenance metadata rather than pretending the derivative is byte-identical to the source.

M2.3.1 does **not** implement this relinking flow.

### 我的: UID summary and outfit/part search

The My tab will eventually show:

- current player UID when available;
- total photo/library summary;
- metadata coverage/sync summary where useful;
- search entry points for clothing pieces and full outfits/sets.

Search must use already-decoded/enriched NikkiSync metadata; it must not require uploading photo bytes or native payloads. M2.3.1 does **not** implement clothing/outfit search.

## M2.3.1 scope

M2.3.1 establishes the navigation shell and upgrades the 图库 home.

### Bottom navigation

- Persistent labels: `图库`, `已保存`, `我的`.
- `图库` is active by default.
- `已保存` and `我的` are real selectable destinations but initially show clear product-state placeholders rather than fake data.
- Existing pairing, loading, selection and save behavior must remain available from 图库.

### Version-first gallery

The 图库 tab is grouped by Infinity Nikki game version.

- Explicit `metadata.identity.gameVersion` is authoritative.
- Asset summaries expose resolved game-version information so Android does not fetch full metadata for every thumbnail.
- Version source is represented as `explicit`, `inferred`, or `unknown`.
- M2.3.1 must at minimum fully support explicit version grouping and unknown fallback.
- The inference interface is introduced in PC code so cached calendar inference can be extended without changing the Android grouping contract.
- Groups sort by semantic numeric version descending; `2.10` sorts newer than `2.9`.
- Photos within a group sort by capture time descending, then stable asset ID fallback.
- Unknown photos go to `版本未知` and are never force-classified.
- Group headers show version and count; inferred groups may show `自动推测`.

### Interaction boundaries

- Existing thumbnail tap opens the current viewer.
- Existing long-press selection continues to work.
- Existing rotation, metadata, clothing thumbnail, Live Photo and save implementations remain untouched except where adapter integration is necessary.
- No Compose migration in M2.3.1.
- No visual glass/blur polish in M2.3.1; this remains a later UX phase.

## Data contract

Protocol `AssetSummary` gains optional fields:

- `gameVersion?: string`
- `gameVersionSource?: 'explicit' | 'inferred' | 'unknown'`

PC mapping reads explicit version from public-safe canonical metadata. A focused version resolver component owns future inference policy rather than embedding date logic in the Android UI.

Android `AssetSummary` mirrors these fields. Gallery grouping is implemented as a presentation model that can later feed a richer RecyclerView/sectioned UI without changing protocol data.

## M2.3.1 acceptance

- App launches into 图库 with a visible three-item bottom navigation.
- 已保存 and 我的 can be selected and clearly state that their richer functions are reserved for later milestones.
- 图库 displays photos grouped by explicit game version when metadata provides it.
- Photos without a valid version appear under 版本未知.
- Version sort treats semantic numeric versions correctly.
- Existing photo opening, selection and saving are not intentionally removed.
- Protocol/mobile validation tests fail if game-version fields or three-tab navigation are accidentally removed.

## Deferred after M2.3.1

- Cached public version-calendar fetching and production date inference if real samples still lack explicit version coverage.
- Full Saved library backed by system-gallery/export records.
- User-edited derivative relinking.
- My page UID/dashboard implementation.
- Clothing-piece and outfit/set search.
- Full-screen viewer redesign, bottom info sheet, predictive back, Monet background and liquid-glass polish.
