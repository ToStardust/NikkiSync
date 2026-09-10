# M2.3.1 Gallery Version Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three-tab mobile shell and make 图库 render the synced library grouped by Infinity Nikki game version without regressing existing viewer/selection/save behavior.

**Architecture:** Extend the existing v1 `AssetSummary` additively with optional game-version fields. PC derives explicit version information from already-public canonical metadata and Android consumes it through its existing JSON/model layer. A small gallery presentation model turns flat assets into version sections, while MainActivity owns only top-level tab switching and leaves future Saved/My data providers deferred.

**Tech Stack:** TypeScript/Node 24 protocol + PC server, Java 17 Android Views, existing Node tests and `mobile:validate` static contract.

**Spec:** `docs/superpowers/specs/2026-09-10-m2-3-mobile-navigation-and-gallery-design.md`

## Global Constraints

- Keep protocol version at v1; changes are additive optional fields.
- Do not migrate to Compose in M2.3.1.
- Preserve pairing, TLS/signing, WebSocket, viewer, rotation, metadata/clothing, selection and save flows.
- 图库 is default; 已保存 and 我的 are selectable placeholders only in this milestone.
- Never force an unknown photo into a guessed version.
- Semantic version sorting must put `2.10` above `2.9`.
- No photo bytes, UID, native payload or asset identifiers are sent to external calendar/dictionary sources.

---

### Task 1: Protocol and PC explicit-version summary

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/test/protocol.test.ts`
- Modify: `apps/pc-companion/src/server/row-mappers.ts`
- Modify: `apps/pc-companion/test/local-sync-server.test.ts` or add focused mapper assertions in the closest existing test.

**Interfaces:**
- Produces: `AssetSummary.gameVersion?: string`
- Produces: `AssetSummary.gameVersionSource?: 'explicit' | 'inferred' | 'unknown'`

- [ ] **Step 1: Write failing protocol/mapper assertions**

Assert that a row whose canonical metadata contains `identity.gameVersion: '2.9'` maps a summary with `gameVersion: '2.9'` and `gameVersionSource: 'explicit'`, while metadata without a usable version emits no `gameVersion` and uses `unknown` only where explicitly represented.

- [ ] **Step 2: Run focused Node tests**

Run the closest protocol and PC server tests. Expected before implementation: assertions fail because fields do not exist.

- [ ] **Step 3: Extend `AssetSummary` and mapper minimally**

Parse `row.metadata_json` defensively in `mapAssetSummary`; read only public-safe `identity.gameVersion`, trim it, and emit the optional fields. Malformed metadata must not break gallery listing.

- [ ] **Step 4: Re-run focused tests**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(protocol): expose game version in asset summaries`

### Task 2: Android model/JSON contract

**Files:**
- Modify: `apps/mobile/app/src/main/java/app/nikkisync/mobile/model/Models.java`
- Modify: `apps/mobile/app/src/main/java/app/nikkisync/mobile/protocol/JsonCodec.java`
- Modify: `apps/mobile/scripts/validate-m2.mjs`

**Interfaces:**
- Consumes: protocol `gameVersion`, `gameVersionSource`
- Produces: `AssetSummary.gameVersion()` and `AssetSummary.gameVersionSource()`

- [ ] **Step 1: Add mobile source-contract checks**

Require `Models.AssetSummary` and `JsonCodec.assetPage` to retain both optional fields.

- [ ] **Step 2: Run `npm run mobile:validate`**

Expected before implementation: FAIL on missing version fields.

- [ ] **Step 3: Extend model and parser**

Add nullable string members/getters and parse them with the existing `optionalString` helper. Preserve constructor call sites by updating the sole JSON construction path.

- [ ] **Step 4: Re-run mobile validation**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(mobile): retain gallery game version summaries`

### Task 3: Version grouping presentation model

**Files:**
- Create: `apps/mobile/app/src/main/java/app/nikkisync/mobile/ui/GalleryVersionGroups.java`
- Modify: `apps/mobile/scripts/validate-m2.mjs`

**Interfaces:**
- Consumes: `List<AssetSummary>`
- Produces: ordered `List<Group>` where `Group` exposes `versionLabel`, `version`, `inferred`, and `items`.

- [ ] **Step 1: Add static contract expectations for the grouping class**

Require explicit unknown handling and semantic-version comparison helpers.

- [ ] **Step 2: Implement deterministic grouping**

Rules: normalized non-empty version -> that group; otherwise `版本未知`; numeric dot-separated comparison descending; capture time descending; asset ID fallback; inferred flag true only when any item in the section is marked `inferred`.

- [ ] **Step 3: Re-run mobile validation**

Expected: PASS.

- [ ] **Step 4: Commit**

Commit message: `feat(mobile): group gallery assets by game version`

### Task 4: Three-tab shell and sectioned 图库 UI

**Files:**
- Modify: `apps/mobile/app/src/main/java/app/nikkisync/mobile/MainActivity.java`
- Modify: `apps/mobile/app/src/main/java/app/nikkisync/mobile/ui/GalleryAdapter.java`
- Modify: `apps/mobile/scripts/validate-m2.mjs`

**Interfaces:**
- Consumes: `GalleryVersionGroups.group(List<AssetSummary>)`
- Produces: visible bottom navigation with `图库`, `已保存`, `我的` and sectioned gallery presentation.

- [ ] **Step 1: Add source-contract checks**

Require the three exact tab labels, 图库 default state, explicit version-group header rendering, and placeholder copy for deferred tabs.

- [ ] **Step 2: Replace the single flat gallery body with a tab content container**

Keep the existing header/status and selection behavior for 图库. Bottom navigation remains visible outside selection-specific overlays.

- [ ] **Step 3: Render 图库 as version sections**

Use existing thumbnail cells and interactions. Do not duplicate image loading logic. Each section shows `<version> 版本`, item count, and `自动推测` when applicable; unknown header is `版本未知`.

- [ ] **Step 4: Add 已保存 and 我的 placeholders**

已保存 copy states that saved-photo library and edited-output relinking are reserved for a later milestone. 我的 copy states that UID/photo summary and clothing/outfit search are reserved for later. Do not fabricate counts or UID.

- [ ] **Step 5: Preserve interactions**

Thumbnail tap opens current viewer; long press/tap selection still selects the same `AssetSummary`; save uses current adapter selection; current rotation map remains intact.

- [ ] **Step 6: Re-run `npm run mobile:validate`**

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat(mobile): add three-tab version-grouped gallery shell`

### Task 5: Regression verification and handoff

**Files:**
- Modify if necessary: `docs/M2_3_MOBILE_GALLERY_UI_REQUIREMENTS.md`
- Create or update: `docs/M2_3_1_IMPLEMENTATION_STATUS.md`

**Interfaces:**
- Produces: exact build/test handoff for local Codex execution.

- [ ] **Step 1: Run available automated verification**

Required locally in Codex/Work execution environment:

```powershell
npm run typecheck
npm test
npm run mobile:validate
npm run mobile:build
```

Do not claim these pass from a GitHub-only session.

- [ ] **Step 2: Manual Android acceptance**

Check: three bottom tabs switch; 图库 version sections sort correctly; unknown photos isolate; viewer opens; selection/save still works; rotation still appears on ordinary photos; metadata/outfit details still load.

- [ ] **Step 3: Record evidence**

Document commit SHA, command results, APK path and any remaining real-device gaps.

- [ ] **Step 4: Commit**

Commit message: `docs(mobile): record M2.3.1 verification status`
