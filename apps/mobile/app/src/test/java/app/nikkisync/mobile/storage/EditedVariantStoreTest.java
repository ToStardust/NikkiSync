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
