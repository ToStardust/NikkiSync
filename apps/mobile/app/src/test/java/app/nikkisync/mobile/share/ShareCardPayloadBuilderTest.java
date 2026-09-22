package app.nikkisync.mobile.share;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class ShareCardPayloadBuilderTest {
    @Test public void buildsOrderedOutfitCameraAndEffects() {
        String metadata = """
                {
                  "camera": {
                    "focalLength": 55,
                    "exposure": -0.3,
                    "contrast": 12
                  },
                  "lighting": {
                    "name": "侧光-右",
                    "strength": 81
                  },
                  "filter": {
                    "name": "粉樱",
                    "strength": 31
                  },
                  "dressing": {
                    "clothes": [
                      {"id":"shoe-1","name":"月影鞋","category":"shoes"},
                      {"id":"hair-1","name":"星河长发","category":"hair"}
                    ]
                  }
                }
                """;

        ShareCardPayload payload = ShareCardPayloadBuilder.build(
                "asset-1",
                "2026-09-21T10:00:00Z",
                "1.5",
                metadata
        );

        assertEquals(2, payload.outfitItems().size());
        assertEquals("发型", payload.outfitItems().get(0).label());
        assertEquals("鞋子", payload.outfitItems().get(1).label());
        assertTrue(payload.cameraItems().stream().anyMatch(item -> "焦距".equals(item.label()) && "55".equals(item.value())));
        assertTrue(payload.effectItems().stream().anyMatch(item -> "光照".equals(item.label()) && item.value().contains("81%")));
        assertTrue(payload.effectItems().stream().anyMatch(item -> "滤镜".equals(item.label()) && item.value().contains("31%")));
    }

    @Test public void malformedMetadataStillProducesExportablePayload() {
        ShareCardPayload payload = ShareCardPayloadBuilder.build("asset-2", null, null, "{not-json");
        assertEquals("asset-2", payload.assetId());
        assertTrue(payload.outfitItems().isEmpty());
        assertTrue(payload.cameraItems().isEmpty());
        assertTrue(payload.effectItems().isEmpty());
    }
}
