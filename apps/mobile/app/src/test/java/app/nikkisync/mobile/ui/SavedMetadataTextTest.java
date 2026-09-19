package app.nikkisync.mobile.ui;

import static org.junit.Assert.*;

import java.util.List;

import org.junit.Test;

public final class SavedMetadataTextTest {
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
        String json = "{\"dressing\":{\"clothes\":[{\"id\":\"10201\",\"name\":\"裙子\",\"category\":\"dresses\"}]}}";
        assertEquals(List.of("裙子 · 连衣裙 · ID 10201"), SavedMetadataText.clothingLines(json));
    }

    @Test public void invalidMetadataDoesNotCrashSavedDetails() {
        assertTrue(SavedMetadataText.summary("{broken").contains("参数数据损坏"));
        assertTrue(SavedMetadataText.clothingLines("{broken").isEmpty());
    }
}
