# NikkiSync workspace instructions

Before changing any NikkiSync file, read:

```text
docs/GPT_HANDOFF_2026-09-04.md
```

Then read the more specific document for the requested area (for example `docs/M2_3_MOBILE_GALLERY_UI_REQUIREMENTS.md` for Android UI or `docs/M4_2_2B_LOCAL_DICTIONARY_EXTRACTION.md` for local dictionary work).

Use `apply_patch` as the only direct file-modification mechanism. Keep the game installation under `D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game` read-only; it is not part of this workspace and must not be added as a writable root. Do not obtain archive keys from process memory or bypass archive protection. Write a failing test before production behavior, run the focused test, then run the relevant full regression. Do not claim a real extraction or device/network acceptance without the recorded evidence in the handoff documents.
