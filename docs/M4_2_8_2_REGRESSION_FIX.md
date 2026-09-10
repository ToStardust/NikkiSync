# M4.2.8.2 Regression Fix — clothing thumbnails + ordinary-photo rotation

## Scope

This milestone is intentionally bounded to two regressions discovered after M4.2.8.1 real-device testing:

1. Some clothing entries resolve ID/name/category correctly but show no thumbnail. Reproduction example: `雪上月华` (`1023860042`, `skinTones`).
2. The previously working ordinary-photo rotation UI/export path disappeared from the Android photo viewer.

Do not use this milestone to add unrelated features.

## Implemented changes

### Clothing thumbnail fallback

The Nikki Albums public dictionary adapter now parses both:

- `network_image.cloth` (exact clothing thumbnail template)
- `network_image.cloth_type` (clothing-type fallback image template)

Canonical clothing metadata can carry an ordered `thumbnailFallbacks` list in addition to `thumbnail`.

The signed PC route remains:

`GET|HEAD /v1/assets/:assetId/clothing/:clothingId/thumbnail`

The PC server now tries candidates in order:

1. exact item `thumbnail`
2. `thumbnailFallbacks`

The mobile client still never supplies or fetches arbitrary third-party URLs directly.

If all PC-side candidates fail, Android renders a visible `暂无图` placeholder rather than leaving an empty tile.

For diagnostics, a successful proxy response includes:

`X-NikkiSync-Thumbnail-Source: primary|fallback`

and PC logs aggregate upstream/cache failures when every candidate fails.

Regression fixture explicitly covers `1023860042` and a failed exact item image followed by a successful `cloth_type` fallback.

Important: `cloth_type` is a graceful fallback, not proof that the exact item thumbnail exists upstream. Real-device acceptance should still record whether `1023860042` uses `primary`, `fallback`, or placeholder.

### Ordinary-photo rotation restored

Android photo viewer restores non-destructive rotation controls for ordinary still photos:

- left 90°
- right 90°
- state normalized to 0/90/180/270°
- selected orientation retained per asset until save

The preview rotates without mutating the PC source file.

Ordinary JPEG export now passes the selected rotation into `OriginalSaver`. The downloaded source bytes are first verified against `X-NikkiSync-SHA256`; after verification, non-zero rotation is written as JPEG EXIF orientation. This avoids recompression and preserves the downloaded JPEG image data.

Live/Motion Photo does not expose ordinary-photo rotation controls in this milestone. It shows a note instead. Rotating only the still while leaving the video unchanged is explicitly forbidden.

## Regression contracts

`apps/mobile/scripts/validate-m2.mjs` now asserts that:

- ordinary-photo saver accepts a selected rotation
- JPEG EXIF orientations 90/180/270 exist
- viewer has left/right 90° controls
- per-asset rotation state is wired into ordinary-photo save
- Live Photo remains separate from ordinary-photo rotation
- missing clothing thumbnails have a visible placeholder

Node tests cover:

- dictionary propagation of `thumbnailFallbacks`
- Nikki Albums parsing of `cloth_type` network-image template
- signed PC proxy primary candidate behavior
- signed PC proxy fallback behavior for `1023860042`

## Required local verification

Run from the fresh/current checkout of `feature/m4-2-8-clothing-detail`:

```powershell
npm ci
npm run typecheck
npm test
npm run mobile:validate
npm run mobile:build
```

If building the Windows companion for device acceptance:

```powershell
npm run pc:exe
```

Do not report PASS unless these commands actually ran successfully in the local environment.

## Required real-device acceptance

### A. Thumbnail regression

Use at least one photo whose decoded outfit contains:

- name: `雪上月华`
- clothing ID: `1023860042`

Confirm:

1. ID/name/category still resolve correctly.
2. The row no longer becomes a blank gray icon tile.
3. Record which result is observed:
   - exact thumbnail (`primary`)
   - clothing-type fallback (`fallback`)
   - visible `暂无图` placeholder
4. Confirm other clothing thumbnails that previously worked still load.
5. Confirm Android does not directly contact the public image host.

### B. Ordinary JPEG rotation

Use one ordinary non-Live JPEG.

Confirm:

1. Viewer shows `左转 90°` and `右转 90°`.
2. Preview cycles correctly through 0/90/180/270°.
3. Close/reopen the viewer before saving and confirm the selected orientation is retained for that asset.
4. Choose/save the photo and open the saved copy in the system gallery.
5. Confirm the gallery displays the selected orientation.
6. Confirm a 0° save still works normally.

### C. Live/Motion Photo guardrail

Open one Live/Motion Photo and confirm:

1. ordinary-photo rotation buttons are not offered;
2. the UI explains that still/video must be handled together later;
3. existing Live/Motion Photo save behavior is unchanged.

## Completion rule

M4.2.8.2 may be considered accepted only after:

- TypeScript/typecheck PASS
- Node tests PASS
- mobile source validation PASS
- Android build PASS
- the real-device checks above are completed

Until then, status is `implementation complete; local/device verification pending`.
