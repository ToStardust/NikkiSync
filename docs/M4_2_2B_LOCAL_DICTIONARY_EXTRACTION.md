# M4.2.2B Local Game Dictionary Extraction

Last updated: 2026-09-03

## Goal

Resolve Infinity Nikki game entity IDs from the locally installed client into a provider-neutral NikkiSync dictionary:

```text
102xxxxxxxx
  -> canonical item name
  -> category / slot
  -> rarity
  -> icon / thumbnail asset reference
```

The preferred source is the user's current local game installation. The M4.2.1 remote dictionary updater remains an optional fallback/hotfix transport, not the primary source of truth.

## Confirmed input ID space

`docs/M4_2_2_CLOTHING_ID_ALIGNMENT_EVIDENCE.md` establishes that NUAN5-compatible `clothes[]` values use the same 10-digit Infinity Nikki game entity-ID space as client/game assets. No NUAN5-specific clothing-ID translation layer is needed.

This investigation did not issue any additional photo-resolver or NUAN5 request.

## Local client archive evidence

The installed PC client was inspected read-only from `X6Game/Content/Paks`.

Current archive generation is identified by the package suffix `2816`. The installation contains IoStore and pak pairs including:

```text
Default_Loc_2816_P.{pak,ucas,utoc}
Default_L10N_2816_P.{pak,ucas,utoc}
Default_Misc_json_2816_P.{pak,ucas,utoc}
Default_Lua_2816_P.{pak,ucas,utoc}
Default_LuaFrameWork_2816_P.{pak,ucas,utoc}
global.{ucas,utoc}
```

This makes localization, structured-data and Lua partitions concrete candidates for entity dictionaries.

## Raw-byte probe result

`tools/m4-2-local-dictionary-probe/probe-binary-ids.mjs` performs a read-only scan of `.pak`, `.ucas` and `.utoc` files for known entity IDs encoded as ASCII, little-endian uint32 or big-endian uint32.

Probe IDs:

```text
1020100111
1020600111
1020900111
1023860042
```

No stable raw-table hit was found. `1020100111` occurred once as a four-byte little-endian sequence inside `Default_Movie_2816_P.pak`, but the surrounding bytes were high-entropy binary data with no adjacent entity/table structure. It is treated as a random binary collision, not dictionary evidence.

Conclusion: do not build M4.2.2B around naive grep/string scanning. The relevant records are inside Unreal archive/package serialization and require archive-aware extraction.

## Archive-aware extraction path

Current public CUE4Parse includes an Infinity Nikki game profile (`GAME_InfinityNikki`) and game-specific pak handling. Current UEExtractor is built on CUE4Parse, explicitly lists Infinity Nikki as a supported game with custom encryption auto-configuration, and supports extraction of Unreal `DataTable`, `StringTable`, and `.locres` resources.

For NikkiSync, the preferred implementation boundary is:

```text
Infinity Nikki local install
        |
        v
archive-aware extraction helper
  (CUE4Parse-compatible)
        |
        v
normalized local manifest
        |
        v
MetadataDictionaryService
        |
        v
SQLite snapshot + local re-enrich
```

Do not copy SpinningMomo GPL implementation into NikkiSync. Public SpinningMomo behavior may be used only as interoperability evidence. CUE4Parse itself is Apache-2.0 and is the better technical boundary if NikkiSync later embeds a dedicated extractor.

## Toolchain observation

The current development host has a .NET runtime on PATH but no .NET SDK. A bounded CUE4Parse compilation spike therefore cannot be built in the current environment without adding an SDK/tool binary first.

This is a development-tooling constraint, not evidence that the game archives are unsupported.

Do not add a permanent .NET runtime/SDK dependency to the NikkiSync PC application merely to unblock this probe. First validate extraction with a standalone helper, then decide packaging.

## Recommended implementation sequence

### M4.2.2B-1 — standalone archive inventory probe

Use an archive-aware helper to mount the current `2816` installation and emit only package/resource paths. Search for likely clothing/config/localization tables. No media or account data leaves the PC.

Acceptance evidence:

- Infinity Nikki archives mount successfully.
- At least one structured table/string/localization resource relevant to clothing is identified.
- Probe remains read-only.

### M4.2.2B-2 — target-ID record proof

Using the already known real IDs, locate at least two records from different appearance slots, for example:

```text
1020100111
1020600111
1020900111
```

Acceptance evidence must show the exact game/client record key and at least one human-readable or referential field associated with the same record.

Do not infer unresolved slot codes (`71/73/81-85/97/386`) from numeric shape alone.

### M4.2.2B-3 — localization join

Resolve the record's display-name key through local StringTable/locres/L10N data for the requested locale. Preserve the raw localization key as provenance.

### M4.2.2B-4 — icon reference

Identify the local Unreal asset/object path for the item icon. At this stage store only the canonical asset reference in the dictionary. Thumbnail decoding/proxy/cache remains a later bounded feature.

### M4.2.2B-5 — local dictionary generator

Generate the existing NikkiSync metadata-dictionary manifest schema and feed it through `MetadataDictionaryService`. Reuse current validation, SQLite snapshot replacement and local re-enrichment behavior instead of adding a second dictionary store.

## Version/change detection

The extractor should fingerprint the local game-data generation independently of the Android APK. At minimum include the observed package generation/suffix and selected archive file metadata. A changed fingerprint triggers a local dictionary refresh.

Target behavior:

```text
game updates
    -> local archive fingerprint changes
    -> PC regenerates dictionary
    -> resolved photos re-enrich locally
    -> Android receives canonical metadata
```

No Android application update is required for newly added clothes/names when the extraction schema remains compatible.

## Current boundary

M4.2.2A is accepted: clothing ID-space alignment is solved.

M4.2.2B is **investigation-complete / extraction-proof pending**. The next hard evidence is an archive-aware mount of the installed `2816` client followed by a real `102xxxxxxxx -> local record` lookup.

## 2026-09-04 CUE4Parse probe execution record

The isolated helper is now at:

```text
tools/m4-2-local-dictionary-probe/cue4parse-spike/
```

It uses the Apache-2.0 CUE4Parse NuGet package `1.2.2`, targets .NET 8, accepts an explicit `inventory <Paks-dir> --out <report-dir>` command, performs a before/after filename-size-time fingerprint, and writes JSON reports only below the helper output directory. It does not unpack files, scan arbitrary archive bytes, copy media, or modify the game installation.

The first real run used:

```powershell
dotnet run --project tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/Cue4ParseProbe.csproj -- inventory "D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\Content\Paks" --out tools/m4-2-local-dictionary-probe/cue4parse-spike/out/first-real-inventory-after-load-virtual-paths
```

Confirmed report fingerprint:

```text
fileCount: 33
totalBytes: 494,904,156
sha256: 4bbbaf5bc3a14f8bb59b13bd83e4a57d4a0334475deefeb6c23852453fbcc2f5
```

The result contained zero virtual paths. Direct CUE4Parse state inspection explains why: the helper recognized all 33 archive containers but kept them in `UnloadedVfs`; no AES key was supplied and the sampled pak readers report `IsEncrypted: true` and `bDecrypted: false`. Calling `LoadVirtualPaths()` also returned zero. This is an access-state diagnostic, not evidence that no clothing dictionary exists.

The old single-directory assumption was also corrected by a read-only recursive inventory of the game installation. The actual client additionally contains:

```text
X6Game/Saved/Paks          603 files, 131,819,302,732 bytes
X6Game/Saved/FastPatchPaks 132 files,     990,068,693 bytes
```

Those are now represented by `GameArchiveDirectories.Discover(X6Game-root)`, which recognizes the existing standard directories in deterministic order:

```text
Content/Paks
Saved/Paks
Saved/FastPatchPaks
```

No large scan was performed against the 131.8 GB Saved resource layer after the access-state check, because it would still produce a misleading empty result without an approved archive key source. The next decision is architectural: either obtain a legitimate, documented CUE4Parse-compatible key/configuration source for the installed client, or keep M4.2.2B at `extraction-proof pending`. Do not obtain keys from process memory, bypass protection, or store any key in NikkiSync reports/source control.
