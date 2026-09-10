package app.nikkisync.mobile.ui;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import app.nikkisync.mobile.model.Models.AssetSummary;

import org.junit.Test;

import java.util.List;

public final class GameVersionGroupsTest {
    @Test public void versionsSortNumericallyAndUnknownComesLast() {
        List<GameVersionGroups.Group> groups = GameVersionGroups.group(List.of(
                asset("v29", "2026-08-10T10:00:00.000Z", "2.9", "explicit"),
                asset("unknown", "2026-09-01T10:00:00.000Z", null, "unknown"),
                asset("v210", "2026-09-02T10:00:00.000Z", "2.10", "explicit")
        ));

        assertEquals(3, groups.size());
        assertEquals("2.10", groups.get(0).version());
        assertEquals("2.9", groups.get(1).version());
        assertNull(groups.get(2).version());
    }

    @Test public void photosInsideVersionSortNewestFirst() {
        List<GameVersionGroups.Group> groups = GameVersionGroups.group(List.of(
                asset("older", "2026-08-10T10:00:00.000Z", "2.9", "explicit"),
                asset("newer", "2026-08-12T10:00:00.000Z", "2.9", "explicit"),
                asset("no-time", null, "2.9", "explicit")
        ));

        assertEquals(List.of("newer", "older", "no-time"), groups.get(0).items().stream().map(AssetSummary::assetId).toList());
    }

    @Test public void inferredLabelOnlyAppliesWhenWholeVersionGroupIsInferred() {
        List<GameVersionGroups.Group> mixed = GameVersionGroups.group(List.of(
                asset("explicit", "2026-08-12T10:00:00.000Z", "2.9", "explicit"),
                asset("inferred", "2026-08-11T10:00:00.000Z", "2.9", "inferred")
        ));
        List<GameVersionGroups.Group> inferredOnly = GameVersionGroups.group(List.of(
                asset("a", "2026-08-12T10:00:00.000Z", "2.8", "inferred"),
                asset("b", "2026-08-11T10:00:00.000Z", "2.8", "inferred")
        ));

        assertFalse(mixed.get(0).inferred());
        assertTrue(inferredOnly.get(0).inferred());
    }

    private static AssetSummary asset(String id, String capturedAt, String version, String source) {
        return new AssetSummary(
                id, "photo", "ready", capturedAt, null, 1,
                100, 100, false, version != null,
                version, source, null, null
        );
    }
}
