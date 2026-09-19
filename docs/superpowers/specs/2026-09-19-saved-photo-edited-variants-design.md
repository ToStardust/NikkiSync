# Saved Photo Groups / Edited Variants Design

**Date:** 2026-09-19  
**Status:** Approved product design; implementation not started in this document  
**Branch:** `feature/m4-2-8-clothing-detail`

## 1. Goal

Extend NikkiSync's existing **已保存** page so a user can keep the original image exported by NikkiSync and manually associate one or more later retouched/edited images with the same Infinity Nikki source photo.

The user flow is:

1. Save an original photo from NikkiSync.
2. Edit that exported photo in another app such as Lightroom, Snapseed, or the system gallery.
3. Return to NikkiSync's **已保存** page.
4. Select the original saved photo and choose **关联修图**.
5. Pick one or more edited images using the Android system photo picker.
6. NikkiSync records those images as edited variants of the same source asset.
7. The original saved image and all edited variants are displayed together in the Saved page.
8. Every member of the group can show the same Infinity Nikki metadata from the source asset.

This feature is an association/provenance feature. NikkiSync must **not** rewrite the edited image bytes, inject game metadata into the edited file, or delete the user's system-gallery media.

## 2. Existing behavior to preserve

The implementation must build on the current Saved flow rather than create a parallel gallery database.

Current behavior that must remain intact:

- `SavedPhotoStore.Record` keeps the source `assetId`, MediaStore URI, saved time, captured time, game version, rotation and output format.
- Successful exports are recorded through `SavedPhotoStore.record(...)`.
- Historical exported images can be recovered through `SavedPhotoRecovery`.
- `SavedPhotoVerifier` tracks whether an exported MediaStore item is still accessible.
- The Saved page can filter/sort existing records.
- Saved detail can open the system-gallery item and jump back to the source asset when it is still present.
- Removing a NikkiSync Saved record does not delete the system-gallery file.
- Original-photo rotation/export, Live Photo vendor saving, source metadata, pairing and LAN sync behavior remain unchanged.

## 3. Core model

The user-visible concept is a **Saved Photo Group**.

A group is keyed by the Infinity Nikki source `assetId` and contains:

```text
SavedPhotoGroup
├─ sourceAssetId
├─ source metadata snapshot
├─ original saved records (1..N for compatibility with historical/re-save behavior)
└─ edited variants (0..N)
```

The implementation does not need to persist a separate group table/object if grouping can be derived safely from records. The important invariant is:

> Every saved/edited media item must retain an unambiguous source `assetId`, and edited variants must additionally retain the identity of the original Saved record/group they were linked from when needed for provenance.

### 3.1 Edited variant record

Add a user-owned edited-variant record with at least:

- `variantId`: stable NikkiSync-local identifier.
- `assetId`: source Infinity Nikki asset.
- `uri`: selected system media URI.
- `linkedAt`: time the user created the association.
- `displayName` when available.
- `mimeType` when available.
- `sourceSavedUri` or another stable original-record identity when the association was initiated from a specific saved record.
- Health/access state must be derived through the same verification concept as existing Saved media.

Do **not** use filename, image similarity, EXIF, perceptual hash, capture time, or dimensions as the authority for this association. The user explicitly chose the image, so the manual association is authoritative.

### 3.2 Multiple originals

The current store can contain more than one Saved record for the same `assetId` (for example a later re-save or different presentation/export).

The new design must not collapse or destroy those records.

Grouping rules:

- Top-level grouping is by source `assetId`.
- Existing original Saved records retain their own URI, saved time, format and health.
- Edited variants remain attached to the source group and optionally remember which original Saved record initiated the link.
- No migration may silently delete duplicate historical Saved records.

## 4. Metadata inheritance and offline snapshot

Edited variants do not own game metadata. They inherit metadata from their source `assetId`.

The Saved feature must add a local, read-only **canonical metadata snapshot** per source asset so the user can inspect parameters even when the PC is offline.

Snapshot contents should be the same human-readable/canonical metadata NikkiSync already displays for a source photo, including when available:

- source identity / UID,
- game version,
- capture time,
- outfit / suit / clothing pieces,
- filter,
- lighting,
- camera parameters,
- other normalized human-readable photo parameters required by the existing detail UI.

Do not store or duplicate large opaque native parameter payloads merely for this feature.

### 4.1 Snapshot refresh policy

- On successful original save, fetch/use the current source metadata and persist a snapshot.
- When the PC is online and fresher canonical metadata is loaded for the source, the snapshot may be refreshed.
- When the PC is offline, Saved details use the last valid snapshot.
- Failure to refresh must not erase the last valid snapshot.
- The snapshot is NikkiSync-local data. It must never be written into the game source photo or edited image file.

### 4.2 Missing source asset

If the PC library later no longer contains the source asset:

- Existing Saved group and edited variants stay visible.
- The local metadata snapshot remains usable.
- The UI should state that the source is currently unavailable when the user tries to jump to it.
- No media association is automatically removed.

## 5. Manual association flow

The first version is **manual only**.

### 5.1 Entry point

On the **已保存** page:

1. User selects/opens an original Saved image.
2. Provide action **关联修图**.
3. Launch the Android system photo picker.
4. Allow selecting one or multiple images.
5. Persist read access for returned URIs when the platform/provider grants persistable access.
6. Create one edited-variant record per unique URI.
7. Return to Saved page and refresh the affected group.

No automatic scan or similarity recommendation is part of this milestone.

### 5.2 Duplicate selection

If the same URI is already linked to the same source group:

- do not create a duplicate record;
- do not reset the original `linkedAt`;
- show a concise result such as “已关联，已跳过重复项目”.

If a URI is already associated with a different source asset:

- do not silently move or duplicate it;
- show a confirmation that identifies the existing association;
- first implementation may reject cross-group reassociation and ask the user to unlink it explicitly before linking elsewhere.

This avoids one edited image inheriting two incompatible sets of parameters.

## 6. Saved page presentation

The user chose **direct expanded groups**, not an extra group-detail screen.

Example:

```text
9月19日 · 2.9版本
[原始保存] [修图] [修图]
[修图]

9月18日 · 2.9版本
[原始保存] [修图]
```

Rules:

- All media belonging to the same `assetId` are contiguous.
- Original Saved items appear before edited variants.
- Edited variants sort by `linkedAt` in a deterministic order; use newest-first unless implementation constraints conflict with the current Saved chronology, but the choice must be consistent and tested.
- The group itself follows the Saved page's selected sorting semantics. For “最近保存”, use the group's latest meaningful activity time (latest original save or variant link) so a newly associated edit is visible without searching.
- Existing type filters (LIVE / 普通) must be defined against the source/original type, not guessed from an edited JPEG.
- Each thumbnail gets only a compact badge:
  - `原图` / existing LIVE or rotation wording for original Saved records.
  - `修图` for linked edited variants.
- Do not overload thumbnails with source metadata text.

## 7. Edited variant detail

Tapping an edited variant opens Saved detail using that edited image as the preview.

The detail must provide:

- edited image preview,
- label indicating this is a linked edited version,
- link/action to view one of the original Saved images from the same group,
- source metadata section using current online metadata or the local snapshot,
- source Asset identity/provenance,
- **解除关联** action.

If the original Saved image is missing but another original record in the group is available, use an available original for “查看原始保存图”.

## 8. Unlink semantics

**解除关联** means:

- remove only NikkiSync's edited-variant association record;
- release app-held URI permission when safe and when that URI is no longer referenced anywhere else by NikkiSync;
- do not delete or modify the system-gallery file;
- do not delete the source asset;
- do not delete the original Saved record;
- do not delete the metadata snapshot merely because the last edited variant was removed.

The UI copy must make this distinction explicit.

## 9. Media access and Android storage

Use the platform system photo picker / document-style URI access rather than broad storage scanning permissions.

Requirements:

- No new broad “read all photos” permission merely for manual association.
- Persist URI access when supported and necessary for later thumbnail/detail loading.
- A provider may revoke or stop serving a URI; this is a health state, not grounds for silently deleting the association.
- Health verification should extend the existing Saved-media verification pattern.

If the user selects media from a provider whose permission cannot be persisted, the implementation must keep the record and surface inaccessible state later rather than pretending the association is permanent.

## 10. Storage migration

Existing users already have `SavedPhotoStore.Record` data. Migration must be lossless.

Preferred approach:

- Keep existing Saved records as the authoritative original-export history.
- Add a separate versioned local store for edited variants and metadata snapshots, or version the existing Saved store with explicit migration.
- Do not rewrite the existing JSON blob destructively during first launch unless tests prove all historical fields are preserved.
- Existing records automatically appear as groups containing only original Saved items.
- No user action is required to migrate.

If a new SQLite store is chosen, it must stay local/user-owned and independent from the PC game database.

## 11. Relationship to historical recovery

`SavedPhotoRecovery` remains responsible for recovering known NikkiSync exports by their existing conservative filename/path rules.

It must **not** attempt to recover edited variants automatically.

Reason:

- third-party editors can rename files, strip EXIF, crop or re-encode;
- manual association was explicitly chosen to avoid false matches.

Recovered original Saved records can later serve as a valid group target for manual edited-image association.

## 12. LIVE / Motion Photo behavior

Edited variants are generic user-selected images for this milestone.

- Do not infer that a selected edited image is a vendor Motion Photo merely because its source Asset was LIVE.
- The source group's `hasMotion` remains useful metadata about the original game photo.
- Linking a flattened edited JPEG to a LIVE source is allowed.
- This feature does not transcode, reconstruct or export edited LIVE video.
- Existing vendor-specific original save behavior remains untouched.

## 13. Failure and edge-case behavior

The implementation must explicitly handle:

- source PC offline,
- source asset removed from current library,
- original Saved file missing from MediaStore,
- edited variant missing/inaccessible,
- duplicate selected URI,
- edited URI already linked to another source,
- picker cancelled,
- picker returns partial results,
- metadata snapshot unavailable,
- multiple original Saved records for one asset,
- old Saved history created before this feature.

None of these may delete user media.

## 14. Implementation boundaries

Do not:

- modify Infinity Nikki source media,
- inject metadata into edited files,
- upload edited media to the PC merely to create the association,
- add automatic image matching in this milestone,
- create a second unrelated “edited gallery” tab,
- break existing Saved filters, health checking, recovery or source navigation,
- require the PC to be online just to browse previously cached Saved metadata.

The feature belongs inside the existing **已保存** experience.

## 15. Testing requirements

At minimum, automated tests must cover:

### Storage
- existing Saved records survive upgrade unchanged;
- one source asset can have N edited variants;
- duplicate URI for the same group is idempotent and preserves original `linkedAt`;
- a URI cannot silently belong to two different source assets;
- unlink removes only the association;
- group survives missing original media;
- metadata snapshot survives offline use and failed refresh.

### Projection/grouping
- records with same `assetId` are contiguous;
- originals precede variants;
- variants are deterministically ordered;
- newly linked edit updates “recent activity” ordering;
- existing Saved filters remain semantically correct.

### Picker/URI behavior
- cancelled picker creates nothing;
- multiple selection creates multiple variants;
- inaccessible URI becomes a visible health state, not an auto-delete;
- persisted permission is requested only for returned URI grants supported by Android.

### UI
- original record offers **关联修图**;
- edited variant displays **修图**;
- edited detail shows inherited metadata;
- **解除关联** never calls MediaStore delete;
- “查看原始保存图” and “查看源照片” degrade safely when targets are unavailable.

## 16. Acceptance criteria

The milestone is accepted when all of the following are true:

1. A user can open an existing Saved original and manually select multiple edited images.
2. The edited images appear immediately next to the original in the Saved page as one source group.
3. Reopening the app preserves all associations.
4. Tapping any edited image shows the same source Infinity Nikki parameter information.
5. Those parameters remain available from a local snapshot when the PC is offline, when a snapshot has previously been captured.
6. The user can add more edited images to the same source later.
7. The user can unlink one edited image without deleting any system-gallery file or affecting other group members.
8. Historical Saved records continue to work without manual migration.
9. Existing Saved recovery, health verification, original save, LIVE save and source navigation remain operational.
10. No automatic similarity matching is introduced.

## 17. Recommended implementation decomposition

Keep responsibilities isolated:

- `SavedPhotoStore`: existing original export provenance; preserve compatibility.
- New edited-variant store: user-selected edited-media relationships and URI provenance.
- New metadata-snapshot store: canonical source metadata for offline Saved details.
- Pure Saved-group projection: combines original records + variants by `assetId` for adapter consumption.
- `SavedPhotoAdapter`: renders full-width group headers/contiguous media rows and compact original/edited badges.
- `MainActivity`: picker launcher, link/unlink orchestration and navigation only; storage/grouping logic stays outside the Activity.
- Existing `SavedPhotoVerifier` pattern: extend/reuse health verification for edited URIs without destructive cleanup.

This design deliberately avoids putting relationship logic into `MainActivity`, which is already large and should not become the persistence layer for this feature.
