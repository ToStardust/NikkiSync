# NikkiSync Outfit Inspiration Feature

## Goal

Add a mobile-first outfit inspiration notebook for Infinity Nikki outfit/dye/share codes.

User flow:

1. Player finds a favorite outfit or dye code.
2. Save the code, screenshot, source text, tags and notes in NikkiSync.
3. Resolve the code when supported.
4. Map resolved clothing parts back to NikkiSync clothing metadata.
5. Find previously photographed similar outfits.
6. Sync to PC for search and one-click copy.

## Scope

This feature is independent from Live Photo, NUAN5 photo protocol, and PC shell redesign.

## Core principles

- Saving a code must work without PC connection.
- Parsing failure must never delete the user's note.
- Parsed data is a cache/snapshot, not the source of truth.
- User-written title, notes and tags must never be overwritten by resolver updates.
- Do not read game memory or automate game input.

## First milestone

- Local inspiration storage.
- Import from pasted text/share intent.
- Tags and custom categories.
- Reference image backup.
- PC synchronization design.
- Codex implementation handoff.

## Future milestones

- Share code resolver.
- Clothing lookup without existing photos.
- Outfit similarity search.
- PC inspiration management UI.
