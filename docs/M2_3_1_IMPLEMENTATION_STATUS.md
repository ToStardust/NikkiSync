# M2.3.1 Implementation Status

**Branch:** `feature/m4-2-8-clothing-detail`

## Implemented in source

### Top-level navigation

Android now has the M2.3 three-destination shell:

- `图库` — default destination, current synced library.
- `已保存` — selectable placeholder reserving the saved-original library and future user-edited derivative relinking.
- `我的` — selectable placeholder reserving player UID/photo summary and future clothing-piece/outfit search.

The future copy is intentionally explicit and does not fabricate saved records, UID, counts, or search results.

### Version-first 图库

Protocol v1 `AssetSummary` was extended additively with:

```ts
gameVersion?: string
gameVersionSource?: 'explicit' | 'inferred' | 'unknown'
```

PC gallery summaries read `metadata.identity.gameVersion` defensively. A valid non-empty value is emitted as `explicit`; absent or malformed metadata is emitted as `unknown` without breaking the library list.

Android retains both summary fields and groups the gallery with `GalleryVersionGroups`:

- semantic numeric version ordering (`2.10 > 2.9`);
- newest capture time first inside a group;
- `版本未知` isolated at the end;
- support for an `inferred` provenance label when a future PC calendar resolver supplies it.

The gallery UI now renders a version header and count followed by a three-column thumbnail grid. Existing thumbnail loading, LIVE badge, selection state, viewer, rotation, metadata/outfit detail, and save paths are reused rather than reimplemented.

## Tests/contracts added

- Protocol compile/runtime contract for additive game-version summary fields.
- Focused PC row-mapper tests for explicit version and malformed/missing metadata fallback.
- `mobile:validate` now requires:
  - mobile game-version model/JSON parsing;
  - semantic version grouping and unknown bucket;
  - `图库 / 已保存 / 我的` navigation;
  - future Saved/My capability reservation copy;
  - all previously required rotation, metadata, clothing-thumbnail, transport and export contracts.
- Root `npm test` now includes `apps/pc-companion/dist/test/row-mappers.test.js`.

## Verification status

This implementation was written through the GitHub connector only. No local Node/Gradle/Android execution environment was available in this session, so the following are **not yet claimed as passing**:

```powershell
npm run typecheck
npm test
npm run mobile:validate
npm run mobile:build
```

Codex/local execution must run these before M2.3.1 is marked verified.

## Required device acceptance

1. App launches into `图库` and bottom nav shows all three destinations.
2. `已保存` and `我的` switch correctly and return to `图库` without losing the remote library.
3. Photos with explicit versions appear in the correct sections; `2.10` sorts above `2.9`.
4. Missing-version photos appear under `版本未知`.
5. Thumbnail tap still opens the viewer.
6. Long-press selection and batch save still work.
7. Ordinary-photo rotation controls and rotated save remain present.
8. Metadata, outfit names/categories and clothing thumbnails still load.
9. LIVE saving behavior remains unchanged.

## Deliberately deferred

- Production cached public version-calendar fetching/date inference. The protocol/UI already accept `gameVersionSource: 'inferred'`, but M2.3.1 does not guess dates without a verified calendar source.
- Actual `已保存` system-gallery/export-record library.
- Relinking a user-edited saved derivative back to its source NikkiSync asset.
- `我的` UID/dashboard implementation.
- Clothing-piece and outfit/set search.
- Full-screen viewer redesign, Info bottom sheet, pull-to-refresh replacement, predictive back, Monet background and liquid-glass polish.
