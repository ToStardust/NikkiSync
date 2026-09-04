package app.nikkisync.mobile.ui;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import app.nikkisync.mobile.model.Models.AssetSummary;

import org.junit.Test;

import java.util.List;

public final class ViewerSessionTest {
    @Test public void sessionKeepsNavigationInsideSelectedVersionGroup() {
        ViewerSession session = ViewerSession.fromGallery(List.of(
                asset("v210-a", "2.10", "2026-09-03T10:00:00.000Z"),
                asset("v29-a", "2.9", "2026-08-20T10:00:00.000Z"),
                asset("v29-b", "2.9", "2026-08-19T10:00:00.000Z"),
                asset("unknown", null, "2026-09-04T10:00:00.000Z")
        ), "v29-a");

        assertEquals(List.of("v29-a", "v29-b"), session.items().stream().map(AssetSummary::assetId).toList());
        assertEquals("v29-a", session.current().assetId());
        assertFalse(session.hasPrevious());
        assertTrue(session.hasNext());

        assertTrue(session.moveNext());
        assertEquals("v29-b", session.current().assetId());
        assertTrue(session.hasPrevious());
        assertFalse(session.hasNext());
        assertFalse(session.moveNext());
    }

    @Test public void unknownVersionAssetsShareTheirOwnViewerContext() {
        ViewerSession session = ViewerSession.fromGallery(List.of(
                asset("known", "2.9", "2026-08-20T10:00:00.000Z"),
                asset("unknown-new", null, "2026-09-04T10:00:00.000Z"),
                asset("unknown-old", null, "2026-09-01T10:00:00.000Z")
        ), "unknown-old");

        assertEquals(List.of("unknown-new", "unknown-old"), session.items().stream().map(AssetSummary::assetId).toList());
        assertEquals("unknown-old", session.current().assetId());
        assertTrue(session.movePrevious());
        assertEquals("unknown-new", session.current().assetId());
    }

    private static AssetSummary asset(String id, String version, String capturedAt) {
        return new AssetSummary(
                id, "photo", "ready", capturedAt, null, 1,
                100, 100, false, true,
                version, version == null ? "unknown" : "explicit", null, null
        );
    }
}
