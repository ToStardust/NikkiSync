package app.nikkisync.mobile.ui;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;

public final class ClothingPresentationTest {
    @Test public void exposesOnlyNamedClothesWithSafeHttpsThumbnails() {
        String metadata = """
                {
                  "dressing": {
                    "clothes": [
                      {"id":"1020100111","name":"馥郁时花","thumbnail":"https://gongeo.us/images/items/icons/1020100111.png"},
                      {"id":"1020200222","name":"只有名称"},
                      {"id":"1020300333","name":"不安全链接","thumbnail":"http://example.test/1020300333.png"},
                      {"id":"1020400444","thumbnail":"https://gongeo.us/images/items/icons/1020400444.png"}
                    ]
                  }
                }
                """;

        List<ClothingPresentation.Item> items = ClothingPresentation.fromMetadataJson(metadata);

        assertEquals(1, items.size());
        assertEquals("馥郁时花", items.get(0).name());
        assertEquals("https://gongeo.us/images/items/icons/1020100111.png", items.get(0).thumbnailUrl());
        assertFalse(items.get(0).name().contains("1020100111"));
    }

    @Test public void malformedOrEmptyMetadataProducesNoCardsWithoutThrowing() {
        assertTrue(ClothingPresentation.fromMetadataJson(null).isEmpty());
        assertTrue(ClothingPresentation.fromMetadataJson("").isEmpty());
        assertTrue(ClothingPresentation.fromMetadataJson("{broken").isEmpty());
        assertTrue(ClothingPresentation.fromMetadataJson("{\"dressing\":{\"clothes\":[]}}").isEmpty());
    }

    @Test public void missingThumbnailDoesNotInventAnEmptyVisualCard() {
        List<ClothingPresentation.Item> items = ClothingPresentation.fromMetadataJson(
                "{\"dressing\":{\"clothes\":[{\"id\":\"1020200222\",\"name\":\"只有名称\"}]}}"
        );

        assertTrue(items.isEmpty());
    }

    @Test public void unreachableThumbnailStillKeepsHumanReadableClothingText() {
        String metadata = """
                {
                  "dressing": {
                    "clothes": [
                      {"id":"1020100111","name":"馥郁时花","thumbnail":"https://example.invalid/missing.png"}
                    ]
                  }
                }
                """;

        List<ClothingPresentation.Item> cards = ClothingPresentation.fromMetadataJson(metadata);
        MetadataPresentation text = MetadataPresentation.fromMetadataJson(metadata, null, null, null);

        assertEquals(1, cards.size());
        assertEquals("馥郁时花", cards.get(0).name());
        assertTrue(text.summary().contains("馥郁时花"));
        assertFalse(text.summary().contains("1020100111"));
    }
}
