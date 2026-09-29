# Share Code Pipeline

## Separation

Photo metadata resolver and outfit share-code resolver are separate systems.

Photo:

```
photo -> NUAN5 metadata -> clothing
```

Share code:

```
share code -> resolver -> clothing/dye snapshot
```

## Resolver rules

- Raw code is always preserved.
- Resolver failure keeps the original note.
- Successful parsing stores a local snapshot.
- Dictionary updates must not destroy old snapshots.

## Unknown cases

- unsupported code
- network unavailable
- partial clothing data
- dictionary missing name/icon

These states must be visible instead of silently deleting data.
