# Live Photo compatibility + rotation implementation plan

Date: 2026-09-26 (UTC+8)
Repository: `ToStardust/NikkiSync` (GitHub, not the Nikki MCP local workspace).
Base: `feature/m2-3-2d-share-card` at `50e1543dd9d0b4038bf808dd497035383c46ad17`.
Work branch: `feature/m3-livephoto-compat-rotation`.

## Approved scope

The user requested GitHub code artifacts and a Codex handoff for Live/Motion Photo only, including working still + video rotation. Do not change game parameter resolution, pairing, PC UI, share-card design, unrelated gallery behavior, or merge to main.

The earlier research proposal is the architectural baseline. This increment implements a shared export path and rotation, not a claim that every firmware/gallery/device is certified. Xiaomi's historical successful output is a regression baseline, not a brand-wide guarantee. Vendor SDKs requiring registration or credentials must not be represented by invented method calls.

## Design

- Canonical input remains the PC's verified JPEG + MP4; source files are read-only.
- New `media/live/` classes own profile selection, container construction, validation, rotation and MediaStore publication. MainActivity delegates Live exports and only holds presentation state.
- Zero rotation preserves source media encoding. 90/180/270 degrees rotate the displayed still and all video frames in the same clockwise direction, then rebuild the selected container. Existing image EXIF/video rotation must be normalized exactly once.
- Pin Media3 Transformer/effect to 1.8.0 for the existing compileSdk 35 project. Use a non-no-op MatrixTransformation wrapper plus portrait encoding to avoid the library optimizing a right-angle operation into only a muxer orientation tag. Validate actual output rotation and dimensions; do not silently accept resolution/HDR fallback.
- No silent trimming, frame-rate change, static-only fallback, lost audio, or source overwrite. Unsupported HDR/large-memory/encoder cases fail with a useful message rather than degrading silently.
- Prepared output is validated before MediaStore insertion. Track every URI in multi-file exports and compensate all insertions on handled failures. A MediaStore multi-file publish is not a real cross-collection transaction; process-death recovery remains an explicit acceptance case.
- Persist companion URIs with Saved records while retaining compatibility with old single-URI history. A successful write is not a gallery playback verification.
- Profiles: standard/Pixel, Xiaomi/Redmi/POCO compatibility, Oplus candidate, vivo legacy pair candidate, vivo modern XMP candidate, Samsung SEF candidate and Huawei legacy-tail candidate. Honor uses an explicitly unverified standard fallback until its real official SDK is integrated; native HarmonyOS is a separate platform deliverable.
- Profile overrides are explicit; do not infer the old/new vivo generation from a marketing model number. Huawei private-tail output is opt-in until a device sample confirms the selected layout.

## Implementation sequence

1. Add failing executable JVM checks for quarter-turn math, profile routing, JPEG/XMP replacement, Oplus MPF size, standard offsets, Samsung SEF bounds, vivo pair identity and Huawei tail bounds. Record the actual RED/GREEN result.
2. Implement pure-Java container and verification modules; retain unrelated JPEG metadata and reject unsupported multi-image/HDR layouts rather than corrupting their offsets.
3. Implement verified media preparation, low-memory cover-frame lookup from actual video sample timestamps, physical still/video rotation, and bounded/cancellable Media3 execution.
4. Add common exporter and Live viewer controls; snapshot per-photo rotations before batch work. Preserve failed items' rotation choices. Only the Live export branch changes.
5. Extend Saved records and health checks to include companion media without deleting the user's gallery media.
6. Add JVM and Android-device tests, including synthetic non-private four-corner fixtures for 0/90/180/270 degrees, dimension/rotation/audio/duration checks and zero-degree byte preservation.
7. Write a per-vendor compatibility/implementation matrix and Live-only Codex handoff with actual commits, verification evidence, pending SDK tasks and device checklist.

## Validation and release rules

Run `node apps/mobile/scripts/test-livephoto-core.mjs` for dependency-free JVM behavior checks. Run the existing Node/source contracts and `./gradlew testDebugUnitTest assembleDebug assembleDebugAndroidTest` when the complete toolchain is available. Run `connectedDebugAndroidTest` on a real capable Android device for codec/pixel tests. These layers must be reported separately.

This session's container has a JDK but no Android SDK/Gradle dependency cache or working network access. Therefore a local JVM pass must not be reported as a full Android build or device pass. Query hosted CI after the GitHub commit; an absent runner or job without steps is not a code-test pass.

No APK/EXE release or device installation is authorized by this task. No automatic merge to main. Keep the delivery PR a draft until fresh Android compilation and device smoke tests are recorded.

## Primary references

- Android Motion Photo format: https://developer.android.com/media/platform/motion-photo-format
- Media3 transformations: https://developer.android.com/media/media3/transformer/transformations
- Pinned Transformer API/source: https://github.com/androidx/media/blob/1.8.0/libraries/transformer/src/main/java/androidx/media3/transformer/Transformer.java
- Pinned rotation/transmux optimization: https://github.com/androidx/media/blob/1.8.0/libraries/transformer/src/main/java/androidx/media3/transformer/TransformerUtil.java
- Xiaomi official integration: https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2003
- Honor MediaData Kit: https://developer.honor.com/cn/docs/11032/guides/introduction
- OpenHarmony moving-photo API (recheck against target HarmonyOS SDK): https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/media/medialibrary/photoAccessHelper-movingphoto.md

Public reverse-engineered vendor formats are implementation evidence, not vendor warranties or NikkiSync device acceptance. The vendor matrix must name these limitations explicitly.
