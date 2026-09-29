# Outfit Inspiration Data Model

## InspirationEntry

- id: stable UUID
- title
- notes
- reference images
- tags
- custom categories
- status
  - want
  - tried
  - reproduced
  - archived
- createdAt
- updatedAt

## InspirationCode

- id
- entryId
- type
  - outfit
  - dye
  - unknown
- rawCode
- sourceText
- sourceUrl
- parsedState
  - pending
  - success
  - failed
  - unsupported
- parsedSnapshotId

## ParsedOutfitSnapshot

Cache only.

Contains:

- clothing IDs
- clothing categories
- dye data when available
- resolver version
- dictionary version
- resolvedAt

## Matching

Never store only a similarity score.

Store explainable matches:

- same clothing parts
- same suit
- partial overlap
- missing parts
