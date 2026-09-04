# M4.2 Metadata Dictionary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a versioned PC-side metadata dictionary that enriches resolved Infinity Nikki IDs into canonical names/categories/rarity/thumbnail references without changing Android for each game update.

**Architecture:** Add provider-neutral dictionary manifest types in core, persist one active snapshot in SQLite, and introduce a PC `MetadataDictionaryService` that enriches existing `InfinityPhotoMetadata` locally. Keep dictionary updates independent from NUAN5 photo resolution; unknown IDs remain lossless and source media never leaves the PC.

**Tech Stack:** TypeScript, Node.js 24+, built-in `node:sqlite`, existing NikkiSync core/database/pc-companion packages, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-03-m4-2-metadata-dictionary-design.md`

## Global Constraints

- Work only inside `D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\CameraPartner\NikkiSync`.
- Do not modify Infinity Nikki source media.
- Do not enable NUAN5 by default or add batch NUAN5 authorization.
- Android must not depend on provider-specific dictionary JSON.
- Unknown IDs must remain present and lossless.
- Existing canonical user-authored names win over dictionary names.
- `raw.nativeParamPayload` and `raw.nativeParamNuan5Md5` remain LAN-redacted.
- No thumbnail image bytes are persisted in M4.2.

---

### Task 1: Canonical dictionary manifest types and enrichment model

**Files:**
- Modify: `packages/core/src/types.ts`
- Test: `packages/core/test/metadata-dictionary.test.ts`

**Interfaces:**
- Produces: `MetadataDictionaryEntry`, `MetadataDictionaryManifest`, `MetadataDictionaryKind`, `enrichPhotoMetadataWithDictionary(metadata, manifest)`.

- [ ] **Step 1: Write failing core tests**

Cover filter/light names, clothing object expansion, unknown IDs, existing names, pose/location enrichment.

- [ ] **Step 2: Run the focused core test and verify RED**

Run the core package build/test path and confirm failure is caused by missing dictionary types/enricher.

- [ ] **Step 3: Implement minimal canonical types and pure enricher**

The pure function must not perform I/O and must preserve existing raw fields.

- [ ] **Step 4: Verify focused tests GREEN**

- [ ] **Step 5: Run existing core resolver tests**

---

### Task 2: SQLite dictionary snapshot persistence

**Files:**
- Modify: `packages/database/migrations/0001_initial.sql` only if the database migration manager recreates schema from the single migration for all supported databases; otherwise add the next supported migration according to the existing migration mechanism.
- Create/Modify: `packages/database/src/repositories/MetadataDictionaryRepository.ts`
- Modify: `packages/database/src/index.ts`
- Test: `packages/database/test/database.test.ts`

**Interfaces:**
- Consumes: `MetadataDictionaryManifest`.
- Produces: `replaceSnapshot(manifest)`, `getActiveManifest()`, `lookup(kind, id)`.

- [ ] **Step 1: Inspect migration semantics before editing SQL**

Determine how existing installations receive schema changes. Do not rewrite historical migration behavior if that would strand deployed databases.

- [ ] **Step 2: Write failing repository tests**

Cover transactional replacement, duplicate `(kind,id)` handling, persisted provider/version/game version, and rollback on invalid replacement.

- [ ] **Step 3: Verify RED**

- [ ] **Step 4: Add schema and repository implementation**

Snapshot replacement must be atomic.

- [ ] **Step 5: Verify database tests GREEN**

---

### Task 3: PC dictionary service and local manifest loading

**Files:**
- Create: `apps/pc-companion/src/metadata/MetadataDictionaryService.ts`
- Create: `apps/pc-companion/src/metadata/MetadataDictionaryConfigFile.ts`
- Test: `apps/pc-companion/test/metadata-dictionary.test.ts`

**Interfaces:**
- Consumes: database repository and canonical manifest.
- Produces: `loadLocalManifest(path)`, `replaceManifest(manifest)`, `enrichAsset(assetId)`, `reenrichResolvedAssets()`.

- [ ] **Step 1: Write failing tests for manifest validation and local-only re-enrichment**

Assert that no photo resolver is invoked during dictionary re-enrichment.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement local file loader and dictionary service**

Invalid manifest must leave previous snapshot intact.

- [ ] **Step 4: Verify service tests GREEN**

---

### Task 4: Integrate dictionary enrichment into resolver success path without coupling providers

**Files:**
- Modify: `apps/pc-companion/src/metadata/MetadataResolverService.ts`
- Modify: `apps/pc-companion/src/runtime.ts`
- Test: `apps/pc-companion/test/metadata-resolver.test.ts`

**Interfaces:**
- Consumes: optional dictionary enricher callback/service.
- Produces: resolved metadata that is locally enriched before SQLite merge.

- [ ] **Step 1: Write failing integration test**

Use a fake photo resolver returning IDs and a local dictionary; verify canonical metadata gains names while only one resolver call occurs.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Add optional dictionary enrichment hook**

Do not change default resolver scheduling or provider enablement in this task.

- [ ] **Step 4: Verify integration tests GREEN**

---

### Task 5: PC startup configuration for a versioned local dictionary

**Files:**
- Modify: `apps/pc-companion/src/windows-app.ts`
- Modify: `docs/M4_METADATA_READ_WRITE.md`
- Modify: `docs/GPT_HANDOFF_2026-09-02.md`
- Test: `apps/pc-companion/test/metadata-dictionary.test.ts`

**Interfaces:**
- Reads optional `%LOCALAPPDATA%\NikkiSync\metadata-dictionary.json`.
- Does not contact any remote service by default.

- [ ] **Step 1: Write failing config/startup test**

Missing/invalid dictionary file must leave the app operational with no dictionary rather than fail startup.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Wire the local dictionary into runtime**

Keep NUAN5 configuration behavior unchanged.

- [ ] **Step 4: Verify GREEN**

---

### Task 6: Full regression verification

**Files:**
- No production changes unless verification exposes a regression.

- [ ] **Step 1: Run `npm test`**

Expected: all tests pass, including new M4.2 cases.

- [ ] **Step 2: Run `npm run mobile:validate`**

- [ ] **Step 3: Run `npm run mobile:build`**

- [ ] **Step 4: Run `npm run pc:exe`**

- [ ] **Step 5: Re-read M4.2 constraints**

Confirm no default NUAN5 enablement, no batch network request, no source-media upload, no Android provider coupling.

