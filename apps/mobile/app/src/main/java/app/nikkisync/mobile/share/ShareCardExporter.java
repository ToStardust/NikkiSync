package app.nikkisync.mobile.share;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;

import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.net.NikkiSyncClient;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;

import javax.net.ssl.HttpsURLConnection;

public final class ShareCardExporter {
    public static final int WIDTH = 1080;
    private static final int MIN_HEIGHT = 1440;
    private static final int OUTER = 54;
    private static final int GAP = 24;
    private static final int HEADER_HEIGHT = 190;
    private static final int ROW_HEIGHT = 86;

    private ShareCardExporter() {}

    public static Uri export(
            Context context,
            NikkiSyncClient client,
            AssetSummary asset,
            ShareCardPayload payload
    ) throws Exception {
        Bitmap background = loadBackground(client, asset);
        Bitmap card = null;
        try {
            card = render(background, payload);
            return save(context, asset, card);
        } finally {
            if (background != null && !background.isRecycled()) background.recycle();
            if (card != null && !card.isRecycled()) card.recycle();
        }
    }

    static Bitmap render(Bitmap background, ShareCardPayload payload) {
        int leftRows = Math.max(1, payload.outfitItems().size());
        int rightRows = Math.max(1, payload.cameraItems().size() + payload.effectItems().size() + 1);
        int rows = Math.max(leftRows, rightRows);
        int height = Math.max(MIN_HEIGHT, OUTER * 2 + HEADER_HEIGHT + rows * ROW_HEIGHT + 110);

        Bitmap output = Bitmap.createBitmap(WIDTH, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        drawBackground(canvas, background, WIDTH, height);

        Paint veil = new Paint(Paint.ANTI_ALIAS_FLAG);
        veil.setColor(0x36000000);
        canvas.drawRect(0, 0, WIDTH, height, veil);

        Paint title = textPaint(52f, true, Color.WHITE);
        canvas.drawText("NikkiSync", OUTER, OUTER + 62, title);
        Paint subtitle = textPaint(27f, false, 0xE6FFFFFF);
        String meta = nonBlank(payload.capturedAt()) ? payload.capturedAt() : "无限暖暖摄影参数";
        if (nonBlank(payload.gameVersion())) meta += "  ·  " + payload.gameVersion();
        canvas.drawText(meta, OUTER, OUTER + 112, subtitle);

        float top = OUTER + HEADER_HEIGHT;
        float columnWidth = (WIDTH - OUTER * 2f - GAP) / 2f;
        RectF left = new RectF(OUTER, top, OUTER + columnWidth, height - OUTER);
        RectF right = new RectF(left.right + GAP, top, WIDTH - OUTER, height - OUTER);
        drawGlass(canvas, left);
        drawGlass(canvas, right);

        drawColumn(canvas, left, "穿搭明细", payload.outfitItems());
        drawParameterColumn(canvas, right, payload.cameraItems(), payload.effectItems());

        Paint footer = textPaint(20f, false, 0xBFFFFFFF);
        footer.setTextAlign(Paint.Align.RIGHT);
        canvas.drawText("由 NikkiSync 生成", WIDTH - OUTER - 18, height - OUTER - 18, footer);
        return output;
    }

    private static void drawBackground(Canvas canvas, Bitmap bitmap, int width, int height) {
        if (bitmap == null) {
            Paint fallback = new Paint();
            fallback.setShader(new LinearGradient(0, 0, width, height, 0xFF857D88, 0xFFB3AAA8, Shader.TileMode.CLAMP));
            canvas.drawRect(0, 0, width, height, fallback);
            return;
        }

        float sourceRatio = bitmap.getWidth() / (float) bitmap.getHeight();
        float targetRatio = width / (float) height;
        Rect src;
        if (sourceRatio > targetRatio) {
            int srcWidth = Math.round(bitmap.getHeight() * targetRatio);
            int left = (bitmap.getWidth() - srcWidth) / 2;
            src = new Rect(left, 0, left + srcWidth, bitmap.getHeight());
        } else {
            int srcHeight = Math.round(bitmap.getWidth() / targetRatio);
            int top = (bitmap.getHeight() - srcHeight) / 2;
            src = new Rect(0, top, bitmap.getWidth(), top + srcHeight);
        }

        // Share-card export is rendered off-screen, so do not depend on View/RenderNode RenderEffect.
        // A strong downsample + filtered upscale produces a stable soft-focus background on API 33+.
        int blurWidth = Math.max(1, width / 20);
        int blurHeight = Math.max(1, height / 20);
        Bitmap softened = Bitmap.createBitmap(blurWidth, blurHeight, Bitmap.Config.ARGB_8888);
        try {
            Canvas blurCanvas = new Canvas(softened);
            Paint sampling = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
            blurCanvas.drawBitmap(bitmap, src, new Rect(0, 0, blurWidth, blurHeight), sampling);

            Paint upscale = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
            canvas.drawBitmap(softened, null, new Rect(0, 0, width, height), upscale);
        } finally {
            softened.recycle();
        }
    }

    private static void drawGlass(Canvas canvas, RectF rect) {
        Paint shadow = new Paint(Paint.ANTI_ALIAS_FLAG);
        shadow.setColor(0x26000000);
        canvas.drawRoundRect(new RectF(rect.left + 4, rect.top + 10, rect.right + 4, rect.bottom + 10), 38, 38, shadow);

        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setShader(new LinearGradient(rect.left, rect.top, rect.right, rect.bottom, 0xA8FFFFFF, 0x70FFFFFF, Shader.TileMode.CLAMP));
        canvas.drawRoundRect(rect, 38, 38, fill);

        Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(2f);
        stroke.setColor(0x66FFFFFF);
        canvas.drawRoundRect(new RectF(rect.left + 1, rect.top + 1, rect.right - 1, rect.bottom - 1), 38, 38, stroke);
    }

    private static void drawColumn(Canvas canvas, RectF rect, String heading, List<ShareCardPayload.Item> items) {
        float x = rect.left + 30;
        float y = rect.top + 56;
        canvas.drawText(heading, x, y, textPaint(31f, true, 0xFF302D31));
        y += 38;
        if (items.isEmpty()) {
            canvas.drawText("暂无可展示数据", x, y + 44, textPaint(24f, false, 0x99302D31));
            return;
        }
        for (ShareCardPayload.Item item : items) {
            drawItem(canvas, x, y, rect.width() - 60, item);
            y += ROW_HEIGHT;
        }
    }

    private static void drawParameterColumn(
            Canvas canvas,
            RectF rect,
            List<ShareCardPayload.Item> camera,
            List<ShareCardPayload.Item> effects
    ) {
        float x = rect.left + 30;
        float y = rect.top + 56;
        canvas.drawText("拍摄参数", x, y, textPaint(31f, true, 0xFF302D31));
        y += 38;
        if (camera.isEmpty()) {
            canvas.drawText("暂无拍摄参数", x, y + 44, textPaint(24f, false, 0x99302D31));
            y += ROW_HEIGHT;
        } else {
            for (ShareCardPayload.Item item : camera) {
                drawItem(canvas, x, y, rect.width() - 60, item);
                y += ROW_HEIGHT;
            }
        }

        y += 18;
        canvas.drawText("动作 / 灯光 / 滤镜", x, y + 30, textPaint(27f, true, 0xFF302D31));
        y += 54;
        if (effects.isEmpty()) {
            canvas.drawText("暂无效果数据", x, y + 38, textPaint(23f, false, 0x99302D31));
            return;
        }
        for (ShareCardPayload.Item item : effects) {
            drawItem(canvas, x, y, rect.width() - 60, item);
            y += ROW_HEIGHT;
        }
    }

    private static void drawItem(Canvas canvas, float x, float y, float width, ShareCardPayload.Item item) {
        RectF row = new RectF(x, y, x + width, y + ROW_HEIGHT - 10);
        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setColor(0x66FFFFFF);
        canvas.drawRoundRect(row, 22, 22, fill);

        Paint label = textPaint(20f, false, 0xA65B555D);
        canvas.drawText(ellipsize(item.label(), label, width - 34), x + 17, y + 29, label);
        Paint value = textPaint(25f, true, 0xFF302D31);
        canvas.drawText(ellipsize(item.value(), value, width - 34), x + 17, y + 61, value);
    }

    private static String ellipsize(String value, Paint paint, float maxWidth) {
        if (value == null) return "";
        if (paint.measureText(value) <= maxWidth) return value;
        String suffix = "…";
        int end = value.length();
        while (end > 0 && paint.measureText(value, 0, end) + paint.measureText(suffix) > maxWidth) end--;
        return value.substring(0, Math.max(0, end)) + suffix;
    }

    private static Paint textPaint(float size, boolean bold, int color) {
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(color);
        paint.setTextSize(size);
        paint.setTypeface(bold ? android.graphics.Typeface.DEFAULT_BOLD : android.graphics.Typeface.DEFAULT);
        return paint;
    }

    private static Bitmap loadBackground(NikkiSyncClient client, AssetSummary asset) {
        if (client == null || asset == null) return null;
        String resourceId = nonBlank(asset.thumbnailResourceId())
                ? asset.thumbnailResourceId()
                : asset.previewResourceId();
        if (!nonBlank(resourceId)) return null;
        HttpsURLConnection connection = null;
        try {
            connection = client.resource(asset.assetId(), resourceId);
            if (connection.getResponseCode() != 200) return null;
            try (InputStream input = connection.getInputStream()) {
                return BitmapFactory.decodeStream(input);
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static Uri save(Context context, AssetSummary asset, Bitmap bitmap) throws Exception {
        ContentResolver resolver = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, "NikkiSync-Share-" + safeId(asset.assetId()) + "-" + System.currentTimeMillis() + ".jpg");
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/NikkiSync/Share Cards");
        values.put(MediaStore.Images.Media.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IllegalStateException("系统相册创建分享图失败");

        try {
            try (OutputStream output = resolver.openOutputStream(uri, "w")) {
                if (output == null || !bitmap.compress(Bitmap.CompressFormat.JPEG, 92, output)) {
                    throw new IllegalStateException("分享图编码失败");
                }
            }
            ContentValues ready = new ContentValues();
            ready.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(uri, ready, null, null);
            return uri;
        } catch (Exception error) {
            resolver.delete(uri, null, null);
            throw error;
        }
    }

    private static String safeId(String assetId) {
        if (assetId == null || assetId.isBlank()) return "photo";
        return assetId.replaceAll("[^A-Za-z0-9_-]", "_");
    }

    private static boolean nonBlank(String value) {
        return value != null && !value.isBlank();
    }
}
