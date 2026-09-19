# Saved Photo Groups / Edited Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let NikkiSync users manually attach multiple retouched system-gallery images to an existing Saved original, show every version together under one source asset, and preserve source photo parameters for offline Saved-detail viewing.

**Architecture:** Preserve `SavedPhotoStore` as the authoritative original-export history. Add an independent SQLite-backed edited-variant store and metadata-snapshot store, then project originals + variants into pure `SavedPhotoGroups` rows for the existing Saved RecyclerView. `MainActivity` only owns picker/navigation orchestration; storage, grouping, metadata formatting, duplicate/conflict rules, and URI health stay in focused classes.

**Tech Stack:** Android Java 17, Android 13+ / compileSdk 35, AndroidX Activity 1.13.0, RecyclerView 1.4.0, SQLiteOpenHelper, Android Photo Picker via `PickMultipleVisualMedia`, JUnit 4, Robolectric 4.17 for local persistence/ContentResolver tests.

**Spec:** `docs/superpowers/specs/2026-09-19-saved-photo-edited-variants-design.md`

## Global Constraints

- Work only on `feature/m4-2-8-clothing-detail`; never modify `main`.
- Infinity Nikki source media remains read-only.
- Do not inject game metadata into edited JPEG/HEIC files.
- Do not upload edited media to the PC just to create the association.
- Do not add automatic image matching in this milestone.
- Do not request broad media-library permission for manual association.
- Keep existing Saved history, recovery, filters, health checking, source navigation, original export, rotation and vendor LIVE export behavior.
- An edited URI may belong to only one source asset at a time.
- Duplicate linking to the same asset is idempotent and must preserve the first `linkedAt`.
- Unlinking removes only NikkiSync's association and must never delete the system-gallery item.
- If the source PC or source asset is unavailable, previously captured metadata snapshots remain readable.
- Use AndroidX stable `androidx.activity:activity:1.13.0`; do not use 1.14 alpha.
- All production behavior follows RED → GREEN → regression; do not skip the failing-test run.

## Review Focus

1. **Same URI selected twice or selected for a second source** — same-source relink must be a no-op; cross-source link must be rejected without moving the existing association.
2. **Original MediaStore item disappears while edited variants remain** — the group and metadata snapshot must remain visible and usable.
3. **PC goes offline after metadata was cached** — edited detail must render the last snapshot and not replace it with an error/empty snapshot.
4. **Multiple original Saved records exist for one asset** — keep every original before every edited variant; never collapse historical re-saves.
5. **Picker/provider grants are partial or later revoked** — retain the association with visible inaccessible health; never auto-delete user records.

---

### Task 1: Edited-variant persistence and conflict semantics

**Files:**
- Create: `apps/mobile/app/src/main/java/app/nikkisync/mobile/storage/EditedVariantStore.java`
- Create: `apps/mobile/app/src/test/java/app/nikkisync/mobile/storage/EditedVariantStoreTest.java`
- Modify: `apps/mobile/app/build.gradle.kts`

**Interfaces:**
- Produces:
  - `EditedVariantStore.Variant(String variantId, String assetId, String uri, long linkedAt, String displayName, String mimeType, String sourceSavedUri)`
  - `EditedVariantStore.LinkStatus { ADDED, DUPLICATE, CONFLICT }`
  - `EditedVariantStore.LinkResult(LinkStatus status, Variant variant, String conflictingAssetId)`
  - `LinkResult link(String assetId, String sourceSavedUri, String uri, long linkedAt, String displayName, String mimeType)`
  - `List<Variant> loadAll()`
  - `List<Variant> loadForAsset(String assetId)`
  - `Variant findByUri(String uri)`
  - `boolean unlink(String variantId)`

- [ ] **Step 1: Add Robolectric as a test-only dependency**

Edit `apps/mobile/app/build.gradle.kts`:

```kotlin
dependencies {
    implementation("androidx.recyclerview:recyclerview:1.4.0")
    implementation("com.google.zxing:core:3.5.3")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.robolectric:robolectric:4.17")
}
```

- [ ] **Step 2: Write failing persistence/conflict tests**

Create `EditedVariantStoreTest.java`:

```java
package app.nikkisync.mobile.storage;

import static org.junit.Assert.*;

import android.content.Context;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;

@RunWith(RobolectricTestRunner.class)
public final class EditedVariantStoreTest {
    private Context context;
    private EditedVariantStore store;

    @Before public void setUp() {
        context = RuntimeEnvironment.getApplication();
        context.deleteDatabase("nikkisync-edited-variants.db");
        store = new EditedVariantStore(context);
    }

    @Test public void oneAssetKeepsMultipleEditedVariantsInLinkOrder() {
        assertEquals(EditedVariantStore.LinkStatus.ADDED,
                store.link("asset-a", "content://original/a", "content://edit/1", 1000L, "one.jpg", "image/jpeg").status());
        assertEquals(EditedVariantStore.LinkStatus.ADDED,
                store.link("asset-a", "content://original/a", "content://edit/2", 2000L, "two.heic", "image/heic").status());

        var rows = store.loadForAsset("asset-a");
        assertEquals(2, rows.size());
        assertEquals("content://edit/2", rows.get(0).uri());
        assertEquals("content://edit/1", rows.get(1).uri());
    }

    @Test public void sameUriSameAssetIsIdempotentAndKeepsFirstLinkedAt() {
        store.link("asset-a", "content://original/a", "content://edit/1", 1000L, "one.jpg", "image/jpeg");
        var result = store.link("asset-a", "content://original/a", "content://edit/1", 9000L, "renamed.jpg", "image/jpeg");

        assertEquals(EditedVariantStore.LinkStatus.DUPLICATE, result.status());
        assertEquals(1000L, result.variant().linkedAt());
        assertEquals(1, store.loadForAsset("asset-a").size());
    }

    @Test public void sameUriCannotSilentlyMoveToAnotherAsset() {
        store.link("asset-a", "content://original/a", "content://edit/shared", 1000L, null, "image/jpeg");
        var result = store.link("asset-b", "content://original/b", "content://edit/shared", 2000L, null, "image/jpeg");

        assertEquals(EditedVariantStore.LinkStatus.CONFLICT, result.status());
        assertEquals("asset-a", result.conflictingAssetId());
        assertTrue(store.loadForAsset("asset-b").isEmpty());
    }

    @Test public void unlinkRemovesOnlyRequestedAssociation() {
        var one = store.link("asset-a", "content://original/a", "content://edit/1", 1000L, null, "image/jpeg").variant();
        store.link("asset-a", "content://original/a", "content://edit/2", 2000L, null, "image/jpeg");

        assertTrue(store.unlink(one.variantId()));
        assertNull(store.findByUri("content://edit/1"));
        assertNotNull(store.findByUri("content://edit/2"));
    }
}
```

- [ ] **Step 3: Run RED**

Run:

```powershell
cd apps/mobile
./gradlew testDebugUnitTest --tests app.nikkisync.mobile.storage.EditedVariantStoreTest
```

Expected: compilation/test failure because `EditedVariantStore` does not exist.

- [ ] **Step 4: Implement SQLite store**

Create `EditedVariantStore.java` using database name `nikkisync-edited-variants.db`, schema version 1 and this table:

```java
db.execSQL("""
    CREATE TABLE edited_variants (
      variant_id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      uri TEXT NOT NULL UNIQUE,
      linked_at INTEGER NOT NULL,
      display_name TEXT,
      mime_type TEXT,
      source_saved_uri TEXT
    )
    """);
db.execSQL("CREATE INDEX edited_variants_asset_time ON edited_variants(asset_id, linked_at DESC)");
```

Generate `variantId` with `UUID.randomUUID().toString()`. In `link(...)`, query by `uri` first:

```java
Variant existing = findByUri(uri);
if (existing != null) {
    if (existing.assetId().equals(assetId)) {
        return new LinkResult(LinkStatus.DUPLICATE, existing, null);
    }
    return new LinkResult(LinkStatus.CONFLICT, existing, existing.assetId());
}
```

Insert only for `ADDED`. `loadForAsset` orders `linked_at DESC, variant_id ASC`. `unlink` deletes by `variant_id` only; it must not invoke `ContentResolver.delete`.

- [ ] **Step 5: Run GREEN**

Run the same focused Gradle test. Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/mobile/app/build.gradle.kts apps/mobile/app/src/main/java/app/nikkisync/mobile/storage/EditedVariantStore.java apps/mobile/app/src/test/java/app/nikkisync/mobile/storage/EditedVariantStoreTest.java
git commit -m "feat(saved): persist edited photo variants"
```

---

### Task 2: Offline canonical metadata snapshots and reusable formatting

**Files:**
- Create: `apps/mobile/app/src/main/java/app/nikkisync/mobile/storage/SavedMetadataSnapshotStore.java`
- Create: `apps/mobile/app/src/main/java/app/nikkisync/mobile/ui/SavedMetadataText.java`
- Create: `apps/mobile/app/src/test/java/app/nikkisync/mobile/storage/SavedMetadataSnapshotStoreTest.java`
- Create: `apps/mobile/app/src/test/java/app/nikkisync/mobile/ui/SavedMetadataTextTest.java`
- Modify: `apps/mobile/app/src/main/java/app/nikkisync/mobile/MainActivity.java`

**Interfaces:**
- Produces:
  - `SavedMetadataSnapshotStore.Snapshot(String assetId, String metadataJson, String capturedAt, String gameVersion, long updatedAt)`
  - `void put(Snapshot snapshot)`
  - `Snapshot get(String assetId)`
  - `String SavedMetadataText.summary(String metadataJson)`
  - `List<String> SavedMetadataText.clothingLines(String metadataJson)`

- [ ] **Step 1: Write failing snapshot persistence tests**

Use Robolectric with DB name `nikkisync-saved-metadata.db`:

```java
@Test public void snapshotRoundTripsCanonicalMetadata() {
    var store = new SavedMetadataSnapshotStore(context);
    var input = new SavedMetadataSnapshotStore.Snapshot(
            "asset-a",
            "{"camera":{"focalLength":50},"filter":{"id":"F01"}}",
            "2026-09-19T10:00:00Z",
            "2.9",
            1000L);
    store.put(input);

    var restored = store.get("asset-a");
    assertNotNull(restored);
    assertEquals(input.metadataJson(), restored.metadataJson());
    assertEquals("2.9", restored.gameVersion());
}

@Test public void missingOrFailedRefreshDoesNotEraseLastSnapshot() {
    var store = new SavedMetadataSnapshotStore(context);
    store.put(new SavedMetadataSnapshotStore.Snapshot("asset-a", "{"camera":{"focalLength":50}}", null, "2.9", 1000L));
    // No put is performed when an online refresh fails.
    assertEquals("{"camera":{"focalLength":50}}", store.get("asset-a").metadataJson());
}
```

- [ ] **Step 2: Write failing pure metadata-format tests**

Create `SavedMetadataTextTest.java`:

```java
@Test public void summaryShowsCameraFilterLightingAndClothingCount() {
    String json = """
        {
          "camera":{"focalLength":50,"exposure":1.2},
          "filter":{"id":"filter-a","strength":80},
          "lighting":{"id":"light-b","strength":40},
          "dressing":{"clothes":[
            {"id":"10201","name":"裙子","category":"dresses"},
            {"id":"10202","name":"鞋子","category":"shoes"}
          ]}
        }
        """;
    String text = SavedMetadataText.summary(json);
    assertTrue(text.contains("焦距：50"));
    assertTrue(text.contains("滤镜：filter-a"));
    assertTrue(text.contains("光照：light-b"));
    assertTrue(text.contains("穿搭：2 件"));
}

@Test public void clothingLinesKeepHumanReadableNamesOffline() {
    String json = "{"dressing":{"clothes":[{"id":"10201","name":"裙子","category":"dresses"}]}}";
    assertEquals(List.of("裙子 · 连衣裙 · ID 10201"), SavedMetadataText.clothingLines(json));
}
```

- [ ] **Step 3: Run RED**

```powershell
cd apps/mobile
./gradlew testDebugUnitTest --tests app.nikkisync.mobile.storage.SavedMetadataSnapshotStoreTest --tests app.nikkisync.mobile.ui.SavedMetadataTextTest
```

Expected: both missing classes fail compilation.

- [ ] **Step 4: Implement snapshot store**

Create SQLite table:

```java
db.execSQL("""
    CREATE TABLE snapshots (
      asset_id TEXT PRIMARY KEY,
      metadata_json TEXT NOT NULL,
      captured_at TEXT,
      game_version TEXT,
      updated_at INTEGER NOT NULL
    )
    """);
```

`put` uses `CONFLICT_REPLACE`. Reject blank `assetId` and blank `metadataJson`; a caller with a failed online request does not call `put`, so the old row survives.

- [ ] **Step 5: Extract metadata text formatting**

Move the current metadata-summary parsing logic from `MainActivity.metadataSummary(AssetDetail)` into `SavedMetadataText.summary(String)`. Keep the existing UI wrapper:

```java
private String metadataSummary(AssetDetail detail) {
    return SavedMetadataText.summary(detail == null ? null : detail.metadataJson());
}
```

`clothingLines` parses `dressing.clothes`, skips missing IDs, uses the existing category Chinese labels, and emits deterministic strings such as `裙子 · 连衣裙 · ID 10201`.

- [ ] **Step 6: Run GREEN and full existing Android unit tests**

```powershell
cd apps/mobile
./gradlew testDebugUnitTest
```

Expected: new snapshot/formatter tests and existing tests pass.

- [ ] **Step 7: Commit**

```powershell
git add apps/mobile/app/src/main/java/app/nikkisync/mobile/storage/SavedMetadataSnapshotStore.java apps/mobile/app/src/main/java/app/nikkisync/mobile/ui/SavedMetadataText.java apps/mobile/app/src/test/java/app/nikkisync/mobile/storage/SavedMetadataSnapshotStoreTest.java apps/mobile/app/src/test/java/app/nikkisync/mobile/ui/SavedMetadataTextTest.java apps/mobile/app/src/main/java/app/nikkisync/mobile/MainActivity.java
git commit -m "feat(saved): cache source metadata for offline details"
```

---

### Task 3: Pure Saved-group projection

**Files:**
- Create: `apps/mobile/app/src/main/java/app/nikkisync/mobile/storage/SavedPhotoGroups.java`
- Create: `apps/mobile/app/src/test/java/app/nikkisync/mobile/storage/SavedPhotoGroupsTest.java`
- Preserve: `apps/mobile/app/src/main/java/app/nikkisync/mobile/storage/SavedPhotoCollection.java`

**Interfaces:**
- Consumes: `SavedPhotoStore.Record`, `EditedVariantStore.Variant`, existing `SavedViewState` filter/sort constants.
- Produces:
  - `SavedPhotoGroups.MemberKind { ORIGINAL, EDITED }`
  - `SavedPhotoGroups.Member`
  - `SavedPhotoGroups.Group(String assetId, List<Member> members, long activityAt, boolean hasMotion, String capturedAt, String gameVersion)`
  - `List<Group> select(List<SavedPhotoStore.Record> originals, List<EditedVariantStore.Variant> variants, int filter, int sortMode)`

- [ ] **Step 1: Write failing grouping tests**

Include these exact cases:

```java
@Test public void sameAssetIsOneContiguousGroupWithOriginalsBeforeEdits() {
    var originals = List.of(
        original("asset-a", "content://original/new", 3000L, true),
        original("asset-a", "content://original/old", 1000L, true));
    var edits = List.of(
        edit("e1", "asset-a", "content://edit/1", 5000L),
        edit("e2", "asset-a", "content://edit/2", 4000L));

    var groups = SavedPhotoGroups.select(originals, edits, SavedViewState.FILTER_ALL, SavedViewState.SORT_SAVED);
    assertEquals(1, groups.size());
    assertEquals(List.of(
        SavedPhotoGroups.MemberKind.ORIGINAL,
        SavedPhotoGroups.MemberKind.ORIGINAL,
        SavedPhotoGroups.MemberKind.EDITED,
        SavedPhotoGroups.MemberKind.EDITED
    ), groups.get(0).members().stream().map(SavedPhotoGroups.Member::kind).toList());
}

@Test public void newlyLinkedEditMovesGroupToTopForRecentActivity() {
    // asset-a original saved earlier but edit linked at 9000; asset-b saved at 8000.
    assertEquals("asset-a", groups.get(0).assetId());
}

@Test public void liveFilterUsesSourceOriginalTypeNotEditedMimeType() {
    // edited JPEG linked to LIVE source stays in FILTER_MOTION group.
}

@Test public void groupSurvivesMissingOriginalWhenVariantExists() {
    // Variant remains projected even when originals list does not contain the asset.
}

@Test public void captureSortUsesSourceCaptureTimeAndKeepsGroupMembersTogether() {
    // Group order follows capturedAt; members never interleave across assets.
}
```

- [ ] **Step 2: Run RED**

```powershell
cd apps/mobile
./gradlew testDebugUnitTest --tests app.nikkisync.mobile.storage.SavedPhotoGroupsTest
```

Expected: missing `SavedPhotoGroups`.

- [ ] **Step 3: Implement projection**

Build a `LinkedHashMap<String, MutableGroup>` from originals first, then attach variants by `assetId`.

Member ordering:

```java
originals.sort(Comparator.comparingLong(SavedPhotoStore.Record::savedAt).reversed());
edited.sort(Comparator.comparingLong(EditedVariantStore.Variant::linkedAt).reversed()
        .thenComparing(EditedVariantStore.Variant::variantId));
members.addAll(originalMembers);
members.addAll(editedMembers);
```

`activityAt = max(latest original.savedAt, latest variant.linkedAt)`.

For variant-only groups, preserve `assetId`; source type/version/capture metadata may be absent unless derivable from another persisted group/snapshot. Do not discard the group.

- [ ] **Step 4: Run GREEN**

Run focused test, then `./gradlew testDebugUnitTest`.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/app/src/main/java/app/nikkisync/mobile/storage/SavedPhotoGroups.java apps/mobile/app/src/test/java/app/nikkisync/mobile/storage/SavedPhotoGroupsTest.java
git commit -m "feat(saved): group originals and edited variants"
```

---

### Task 4: System Photo Picker and URI access orchestration

**Files:**
- Modify: `apps/mobile/app/build.gradle.kts`
- Modify: `apps/mobile/app/src/main/java/app/nikkisync/mobile/MainActivity.java`
- Create: `apps/mobile/app/src/main/java/app/nikkisync/mobile/storage/EditedMediaAccess.java`
- Create: `apps/mobile/app/src/test/java/app/nikkisync/mobile/storage/EditedMediaAccessTest.java`
- Modify: `apps/mobile/scripts/validate-m2.mjs`

**Interfaces:**
- Add AndroidX Activity stable dependency `androidx.activity:activity:1.13.0`.
- `MainActivity extends ComponentActivity`.
- `ActivityResultLauncher<PickVisualMediaRequest> editedPhotoPicker`.
- `SavedPhotoStore.Record pendingEditedLinkSource`.
- `EditedMediaAccess.Info(String uri, String displayName, String mimeType, boolean persistGranted)`.
- `EditedMediaAccess.describeAndPersist(Context, Uri)`.

- [ ] **Step 1: Write RED static validation for picker contract**

Extend `validate-m2.mjs` with:

```javascript
expect(mobileGradle.includes('androidx.activity:activity:1.13.0'), 'edited-photo linking needs stable AndroidX Activity Photo Picker support')
expect(mainActivity.includes('PickMultipleVisualMedia'), 'Saved edited variants must use the system multi-photo picker')
expect(mainActivity.includes('PickVisualMedia.ImageOnly'), 'edited-variant picker must accept images only')
expect(mainActivity.includes('takePersistableUriPermission') || editedMediaAccess.includes('takePersistableUriPermission'),
  'selected edit URIs must request persistent read access')
expect(!manifest.includes('READ_MEDIA_IMAGES'), 'manual edit linking must not request broad gallery read permission')
```

- [ ] **Step 2: Write focused Robolectric test for URI metadata and grant failure**

Use a small fake/shadow provider or Robolectric ContentResolver registration to verify:
- display name and MIME type are returned when query succeeds;
- a `SecurityException` from `takePersistableUriPermission` yields `persistGranted=false` but still returns an `Info` record;
- no delete operation is invoked.

- [ ] **Step 3: Run RED**

```powershell
npm run mobile:validate
cd apps/mobile
./gradlew testDebugUnitTest --tests app.nikkisync.mobile.storage.EditedMediaAccessTest
```

Expected: validator fails for missing picker wiring and test fails for missing helper.

- [ ] **Step 4: Add stable AndroidX Activity dependency**

Add:

```kotlin
implementation("androidx.activity:activity:1.13.0")
```

Keep `compileSdk = 35`, `minSdk = 33`, Java 17 unchanged.

- [ ] **Step 5: Migrate Activity base class and register picker**

Change:

```java
public final class MainActivity extends ComponentActivity implements NsdDiscovery.Listener
```

Register:

```java
private final ActivityResultLauncher<PickVisualMediaRequest> editedPhotoPicker =
        registerForActivityResult(new ActivityResultContracts.PickMultipleVisualMedia(), this::handleEditedPhotoSelection);
```

Launch only after setting `pendingEditedLinkSource`:

```java
editedPhotoPicker.launch(new PickVisualMediaRequest.Builder()
        .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE)
        .build());
```

If callback list is empty, clear `pendingEditedLinkSource` and make no store changes.

- [ ] **Step 6: Implement `EditedMediaAccess`**

For each selected URI:
1. Attempt `takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)`.
2. Query `OpenableColumns.DISPLAY_NAME`.
3. Read `ContentResolver.getType(uri)`.
4. Return usable `Info` even when persistable grant fails.
5. Never copy, rewrite or delete media.

- [ ] **Step 7: Run GREEN**

```powershell
npm run mobile:validate
cd apps/mobile
./gradlew testDebugUnitTest
```

- [ ] **Step 8: Commit**

```powershell
git add apps/mobile/app/build.gradle.kts apps/mobile/app/src/main/java/app/nikkisync/mobile/MainActivity.java apps/mobile/app/src/main/java/app/nikkisync/mobile/storage/EditedMediaAccess.java apps/mobile/app/src/test/java/app/nikkisync/mobile/storage/EditedMediaAccessTest.java apps/mobile/scripts/validate-m2.mjs
git commit -m "feat(saved): add manual edited-photo picker"
```

---

### Task 5: Render originals and edits together in the Saved grid

**Files:**
- Modify: `apps/mobile/app/src/main/java/app/nikkisync/mobile/ui/SavedPhotoAdapter.java`
- Modify: `apps/mobile/app/src/main/java/app/nikkisync/mobile/MainActivity.java`
- Modify: `apps/mobile/scripts/validate-m2.mjs`

**Interfaces:**
- `SavedPhotoAdapter.setGroups(List<SavedPhotoGroups.Group>)`
- `boolean SavedPhotoAdapter.isHeader(int position)`
- Listener methods:
  - `void onOriginalClick(SavedPhotoStore.Record record)`
  - `void onEditedClick(EditedVariantStore.Variant variant)`

- [ ] **Step 1: Add RED validator expectations**

Require:
- `SavedPhotoAdapter` has `TYPE_HEADER` and `TYPE_MEDIA`;
- it renders the literal badge `"修图"`;
- it consumes `SavedPhotoGroups.Group`;
- `MainActivity` uses span size `savedAdapter.isHeader(position) ? 3 : 1`;
- `refreshSavedPhotos()` loads both original records and edited variants and calls `SavedPhotoGroups.select`.

Run `npm run mobile:validate`; expected failure.

- [ ] **Step 2: Update adapter row model**

Use rows:

```java
private static final int TYPE_HEADER = 0;
private static final int TYPE_MEDIA = 1;

private static final class Row {
    final SavedPhotoGroups.Group groupHeader;
    final SavedPhotoGroups.Member member;
}
```

Header copy:

```text
9月19日 · 2.9版本 · 4张
```

If version is absent, omit it rather than inventing one.

Original cells keep existing LIVE/rotation badge behavior. Edited cells use `修图` and load thumbnail from `Uri.parse(variant.uri())`.

- [ ] **Step 3: Wire grouped refresh**

Initialize `EditedVariantStore` in `onCreate`.

In `refreshSavedPhotos()`:

```java
List<SavedPhotoStore.Record> originals = savedPhotoStore.load();
List<EditedVariantStore.Variant> edits = editedVariantStore.loadAll();
List<SavedPhotoGroups.Group> groups =
        SavedPhotoGroups.select(originals, edits, savedFilter, savedSort);
savedAdapter.setGroups(groups);
```

Set a `GridLayoutManager.SpanSizeLookup` for full-width group headers.

- [ ] **Step 4: Extend health refresh without destructive cleanup**

Add `SavedPhotoVerifier.verifyUris(Context, SavedPhotoHealthStore, List<String>)` and make existing `verify(...records)` delegate to it.

Feed original record URIs plus edited variant URIs into health verification. An inaccessible edited URI produces `MISSING`; it is not removed from `EditedVariantStore`.

- [ ] **Step 5: Run validator + Android tests**

```powershell
npm run mobile:validate
cd apps/mobile
./gradlew testDebugUnitTest
```

- [ ] **Step 6: Commit**

```powershell
git add apps/mobile/app/src/main/java/app/nikkisync/mobile/ui/SavedPhotoAdapter.java apps/mobile/app/src/main/java/app/nikkisync/mobile/MainActivity.java apps/mobile/app/src/main/java/app/nikkisync/mobile/storage/SavedPhotoVerifier.java apps/mobile/scripts/validate-m2.mjs
git commit -m "feat(saved): display edited variants with originals"
```

---

### Task 6: Link action, edited detail, unlink, and metadata snapshot refresh

**Files:**
- Modify: `apps/mobile/app/src/main/java/app/nikkisync/mobile/MainActivity.java`
- Modify: `apps/mobile/scripts/validate-m2.mjs`
- Test: existing/new storage and group tests from Tasks 1–3.

**Interfaces:**
- `void startEditedPhotoLink(SavedPhotoStore.Record original)`
- `void handleEditedPhotoSelection(List<Uri> uris)`
- `void showEditedPhotoDetails(EditedVariantStore.Variant variant)`
- `void refreshMetadataSnapshot(String assetId, String capturedAt, String gameVersion)`

- [ ] **Step 1: Add RED validator assertions for user-visible actions and destructive-safety boundary**

```javascript
expect(mainActivity.includes('"关联修图"'), 'Saved original detail needs edited-photo linking action')
expect(mainActivity.includes('"解除关联"'), 'edited variant detail needs unlink action')
expect(mainActivity.includes('"查看原始保存图"'), 'edited variant must link back to an original Saved item')
expect(mainActivity.includes('SavedMetadataSnapshotStore'), 'Saved details need offline metadata snapshots')
expect(!mainActivity.includes('getContentResolver().delete('), 'unlinking an edit must never delete system-gallery media')
```

Run `npm run mobile:validate`; expected failure.

- [ ] **Step 2: Add “关联修图” to original Saved detail**

In `showSavedPhotoDetails(record)`, add:

```java
Button linkEdit = button("关联修图");
linkEdit.setOnClickListener(v -> {
    dialog.dismiss();
    startEditedPhotoLink(record);
});
info.addView(linkEdit, sourceLp);
```

Do not expose this action from an edited-variant detail as if it were another source.

- [ ] **Step 3: Process selected URIs**

`handleEditedPhotoSelection`:
- reads and clears `pendingEditedLinkSource`;
- returns immediately for null source or empty list;
- for each URI, calls `EditedMediaAccess.describeAndPersist`;
- calls `editedVariantStore.link(source.assetId(), source.uri(), info.uri(), System.currentTimeMillis(), info.displayName(), info.mimeType())`;
- counts ADDED / DUPLICATE / CONFLICT;
- refreshes Saved UI;
- shows concise result text;
- never auto-reassigns CONFLICT items.

- [ ] **Step 4: Capture metadata snapshot on original save**

After each successful `savedPhotoStore.record(...)`, attempt:

```java
try {
    AssetDetail detail = current.asset(asset.assetId());
    if (detail.metadataJson() != null && !detail.metadataJson().isBlank()) {
        savedMetadataSnapshotStore.put(new SavedMetadataSnapshotStore.Snapshot(
                asset.assetId(),
                detail.metadataJson(),
                asset.capturedAt(),
                asset.gameVersion(),
                System.currentTimeMillis()));
    }
} catch (Exception ignored) {
    // Export success is independent of metadata-cache refresh.
}
```

Also update the snapshot whenever source detail is successfully loaded online in the source viewer or edited detail.

- [ ] **Step 5: Implement edited detail**

The edited detail:
- loads preview thumbnail from `variant.uri()`;
- shows state from `savedHealth.get(variant.uri())`;
- shows `修图版`, linked time and source Asset ID;
- loads current online `AssetDetail` if available and refreshes snapshot;
- otherwise reads `savedMetadataSnapshotStore.get(variant.assetId())`;
- renders `SavedMetadataText.summary(metadataJson)` and `clothingLines(metadataJson)`;
- provides `查看原始保存图` using the newest accessible original record for the same `assetId`;
- provides `查看源照片` only when `findAsset(assetId)` succeeds;
- provides `解除关联`.

- [ ] **Step 6: Implement unlink and URI grant release safely**

On confirmation:
1. capture `variant.uri()`;
2. call `editedVariantStore.unlink(variant.variantId())`;
3. remove health entry for that URI;
4. only if `editedVariantStore.findByUri(uri) == null` and the URI is not referenced by any original Saved record, attempt:

```java
try {
    getContentResolver().releasePersistableUriPermission(
            Uri.parse(uri),
            Intent.FLAG_GRANT_READ_URI_PERMISSION);
} catch (Exception ignored) {}
```

5. dismiss detail and refresh Saved page.

Never call `ContentResolver.delete`.

- [ ] **Step 7: Run GREEN and regression**

```powershell
npm run mobile:validate
cd apps/mobile
./gradlew testDebugUnitTest
```

- [ ] **Step 8: Commit**

```powershell
git add apps/mobile/app/src/main/java/app/nikkisync/mobile/MainActivity.java apps/mobile/scripts/validate-m2.mjs
git commit -m "feat(saved): link and inspect retouched photos"
```

---

### Task 7: Full regression, build, and acceptance evidence

**Files:**
- Modify if needed: `docs/GPT_HANDOFF_2026-09-04.md`
- Do not change production code merely to make a static validator happy; fix validator expectations when they are stale and production behavior is correct.

**Interfaces:**
- Consumes all previous tasks.
- Produces a verified branch and handoff record.

- [ ] **Step 1: Run mobile static validation**

```powershell
npm run mobile:validate
```

Expected: success.

- [ ] **Step 2: Run Node regression**

```powershell
npm test
```

Expected: all existing Node tests pass.

- [ ] **Step 3: Run Android unit tests and build APK**

From repository root on Windows:

```powershell
npm run mobile:build
```

Or directly:

```powershell
cd apps/mobile
./gradlew testDebugUnitTest assembleDebug
```

Expected: unit tests pass and `apps/mobile/app/build/outputs/apk/debug/app-debug.apk` exists.

- [ ] **Step 4: Inspect manifest/dependency diff**

Verify:
- no `READ_MEDIA_IMAGES` / broad gallery permission was added;
- AndroidX Activity is stable 1.13.0;
- no media delete permission or delete call was introduced;
- no game-source write path was introduced.

- [ ] **Step 5: Manual device acceptance**

On Android 13+:
1. Open an existing Saved original.
2. Tap **关联修图**.
3. Select at least two edited photos in the system picker.
4. Confirm both appear adjacent to the original with **修图** badges.
5. Kill and reopen NikkiSync; associations persist.
6. Turn off/close the PC; edited detail still shows the cached source metadata.
7. Reconnect PC; source navigation works.
8. Link another edited image later; it joins the same group.
9. Select an already-linked URI again; no duplicate is created.
10. Attempt linking an edit already associated to another source; app rejects it instead of silently moving it.
11. Delete an original Saved image from the system gallery; edited variants remain grouped and inspectable.
12. Tap **解除关联** on one edit; confirm the image remains in the system gallery and sibling group members remain.
13. For a LIVE source, link a flattened edited JPEG; confirm it is displayed as **修图** without pretending it is a playable Motion Photo.

- [ ] **Step 6: Update handoff with exact evidence**

Append:
- final commit SHA(s),
- exact test commands and pass counts,
- APK build result,
- physical-device acceptance status,
- any vendor-specific limitation discovered.

Do not write “device verified” without actually completing Step 5.

- [ ] **Step 7: Final commit**

```powershell
git add docs/GPT_HANDOFF_2026-09-04.md
git commit -m "docs: record edited photo linking acceptance"
```

## Self-review mapping

- Spec §§3, 5, 8, 10: Tasks 1 and 6.
- Spec §4 offline metadata: Tasks 2 and 6.
- Spec §6 direct expanded Saved groups: Tasks 3 and 5.
- Spec §7 edited detail: Task 6.
- Spec §9 URI access: Task 4 and Task 6.
- Spec §11 historical recovery remains conservative: no Task modifies `SavedPhotoRecovery`; regression in Task 7 protects it.
- Spec §12 LIVE behavior: Task 3 filter semantics + Task 7 device acceptance.
- Spec §13 edge cases: Tasks 1–4 and 6 cover conflict, duplicate, missing original, offline source, revoked URI and picker cancellation.
- Spec §16 acceptance: Task 7 enumerates the end-to-end checks.

No automatic matching, second gallery tab, source-media write, or edited-media upload is introduced by this plan.
