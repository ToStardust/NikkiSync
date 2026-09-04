# M3 Vendor Live Photo Adapters

Last updated: 2026-09-02

## Goal

Infinity Nikki exposes a still JPEG plus an MP4 motion clip. NikkiSync treats those files as canonical source material and performs the platform-specific Live/Motion Photo packaging on the phone.

There is no single Android vendor format. M3 therefore uses per-vendor adapters rather than trying to make one JPEG+MP4 wrapper work everywhere.

## Xiaomi / HyperOS — verified on device

Status: **working on the user's Xiaomi device**.

The working path is a single JPEG Motion Photo containing the original JPEG plus appended MP4. The JPEG XMP carries both modern Motion Photo/container metadata and legacy MicroVideo compatibility metadata.

Critical lesson: `presentationTimestampUs` must point at the video frame matching the Infinity Nikki still cover. Writing an unknown `-1` timestamp produced a file with the right size but HyperOS Gallery treated it as static. The Android client now searches the motion clip for the closest matching cover frame before packaging when the PC has no canonical timestamp.

Do not regress this path to an unset presentation timestamp.

## vivo / iQOO / OriginOS — implementation ready, device verification pending

OriginOS uses a **paired JPG + MP4**, not the Xiaomi/Google single-file wrapper.

NikkiSync now generates:

- same-stem `IMG_*.jpg` and `IMG_*.mp4` in `DCIM/Camera`;
- one shared 28-character vivo live-photo ID;
- vivo private payload appended after JPEG EOI;
- `Make=vivo`, device model, and `module: live_photo;` EXIF markers;
- a trailing MP4 `uuid` box whose user type is `vivoMediaExtInfo`;
- `com.android.camera.imageTime` derived from the automatically matched cover frame;
- vivo payload trailer magic `1b2a39485766758493a2b3`.

The implementation is based on publicly documented/reverse-engineered OriginOS/iQOO sample structure and still requires real vivo/iQOO gallery verification before being marked stable.

## OPPO / OnePlus / realme — implementation ready, device verification pending

ColorOS/OxygenOS O-Live uses a **single JPEG with an appended MP4**, but extends Google Motion Photo V2 with Oplus metadata. Public reverse-engineered output has been verified on Find X7 Ultra / ColorOS 14.

NikkiSync now generates:

- standard Motion Photo/container XMP with the automatically matched presentation timestamp;
- `OpCamera:MotionPhotoOwner=oplus`;
- `OpCamera:OLivePhotoVersion=2`;
- `OpCamera:MotionPhotoFeatureFlag=1`;
- `OpCamera:VideoLength=<MP4 byte length>`;
- EXIF `UserComment=Oplus_8388608`;
- an MPF APP2 segment declaring one Baseline MP Primary image;
- output into `DCIM/Camera` so ColorOS Gallery indexes it as camera media.

This path is intentionally separate from Xiaomi even though both are single-file JPEG+MP4 containers. It requires OPPO/OnePlus/realme device verification before being marked stable.

## Samsung Galaxy — implementation ready, device verification pending

Samsung uses a JPEG with a trailing `MotionPhoto_Data` field and a final SEF index/check section. The SEF trailer must remain the last trailer in the file.

NikkiSync now generates:

- Google-compatible Motion Photo XMP including the matched presentation timestamp;
- a `MotionPhoto_Data` field containing the original Infinity Nikki MP4;
- Samsung marker `0x0A30` with the `MotionPhoto_Data` field name;
- `SEFH` trailer header, version `106`, one field-index entry, and final `SEFT` marker;
- output into `DCIM/Camera`.

Samsung firmware differs across devices and newer models may additionally expose `mpvd` / `sefd` boxes or container-directory metadata. This implementation follows the long-standing SEF path and requires Galaxy Gallery verification before being marked stable.

## Current dispatch

- brand/manufacturer containing `vivo` or `iqoo` -> `VivoLivePhotoSaver`.
- brand/manufacturer containing `huawei` or `honor` -> `HuaweiMovingPhotoSaver` on Android-compatible devices.
- brand/manufacturer containing `oppo`, `oneplus`, or `realme` -> `OppoLivePhotoSaver`.
- brand/manufacturer containing `samsung` -> `SamsungMotionPhotoSaver`.
- other Android devices -> current standard/Xiaomi-compatible `MotionPhotoSaver`.

## Huawei / Honor Android-compatible path — implementation ready, device verification pending

Huawei/Honor Gallery documents moving pictures as JPG assets. Public extractors and current compatibility projects identify Huawei moving-photo video content by locating an MP4 payload after the still image. NikkiSync therefore has an Android-compatible writer that publishes the verified original JPEG followed immediately by the verified Infinity Nikki MP4 into `DCIM/Camera`.

This path does **not** pretend to implement native HarmonyOS media-library semantics. HarmonyOS currently exposes `PhotoSubtype.MOVING_PHOTO` and creates a moving-photo asset by submitting both `IMAGE_RESOURCE` and `VIDEO_RESOURCE` through a media asset change request. A future native HarmonyOS NikkiSync client should use that official API rather than emulating it from an Android APK.

Status: **implementation ready, real Huawei/Honor Gallery verification pending**.

Pixel/Google is already covered by the standard Motion Photo path but still needs an explicit compatibility verification pass. iOS remains a separate future adapter. Do not add a vendor adapter without either public vendor documentation or a known-good sample/implementation plus device verification.

