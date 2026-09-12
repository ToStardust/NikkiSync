# NikkiSync M2.3.2-1A MainActivity Refactor Audit

Branch: feature/m4-2-8-clothing-detail

## Baseline

Target:
- Android app MainActivity decoupling
- Preserve M4.2.8.x clothing detail / thumbnail / viewer behavior
- Prepare M2.3.x gallery UX refactor

## Current findings

MainActivity is currently acting as:

- Activity lifecycle owner
- UI construction owner
- Gallery controller
- Viewer entry point
- Pairing coordinator
- Sync coordinator
- Media save coordinator
- Network glue

## First extraction candidates

Priority 1:
- Gallery rendering and adapter interaction
- Gallery state management

Priority 2:
- Pairing state and connection status

Priority 3:
- Viewer state / rotation state

Priority 4:
- Media export actions

## Constraints

Do not change during this refactor:

- NUAN5 protocol parsing
- M4.2.7 clothing dictionary
- M4.2.8 thumbnail proxy behavior
- M4.2.8.2 rotation regression fixes
- Live photo compatibility implementations

## First implementation step

Introduce presentation-layer boundaries before moving behavior.
