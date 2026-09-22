package app.nikkisync.mobile.share;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.graphics.Bitmap;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.ArrayList;
import java.util.List;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public final class ShareCardExporterTest {
    @Test public void renderUsesPortraitMinimumSizeWithoutBackground() {
        ShareCardPayload payload = new ShareCardPayload(
                "asset-1",
                "2026-09-22T10:00:00Z",
                "1.5",
                List.of(new ShareCardPayload.Item("发型", "星河长发")),
                List.of(new ShareCardPayload.Item("焦距", "55")),
                List.of(new ShareCardPayload.Item("滤镜", "粉樱 · 31%"))
        );

        Bitmap bitmap = ShareCardExporter.render(null, payload);
        try {
            assertEquals(ShareCardExporter.WIDTH, bitmap.getWidth());
            assertEquals(1440, bitmap.getHeight());
        } finally {
            bitmap.recycle();
        }
    }

    @Test public void renderGrowsForLongOutfitList() {
        List<ShareCardPayload.Item> outfit = new ArrayList<>();
        for (int index = 0; index < 24; index++) {
            outfit.add(new ShareCardPayload.Item("饰品 " + index, "测试服装 " + index));
        }
        ShareCardPayload payload = new ShareCardPayload(
                "asset-2",
                null,
                null,
                outfit,
                List.of(),
                List.of()
        );

        Bitmap bitmap = ShareCardExporter.render(null, payload);
        try {
            assertEquals(ShareCardExporter.WIDTH, bitmap.getWidth());
            assertTrue(bitmap.getHeight() > 1440);
        } finally {
            bitmap.recycle();
        }
    }

    @Test public void renderAcceptsBitmapBackgroundThroughOffscreenPath() {
        Bitmap background = Bitmap.createBitmap(160, 240, Bitmap.Config.ARGB_8888);
        ShareCardPayload payload = new ShareCardPayload(
                "asset-3",
                null,
                null,
                List.of(),
                List.of(),
                List.of()
        );

        Bitmap rendered = ShareCardExporter.render(background, payload);
        try {
            assertEquals(ShareCardExporter.WIDTH, rendered.getWidth());
            assertEquals(1440, rendered.getHeight());
        } finally {
            rendered.recycle();
            background.recycle();
        }
    }
}
