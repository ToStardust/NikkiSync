# M2.3.1 Game-Version Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose resolved game-version information in PC asset summaries and render the Android gallery as version-first groups without changing media transfer, pairing, or Live Photo behavior.

**Architecture:** Keep version resolution on the PC side. The protocol summary carries a normalized `gameVersion` plus a `gameVersionSource` discriminator (`explicit`, `inferred`, `unknown`); Android parses those fields and groups summaries locally with numeric semantic-version ordering. This first slice uses explicit photo metadata when present and preserves `unknown` when no PC-side inference result exists; the cached calendar refresh/resolution service remains a following bounded task so Android never guesses versions itself.

**Tech Stack:** TypeScript protocol + PC companion, Node test runner, Android Java 17, JUnit 4 JVM unit tests.

**Spec:** `docs/M2_3_MOBILE_GALLERY_UI_REQUIREMENTS.md`

## Global Constraints

- `metadata.identity.gameVersion`, when present, is authoritative.
- Android must not fetch version metadata per photo or infer game versions from network data.
- Unknown or ambiguous version data remains visibly separate rather than being force-classified.
- Semantic versions sort numerically by segments (`2.10` > `2.9`).
- Existing pairing, local-only transport, media scanning, metadata detail, and vendor-specific Live Photo saving remain unchanged.
- No game-directory write behavior is introduced.

---

### Task 1: Extend the protocol asset summary

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/protocol.test.ts`

**Interfaces:**
- Produces: `AssetSummary.gameVersion?: string`
- Produces: `AssetSummary.gameVersionSource: 'explicit' | 'inferred' | 'unknown'`

- [ ] **Step 1: Write the failing protocol test**

Add an assertion fixture that demonstrates an `AssetSummary` can carry `gameVersion: '2.9'` with `gameVersionSource: 'explicit'`, and that `gameVersionSource` is part of the compile-time contract.

- [ ] **Step 2: Run protocol tests and verify RED**

Run: `npm run build -w @nikkisync/protocol && node --test packages/protocol/dist/test/protocol.test.js`

Expected: TypeScript build/test fails because the new summary fields are not yet declared.

- [ ] **Step 3: Implement the minimal protocol fields**

Add:

```ts
export type GameVersionSource = 'explicit' | 'inferred' | 'unknown'

export interface AssetSummary {
  // existing fields
  gameVersion?: string
  gameVersionSource: GameVersionSource
}
```

- [ ] **Step 4: Re-run focused protocol tests**

Expected: PASS.

---

### Task 2: Map explicit PC metadata into summaries

**Files:**
- Modify: `apps/pc-companion/src/server/row-mappers.ts`
- Modify/Test: `apps/pc-companion/test/local-sync-server.test.ts`

**Interfaces:**
- Consumes: `AssetSummary.gameVersion` / `gameVersionSource`
- Produces: explicit metadata -> `{ gameVersion, gameVersionSource: 'explicit' }`
- Produces: missing version -> `{ gameVersionSource: 'unknown' }`

- [ ] **Step 1: Write the failing server integration assertions**

Change the existing `asset_test` fixture metadata to include:

```ts
identity: { gameVersion: '2.9' }
```

Assert `/v1/assets` returns:

```ts
{
  gameVersion: '2.9',
  gameVersionSource: 'explicit'
}
```

Add/retain a second asset without version metadata and assert its summary source is `unknown` with no `gameVersion` field.

- [ ] **Step 2: Run the local-sync-server test and verify RED**

Expected: FAIL because `mapAssetSummary()` currently does not inspect metadata.

- [ ] **Step 3: Implement the minimal mapper**

Parse `row.metadata_json` once inside `mapAssetSummary()`. If `metadata.identity.gameVersion` is a non-empty string, emit it as explicit. Otherwise emit `gameVersionSource: 'unknown'`.

Do not add calendar/network inference in this task.

- [ ] **Step 4: Run focused server tests**

Expected: PASS.

---

### Task 3: Extend Android summary parsing

**Files:**
- Modify: `apps/mobile/app/build.gradle.kts`
- Modify: `apps/mobile/app/src/main/java/app/nikkisync/mobile/model/Models.java`
- Modify: `apps/mobile/app/src/main/java/app/nikkisync/mobile/protocol/JsonCodec.java`
- Create/Test: `apps/mobile/app/src/test/java/app/nikkisync/mobile/protocol/JsonCodecTest.java`

**Interfaces:**
- Produces: `AssetSummary.gameVersion()` nullable string
- Produces: `AssetSummary.gameVersionSource()` non-null string defaulting to `unknown`

- [ ] **Step 1: Add JVM test dependencies and failing parser test**

Add:

```kotlin
testImplementation("junit:junit:4.13.2")
testImplementation("org.json:json:20240303")
```

Create a test parsing an asset page containing both an explicit `2.9` item and an unknown item; assert the fields above.

- [ ] **Step 2: Run Android JVM tests and verify RED**

Run from `apps/mobile`: `./gradlew testDebugUnitTest`

Expected: compile/test failure because the Android model does not expose these fields yet.

- [ ] **Step 3: Implement model and parser fields**

Extend the `AssetSummary` constructor/getters and parse `gameVersion` plus `gameVersionSource`, defaulting source to `unknown` for backwards compatibility with older PC responses.

- [ ] **Step 4: Re-run Android JVM tests**

Expected: PASS.

---

### Task 4: Add deterministic version grouping for Android

**Files:**
- Create: `apps/mobile/app/src/main/java/app/nikkisync/mobile/ui/GameVersionGroups.java`
- Create/Test: `apps/mobile/app/src/test/java/app/nikkisync/mobile/ui/GameVersionGroupsTest.java`

**Interfaces:**
- Produces: `GameVersionGroups.group(List<AssetSummary>) -> List<Group>`
- `Group.version()` returns nullable version; null represents the visible unknown group.
- `Group.inferred()` is true only when every versioned item in the group is inferred and none is explicit.
- `Group.items()` are capture-time newest-first.

- [ ] **Step 1: Write failing grouping tests**

Cover:

```text
2.10 sorts before 2.9
unknown group sorts last
photos inside a group sort by capturedAt newest-first
explicit + inferred items of the same version produce a non-inferred group label
inferred-only version group reports inferred=true
```

- [ ] **Step 2: Run Android JVM tests and verify RED**

Expected: FAIL because `GameVersionGroups` does not exist.

- [ ] **Step 3: Implement pure-Java grouping helper**

Keep it Android-framework-free so JVM tests remain fast. Compare numeric version segments rather than lexicographic strings.

- [ ] **Step 4: Re-run Android JVM tests**

Expected: PASS.

---

### Task 5: Render version-first sections in the existing gallery home

**Files:**
- Modify: `apps/mobile/app/src/main/java/app/nikkisync/mobile/MainActivity.java`
- Modify: `apps/mobile/app/src/main/java/app/nikkisync/mobile/ui/GalleryAdapter.java`

**Interfaces:**
- Consumes: `GameVersionGroups.group(assets)`
- Visible headers: `<version> 版本 · <count> 张`, inferred-only groups append/secondary-label `自动推测`; null version shows `版本未知`.

- [ ] **Step 1: Introduce grouped adapter rows without changing selection semantics**

Represent adapter rows as header/photo rows while retaining photo `AssetSummary` identity for click/long-press selection.

- [ ] **Step 2: Bind section headers and photo cells**

Header rows are non-selectable and visually distinct; photo rows retain LIVE and selection indicators.

- [ ] **Step 3: Update MainActivity click handling**

Ignore header rows and preserve the existing viewer/selection behavior for photo rows.

- [ ] **Step 4: Build Android app**

Run from `apps/mobile`: `./gradlew assembleDebug testDebugUnitTest`.

Expected: PASS.

---

### Task 6: Regression and handoff update

**Files:**
- Modify: `docs/GPT_HANDOFF_2026-09-04.md`

- [ ] **Step 1: Run main regression**

Run: `npm test -- --runInBand`

Expected: all tests pass (baseline was 57/57 before M2.3.1).

- [ ] **Step 2: Record Android verification honestly**

Record JVM test/build results. If no physical Android device was used, state `physical Android gallery acceptance pending`.

- [ ] **Step 3: Update handoff**

Mark only the explicit-summary + grouped-home slice complete. Keep cached version-calendar inference as the next M2.3.1 bounded task, followed by full-screen viewer and rotation.
