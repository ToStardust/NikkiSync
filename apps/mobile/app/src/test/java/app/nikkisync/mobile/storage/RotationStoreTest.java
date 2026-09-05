package app.nikkisync.mobile.storage;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.HashMap;
import java.util.Map;

public final class RotationStoreTest {
    @Test public void defaultsToOriginalAndPersistsByAssetId() {
        FakeBackend backend = new FakeBackend();
        RotationStore store = new RotationStore(backend);

        assertEquals(0, store.get("asset-a"));
        store.set("asset-a", 90);

        assertEquals(90, store.get("asset-a"));
        assertEquals(0, store.get("asset-b"));
        assertEquals(90, new RotationStore(backend).get("asset-a"));
    }

    @Test public void restoringOriginalRemovesStoredOverride() {
        FakeBackend backend = new FakeBackend();
        RotationStore store = new RotationStore(backend);
        store.set("asset-a", 180);
        assertTrue(backend.values.containsKey("asset-a"));

        store.set("asset-a", 0);

        assertEquals(0, store.get("asset-a"));
        assertFalse(backend.values.containsKey("asset-a"));
    }

    @Test public void rejectsInvalidWritesAndSanitizesCorruptReads() {
        FakeBackend backend = new FakeBackend();
        RotationStore store = new RotationStore(backend);

        assertThrows(IllegalArgumentException.class, () -> store.set("asset-a", 45));
        backend.values.put("asset-b", 13);
        assertEquals(0, store.get("asset-b"));
    }

    private static final class FakeBackend implements RotationStore.Backend {
        final Map<String, Integer> values = new HashMap<>();

        @Override public int getInt(String key, int fallback) { return values.getOrDefault(key, fallback); }
        @Override public void putInt(String key, int value) { values.put(key, value); }
        @Override public void remove(String key) { values.remove(key); }
    }
}
