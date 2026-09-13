# M2.3.2 UX Status

**Branch:** `feature/m4-2-8-clothing-detail`

## Implemented

### Gallery shell
- Renamed the gallery-facing title to `暖暖相册`.
- Converted the top header and bottom navigation to the shared translucent card treatment.
- Reduced pairing emphasis to a compact action while preserving the existing pairing flow.
- Changed the gallery count copy to `已同步 N 张`.
- Selected bottom-tab state now uses the shared glass chip treatment.

### Version-first gallery
- Version headers now render as translucent cards.
- Version counts use `N 张照片` copy.
- Inferred-version provenance is retained in a compact chip.
- Thumbnail cells now use rounded clipping.
- LIVE badges use the shared glass chip style.
- Selection no longer dims the full photo; it uses a visible rounded overlay plus check indicator.

### Viewer
- Full-screen viewer now uses the app background rather than a plain white dialog.
- Added an explicit viewer header and close action.
- Photo preview uses rounded clipping.
- Rotation controls remain unchanged for ordinary photos.
- LIVE photos remain excluded from standalone rotation.
- Metadata, clothing rows, parameter editing and save selection are grouped into a translucent information sheet.
- Existing clothing-thumbnail proxy, resolver metadata and save/export paths are reused unchanged.

## Shared UX resources
- `bg_glass_card.xml`
- `bg_glass_chip.xml`
- `bg_selected_glass.xml`
- `bg_gallery_photo.xml`
- `dimens_gallery_ux.xml`
- `GalleryUxStyle.java`

## Regression protection
`apps/mobile/scripts/validate-m2.mjs` now additionally checks:
- shared glass card/chip wiring;
- rounded thumbnail clipping;
- non-dimming selection state;
- gallery shell title/count copy;
- M2.3.2 shell styling.

## Protected existing behavior
The UX work intentionally preserves:
- M4.2.8 clothing detail rendering;
- PC-proxied clothing thumbnails and fallback behavior;
- native parameter/resolver status;
- ordinary-photo rotation and rotated export;
- Live Photo vendor-specific save paths;
- long-press multi-select and batch original save;
- version-first grouping and semantic version ordering.

## Verification
GitHub Actions `NikkiSync CI` runs on every push to this branch:
- Node regression suite
- Android `testDebugUnitTest`
- Android `assembleDebug`

Do not mark device UX acceptance complete until a physical Android device confirms spacing, clipping and viewer behavior.
