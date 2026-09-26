# M3 Vendor Live Photo Adapters

Updated: 2026-09-26. This status supersedes the 2026-09-02 blanket vendor dispatch notes.

Current implementation and limitations: [Live Photo compatibility matrix](livephoto/COMPATIBILITY_MATRIX.md).

Current continuation instructions: [Live-only Codex handoff](livephoto/CODEX_HANDOFF_2026-09-26.md).

Device-specific acceptance: [Device checklist](livephoto/DEVICE_ACCEPTANCE.md).

## Historical evidence retained

The user's Xiaomi device previously recognized the project's JPEG + appended MP4 when a valid matching cover-frame timestamp was supplied. That is historical evidence for that device/environment only, not a Xiaomi-wide or new-code acceptance result.

## Current code

`MainActivity.saveSelected()` delegates Live output to `media/live/LivePhotoExporter`. New shared code owns verified download, still/video rotation, cover PTS, container writing and validation, MediaStore publishing and complete companion URI results. The previous vendor saver classes are retained as legacy reference, not the new export entry path.

The new `LivePhotoRotation` handles 0/90/180/270 degree user rotations; nonzero operations rotate both JPEG pixels and the complete video rather than changing only the cover or a video rotation tag. This is code implementation pending fresh Android build and device codec/gallery acceptance.

vivo now has distinct legacy pair and modern single-file candidates. Honor is not dispatched to Huawei's private format. Honor SDK and native HarmonyOS integration remain unimplemented follow-up deliverables; Huawei's private-tail candidate is manual/experimental.

No current profile should be described as fully certified on all models. File structure checks and source-only validation do not prove OEM Gallery playback. Read the matrix before enabling a new default or copying old assumptions.
