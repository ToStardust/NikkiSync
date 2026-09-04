# M1.0 PC Scanner Foundation

Implemented the read-only Windows scanner pipeline:

```text
auto discovery -> stability guard -> resource classifier -> AssetResolver v1 -> SQLite reconciliation -> revision journal
```

## Acceptance

Against the local installation at `D:\GAME\InfinityNikki Launcher\InfinityNikki` on 2026-09-02:

- 418 files observed under hidden `X6Game\Saved\GamePlayPhotos`.
- 288 source resources accepted: 171 HighQuality, 111 LowQuality, 3 motion covers and 3 motion videos.
- 130 unsupported/companion files ignored (including 79 `.bin` DIY files); no normal album is created for them.
- 174 assets created: 171 ordinary photos and 3 motion-photo bundles.
- 3 resolver candidates persisted for the exact cover/MP4 bundles.
- A second full scan produced 0 updates, 0 deletions and 0 new journal revisions.

The game tree is never written. Missing files are soft-deleted in SQLite and their resources become `missing`; physical deletion is not performed by the scanner.
