# M2.3 Mobile Gallery UI Requirements

**Status:** approved product/UI requirements; not implemented yet.  
**Purpose:** preserve the next Android gallery direction for a later implementation handoff.

## Product intent

NikkiSync mobile is a local photography companion for Infinity Nikki: photos are taken on PC, arrive on the phone over the local NikkiSync connection, and can be reviewed and saved into the phone's system gallery. It should feel like a focused photo gallery, not a generic file browser. Photos remain the visual focus; connection, selection, metadata, and save controls remain quiet and clear.

The existing M2/M3 protocol, pairing, local-only transport, source scanning, metadata handling, and vendor-specific Live Photo export remain valid. This document changes neither the PC game files nor the original source resources.

## Reference visual language

The design direction follows the separate PhotoLayout UI replication handoff supplied by the user:

- Use a shared photo/content layer below UI chrome. Blur/glass layers sample only that content layer; text, buttons, and sheet content render above it. Do not recursively capture a backdrop that contains itself.
- Use progressive top blur for navigation over scrolling photos.
- Use compact, restrained liquid-glass treatment for app chrome and the selection dock; do not obscure thumbnails with decorative glass.
- Use a larger frosted bottom sheet for information and settings. Large sheets do not need expensive refraction shaders.
- On the photo viewer, an image-derived Monet-style background may be used behind the image and controls. The same image must always resolve to the same palette; it must not use random colors.
- Support Android predictive back: a sheet closes before the viewer, and the viewer returns to the gallery with a natural shared/slide transition.
- Devices where high-quality blur is unsuitable must fall back to simple translucent surfaces/alpha gradients without losing any function.

App chrome glass and any future template/export glass are separate render systems. NikkiSync currently has no template editor/export feature, so template glass is out of scope.

## Gallery home

### Version-first groups

The home gallery's primary grouping is **Infinity Nikki game version**, not calendar day. Versions sort newest-first; photos inside each group sort by capture time newest-first.

Example:

```text
2.9 版本                                      128 张
自动推测 · 2026-08-28 至今

[photo] [photo] [photo]
[photo] [photo] [photo]

2.8 版本                                       73 张
2026-07-17 – 2026-08-28
```

Requirements:

- A photo's explicit `metadata.identity.gameVersion`, when available, is authoritative.
- Otherwise infer its version from a maintained Infinity Nikki version calendar and the best available source timestamp, in this order: embedded capture timestamp, source-file creation time, source-file modification time.
- Version time boundaries use the actual version availability time after maintenance, normalized to UTC. Do not compare un-normalized local timestamps against official notices that use other time zones.
- The app must distinguish an explicit version from an inferred version internally. The group header may say `自动推测`; individual thumbnails do not repeat this label.
- A time that cannot be matched belongs in a `版本未知` group; never force a misleading version.
- Sort semantic versions numerically by segments: `2.10` is newer than `2.9`.
- The version calendar is a small, cached PC-side data set with source URLs and retrieval time. It is updated once and applied locally to all assets; the app must not make one network request per photo. If update fails, the last valid local calendar remains usable.
- A future calendar change or improved source timestamp may re-infer existing photos without re-downloading media or rescanning the game tree.

### Gallery states and controls

- A compact top area contains the title, the current PC name, and a tappable connection-state pill.
- Connection states are visually distinct: connected/realtime, synchronizing (with count if known), PC temporarily unavailable (last loaded photos remain visible), and error/retry/re-pair.
- Pull-to-refresh is the primary manual refresh action; a separate visible refresh button is not required in the polished UI.
- Empty/unpaired, empty/connected, loading, and failed/retry states must each have useful copy and one clear next action.
- Thumbnails show only meaningful compact indicators: LIVE, downloaded/saving/failed, and optionally metadata availability. Avoid persistent text overlays.
- Long-press starts selection. In selection mode, the top UI offers Cancel, selected count, and Select all/clear selection. A bottom glass dock provides the primary save action.
- Saving selected items shows total progress, per-item failure, retry for failed items, and a route to view completed output in the system gallery.
- The user can change the grid density with a two-finger gesture (2/3/4 columns) when this does not conflict with platform accessibility gestures.

## Photo viewer

The present fixed-height dialog is replaced by a full-screen viewer.

- Tap a thumbnail to open it; swipe horizontally between photos in the current version group/context.
- Single tap toggles viewer chrome. Double tap and pinch zoom the still image.
- The viewer displays a small, unobtrusive LIVE indicator where applicable.
- The primary actions are Save and Info. Info opens a frosted bottom sheet containing human-readable metadata: capture time, resolution, location, outfit/parts, filter, lighting, and camera parameters. Internal IDs and raw JSON are hidden behind an optional technical/details section.
- User-editable metadata remains clearly separate from game-derived metadata. Editing does not overwrite scanner-owned identity, raw payload, or source provenance.
- Long-press playback for LIVE is a future viewer capability; the UI must reserve a safe place for it without claiming it is implemented.

## Rotation requirement

Rotation is a user-owned, non-destructive presentation/export adjustment for incorrectly oriented photos. It is a required future capability for **both still images and LIVE photos**.

### User interaction

- A `Rotate 90° clockwise` action appears in the viewer's top/right action area. Repeated taps cycle `0° → 90° → 180° → 270° → 0°`.
- Rotation applies instantly to the viewer and, after returning, to the gallery thumbnail.
- The chosen rotation is stored locally by NikkiSync asset ID and is never written into the Infinity Nikki game directory or the PC source media.
- Provide `Restore original orientation` when the saved angle is non-zero.
- A pre-existing saved item is never silently overwritten. A later save after changing rotation creates an explicit new output/re-save flow.

### Download/export contract

- A zero-degree still save continues to be byte-identical after the verified PC download, as defined by the M2 save contract.
- A rotated still download verifies the source resource during transfer, then decodes, rotates pixels, re-encodes, and writes a new system-gallery image. The rotated result is intentionally not byte-identical to the source; UI wording must call it a rotated export, not an original-byte export.
- A rotated LIVE download is a hard product requirement, not an optional fallback. It must rotate both the still cover and all visible video frames consistently, then generate the target vendor's valid motion-photo/moving-photo package.
- LIVE rotation must preserve an appropriate presentation timestamp/frame correspondence after video transform. It must not rotate only the JPEG cover while leaving the motion video unrotated.
- Each Android vendor adapter (standard/Pixel-Xiaomi, vivo/iQOO, OPPO/OnePlus/realme, Samsung, Huawei/Honor) needs its own rotated-export test and physical gallery verification before being declared supported.
- Until a specific vendor's rotated LIVE export passes device verification, the app may keep preview rotation but must state that rotated LIVE save is unavailable for that vendor. It must not silently save an incorrectly oriented or flattened asset.

## Data and implementation boundaries

- Keep protocol/security/media-scanning logic independent from the new UI layer. A future Compose UI migration may replace Java-created Views while retaining the existing client, pairing, TLS pinning, and media adapters.
- Add a per-asset local presentation record for rotation and saved/export state; it is not part of the game metadata and should not be uploaded to a resolver or remote dictionary provider.
- Add the resolved/inferred game-version field to the PC asset data returned in gallery summaries, so the mobile home screen does not need to request full metadata for every thumbnail.
- PC version-calendar refresh must be opt-in/configurable if it accesses the public internet. No photo bytes, UIDs, native metadata tuples, or asset identifiers are sent to fetch the calendar; the request retrieves public version-calendar data only.
- Existing Local Sync Server and Android gallery behavior must remain usable when version metadata, the calendar, or optional visual effects are unavailable.

## Delivery sequence

1. Establish UI tokens/layout structure and resilient gallery/connection states.
2. Add PC-derived game-version summaries and cached version-calendar inference; implement version-first home groups.
3. Replace the simple viewer dialog with a full-screen viewer and metadata sheet.
4. Add non-destructive rotation state plus static-photo rotated export.
5. Add a shared LIVE rotation/transcode pipeline and implement rotated export per vendor adapter, with real-device verification.
6. Add progressive blur, restrained glass, predictive back, and image-derived background polish while meeting device performance budgets.

## Acceptance criteria

- A mixed library is grouped by the correct explicit or inferred game version and behaves correctly without internet after the calendar has been cached.
- Unknown or ambiguous timestamps are visibly isolated rather than misclassified.
- The user can rotate a still photo, see the rotation immediately in viewer/grid, and save a correctly oriented system-gallery image while the PC source remains unchanged.
- The final feature supports a rotated, playable LIVE export whose still and video share the same orientation on every advertised vendor device.
- Rotation, version-calendar failure, visual-effect fallback, and connection loss do not block browsing or saving unaffected photos.
