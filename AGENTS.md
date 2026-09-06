# NikkiSync workspace instructions

Before changing any NikkiSync file, read:

```text
docs/GPT_HANDOFF_2026-09-06.md
```

The 2026-09-06 handoff is the current fact baseline and links back to `docs/GPT_HANDOFF_2026-09-05.md` for unchanged historical investigation evidence. Then read the more specific document for the requested area (for example `docs/M2_3_2B_AUTO_METADATA_RESOLUTION_EVIDENCE.md` for automatic photo metadata resolution, `docs/M2_3_MOBILE_GALLERY_UI_REQUIREMENTS.md` for Android UI, `docs/M2_3_1B_GAME_VERSION_CALENDAR_EVIDENCE.md` for M2.3.1B version inference, or `docs/M4_2_2B_LOCAL_DICTIONARY_EXTRACTION.md` for local dictionary work).

Use `apply_patch` as the only direct file-modification mechanism when operating through the local Nikki MCP. Keep the game installation under `D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game` read-only; it is not part of this workspace and must not be added as a writable root. Do not obtain archive keys from process memory or bypass archive protection. Write a failing test before production behavior, run the focused test, then run the relevant full regression. Do not claim a real extraction or device/network acceptance without the recorded evidence in the handoff documents.
