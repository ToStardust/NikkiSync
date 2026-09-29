# Remote Bridge Implementation Plan

## Phase 1: PC service foundation

Create:

```
RemoteBridgeService
```

Responsibilities:

- generate temporary QR session
- expose selected photo resources
- verify token
- expire sessions

Reuse existing NikkiSync PC resource streaming concepts.

## Phase 2: Mini Program client

Basic pages:

- scan/connect
- photo list
- preview
- save image

No account system required initially.

## Phase 3: Security

Required:

- short lived tokens
- explicit user confirmation
- limited resource scope
- no permanent open port

## Phase 4: Advanced

Possible additions:

- remote bridge for iOS clients
- outfit inspiration import
- share-code attachment export
- download history

## Not included

- cloud photo library
- public sharing platform
- game automation
