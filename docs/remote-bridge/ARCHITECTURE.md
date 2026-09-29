# NikkiSync Remote Bridge Architecture

## Goal

Provide a lightweight connection path for clients that cannot use the native NikkiSync Android app, especially WeChat Mini Program users on iOS.

Primary use case:

Windows NikkiSync PC -> Remote Bridge -> WeChat Mini Program -> save photos to phone

## Principle

Do not become a cloud photo service.

Photos remain on the user's PC whenever possible.

The bridge is responsible for:

- device discovery
- temporary authorization
- file listing
- controlled download
- transfer status

## Proposed architecture

```
NikkiSync PC
 |
 | local photo database
 |
 RemoteBridgeService
 |
 +---- pairing token
 +---- temporary share session
 +---- resource download API
 |
 connection layer
 |
 WeChat Mini Program
```

## Why not upload everything to cloud

- privacy
- storage cost
- existing NikkiSync local-first design

## Connection modes

### Phase 1

Temporary share session.

PC creates a QR code containing a short-lived token.

Mini Program connects and downloads selected resources.

### Phase 2

Optional signaling service.

Cloud only stores:

- device presence
- temporary token
- connection metadata

It does not store photos.

## Scope

Only photo export.

Do not replace Android app capabilities:

- metadata parsing
- gallery indexing
- clothing search
- outfit matching
