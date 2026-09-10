package app.nikkisync.mobile.protocol;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import app.nikkisync.mobile.model.Models.AssetPage;
import app.nikkisync.mobile.model.Models.AssetSummary;

import org.junit.Test;

public final class JsonCodecTest {
    @Test public void assetPageParsesGameVersionAndDefaultsMissingProvenanceToUnknown() throws Exception {
        String json = "{\"items\":[" +
                "{\"assetId\":\"asset_explicit\",\"type\":\"photo\",\"state\":\"ready\",\"capturedAt\":\"2026-09-01T00:00:00.000Z\",\"revision\":1,\"hasMotion\":false,\"hasMetadata\":true,\"gameVersion\":\"2.9\",\"gameVersionSource\":\"explicit\"}," +
                "{\"assetId\":\"asset_legacy\",\"type\":\"photo\",\"state\":\"ready\",\"revision\":2,\"hasMotion\":false,\"hasMetadata\":false}" +
                "],\"libraryRevision\":2}";

        AssetPage page = JsonCodec.assetPage(json);
        AssetSummary explicit = page.items().get(0);
        AssetSummary legacy = page.items().get(1);

        assertEquals("2.9", explicit.gameVersion());
        assertEquals("explicit", explicit.gameVersionSource());
        assertNull(legacy.gameVersion());
        assertEquals("unknown", legacy.gameVersionSource());
    }
}
