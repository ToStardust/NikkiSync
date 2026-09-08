package app.nikkisync.mobile.ui;

import org.junit.Test;

import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;

public final class ClothingPresentationTest {
    @Test
    public void parsesClothingCardsInSourceOrderWithSafeFallbacks() {
        String metadata = """
                {
                  \"dressing\": {
                    \"clothes\": [
                      {
                        \"id\": \"1020100111\",
                        \"name\": \"馥郁时花\",
                        \"thumbnail\": \"https://gongeo.us/images/items/icons/1020100111.png\"
                      },
                      {
                        \"id\": \"1020100112\",
                        \"name\": \"星光\"
                      },
                      {
                        \"id\": \"1020100113\",
                        \"thumbnail\": \"https://gongeo.us/images/items/icons/1020100113.png\"
                      },
                      {
                        \"id\": \"1020100114\",
                        \"name\": \"不安全图片\",
                        \"thumbnail\": \"http://example.invalid/item.png\"
                      },
                      \"not-an-object\"
                    ]
                  }
                }
                """;

        List<ClothingPresentation.Item> items = ClothingPresentation.fromMetadataJson(metadata);

        assertEquals(4, items.size());
        assertEquals("馥郁时花", items.get(0).displayName());
        assertEquals("https://gongeo.us/images/items/icons/1020100111.png", items.get(0).thumbnailUrl());
        assertEquals("星光", items.get(1).displayName());
        assertNull(items.get(1).thumbnailUrl());
        assertEquals("未命名服装", items.get(2).displayName());
        assertEquals("https://gongeo.us/images/items/icons/1020100113.png", items.get(2).thumbnailUrl());
        assertEquals("不安全图片", items.get(3).displayName());
        assertNull(items.get(3).thumbnailUrl());

        for (ClothingPresentation.Item item : items) {
            assertFalse(item.displayName().contains("102010"));
        }
    }

    @Test
    public void malformedOrMissingClothingMetadataReturnsNoCards() {
        assertEquals(0, ClothingPresentation.fromMetadataJson(null).size());
        assertEquals(0, ClothingPresentation.fromMetadataJson("").size());
        assertEquals(0, ClothingPresentation.fromMetadataJson("not-json").size());
        assertEquals(0, ClothingPresentation.fromMetadataJson("{\"dressing\":{}}").size());
    }
}
