package app.nikkisync.mobile.ui;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class MetadataPresentationTest {
    @Test public void presentsHumanReadableMetadataAndKeepsTechnicalIdsOutOfSummary() {
        String metadata = """
                {
                  "capture": {"capturedAt":"2026-08-30T12:34:56.000Z"},
                  "location": {"id":"loc-001","name":"花愿镇"},
                  "filter": {"id":"filter-7","name":"晨雾","strength":0.75},
                  "lighting": {"id":"light-3","name":"柔光","strength":0.5},
                  "camera": {"focalLength":50,"exposure":0.3,"brightness":0.2},
                  "dressing": {
                    "clothes": [
                      {"id":"1020100111","name":"星愿连衣裙"},
                      {"id":"1020600111"}
                    ],
                    "eureka": [{"id":"eureka-1","name":"流光"}]
                  },
                  "raw": {"nativeParamToken":"01234567890123456789012345678901234567890123"}
                }
                """;

        MetadataPresentation presentation = MetadataPresentation.fromMetadataJson(metadata, 1920, 1080);
        String summary = presentation.summary();
        String technical = presentation.technicalDetails();

        assertTrue(summary.contains("2026-08-30T12:34:56.000Z"));
        assertTrue(summary.contains("1920 × 1080"));
        assertTrue(summary.contains("花愿镇"));
        assertTrue(summary.contains("星愿连衣裙"));
        assertTrue(summary.contains("服装 2 件"));
        assertTrue(summary.contains("流光"));
        assertTrue(summary.contains("晨雾"));
        assertTrue(summary.contains("柔光"));
        assertTrue(summary.contains("焦距：50"));

        assertFalse(summary.contains("loc-001"));
        assertFalse(summary.contains("1020100111"));
        assertFalse(summary.contains("nativeParamToken"));

        assertTrue(technical.contains("loc-001"));
        assertTrue(technical.contains("1020100111"));
        assertTrue(technical.contains("nativeParamToken"));
    }

    @Test public void fallsBackToSummaryCaptureTimeWhenMetadataOmitsCapture() {
        MetadataPresentation presentation = MetadataPresentation.fromMetadataJson(
                "{\"camera\":{\"focalLength\":35}}",
                1920,
                1080,
                "2026-09-01T03:04:05.000Z"
        );

        assertTrue(presentation.summary().contains("拍摄时间：2026-09-01T03:04:05.000Z"));
    }

    @Test public void missingOrBrokenMetadataDegradesWithoutThrowing() {
        MetadataPresentation empty = MetadataPresentation.fromMetadataJson(null, null, null);
        MetadataPresentation broken = MetadataPresentation.fromMetadataJson("{broken", 100, 200);

        assertTrue(empty.summary().contains("暂无可显示的照片参数"));
        assertTrue(broken.summary().contains("100 × 200"));
        assertTrue(broken.summary().contains("照片参数读取失败"));
    }
}
