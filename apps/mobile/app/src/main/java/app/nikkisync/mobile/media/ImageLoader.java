package app.nikkisync.mobile.media;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.widget.ImageView;

import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.net.NikkiSyncClient;

import java.io.InputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.HttpsURLConnection;

public final class ImageLoader {
    private static final long MAX_DISK_CACHE_BYTES = 256L * 1024L * 1024L;
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final LruCache<String, Bitmap> cache;
    private final File diskDir;

    @FunctionalInterface
    private interface ConnectionFactory {
        HttpsURLConnection open() throws Exception;
    }

    public ImageLoader(Context context) {
        int maxKb = (int) Math.min(96 * 1024, Runtime.getRuntime().maxMemory() / 1024 / 6);
        cache = new LruCache<>(maxKb) {
            @Override protected int sizeOf(String key, Bitmap bitmap) { return bitmap.getByteCount() / 1024; }
        };
        diskDir = new File(context.getFilesDir(), "thumbnail-cache-v1");
        if (!diskDir.exists()) diskDir.mkdirs();
        executor.execute(this::pruneDiskCache);
    }

    public void load(NikkiSyncClient client, AssetSummary asset, ImageView target) {
        String resourceId = asset.thumbnailResourceId() != null ? asset.thumbnailResourceId() : asset.previewResourceId();
        String key = asset.assetId() + ":" + resourceId + ":r" + asset.revision();
        if (resourceId == null) { target.setTag(key); target.setImageDrawable(null); return; }
        loadNetwork(key, target, () -> client.resource(asset.assetId(), resourceId));
    }

    public void loadClothingThumbnail(NikkiSyncClient client, String assetId, String clothingId, String cacheVersion, ImageView target) {
        String key = "clothing:" + assetId + ":" + clothingId + ":" + (cacheVersion == null ? "" : cacheVersion);
        loadNetwork(key, target, () -> client.clothingThumbnail(assetId, clothingId));
    }

    private void loadNetwork(String key, ImageView target, ConnectionFactory connectionFactory) {
        target.setTag(key);
        target.setImageDrawable(null);
        Bitmap cached = cache.get(key);
        if (cached != null) { target.setImageBitmap(cached); return; }
        executor.execute(() -> {
            try {
                File disk = diskFile(key);
                if (disk.isFile()) {
                    Bitmap bitmap;
                    try (InputStream input = new FileInputStream(disk)) { bitmap = BitmapFactory.decodeStream(input); }
                    if (bitmap != null) {
                        disk.setLastModified(System.currentTimeMillis());
                        cache.put(key, bitmap);
                        main.post(() -> { if (key.equals(target.getTag())) target.setImageBitmap(bitmap); });
                        return;
                    }
                    disk.delete();
                }
                HttpsURLConnection connection = connectionFactory.open();
                if (connection.getResponseCode() != 200) return;
                Bitmap bitmap;
                File temp = new File(diskDir, disk.getName() + ".part");
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temp)) {
                    byte[] buffer = new byte[64 * 1024]; int read;
                    while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                }
                bitmap = BitmapFactory.decodeFile(temp.getAbsolutePath());
                if (bitmap == null) { temp.delete(); return; }
                if (!temp.renameTo(disk)) {
                    try (InputStream input = new FileInputStream(temp); FileOutputStream output = new FileOutputStream(disk)) {
                        byte[] buffer = new byte[64 * 1024]; int read;
                        while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                    }
                    temp.delete();
                }
                cache.put(key, bitmap);
                main.post(() -> { if (key.equals(target.getTag())) target.setImageBitmap(bitmap); });
            } catch (Exception ignored) {}
        });
    }

    private File diskFile(String key) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(key.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder name = new StringBuilder(64);
        for (byte b : hash) name.append(String.format("%02x", b));
        return new File(diskDir, name + ".img");
    }

    private void pruneDiskCache() {
        File[] files = diskDir.listFiles((dir, name) -> name.endsWith(".img") || name.endsWith(".part"));
        if (files == null) return;
        for (File file : files) if (file.getName().endsWith(".part")) file.delete();
        files = diskDir.listFiles((dir, name) -> name.endsWith(".img"));
        if (files == null) return;
        long total = 0; for (File file : files) total += file.length();
        if (total <= MAX_DISK_CACHE_BYTES) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        for (File file : files) {
            if (total <= MAX_DISK_CACHE_BYTES) break;
            long size = file.length(); if (file.delete()) total -= size;
        }
    }

    public void shutdown() { executor.shutdownNow(); cache.evictAll(); }
}
