# Codex Handoff - Outfit Inspiration

Branch:

```
feature/outfit-inspiration
```

## Scope

Only implement Outfit Inspiration.

Do not modify:

- Live Photo branch
- NUAN5 protocol
- PC pairing security
- unrelated gallery features

## Implementation order

1. Create Android local inspiration repository.
2. Add import flow:
   - paste code
   - Android share intent
   - preserve original text
3. Add inspiration UI.
4. Add categories and custom tags.
5. Add backup/sync model.
6. Validate share-code resolver integration separately.
7. Add clothing and photo matching.
8. Add PC display and copy support.

## Constraints

- Offline-first.
- Resolver is optional.
- Never overwrite user notes with parsed data.
- Never claim ownership from photo matches.
- No game memory access.
- No automatic game input.

## Expected final experience

Player saves a favorite dye/outfit code on phone, later finds the related clothing parts and previous photos, then copies the code quickly from PC after sync.
