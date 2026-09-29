# Codex Handoff - NikkiSync Remote Bridge

## Goal

Build a bridge that allows WeChat Mini Program users (especially iOS users without NikkiSync native app) to download photos from their own NikkiSync PC installation.

## Branch

feature/outfit-inspiration

## Scope

Only implement Remote Bridge foundation.

Do not modify:

- Live Photo
- NUAN5 parsing
- outfit inspiration data model
- pairing security implementation without review

## Expected flow

```
Windows NikkiSync PC
        |
RemoteBridgeService
        |
QR temporary session
        |
WeChat Mini Program
        |
photo preview
        |
save to phone
```

## Phase 1 tasks

1. Add PC-side RemoteBridgeService abstraction.
2. Add temporary session model.
3. Add QR payload format.
4. Add resource selection API.
5. Add expiration and authorization checks.

## Design constraints

- Local-first.
- Do not store photos in cloud.
- Do not expose permanent public endpoints.
- Every session must expire.
- User explicitly selects files to share.

## Future

After bridge stability:

- WeChat Mini Program client.
- iOS photo workflow.
- outfit inspiration import.
- remote share cards.

## Acceptance

A user can:

1. Open NikkiSync PC.
2. Select photos.
3. Generate QR code.
4. Scan from Mini Program.
5. Preview and save photos.

No cloud photo library is required.
