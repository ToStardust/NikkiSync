package app.nikkisync.mobile.media;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.widget.ImageView;
import app.nikkisync.mobile.R;

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
    /** Display previews only. Original and share-card exports retain their separate full-quality paths. */
    static Bitmap decodeDisplayFile(File file){
        BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;
        BitmapFactory.decodeFile(file.getAbsolutePath(),options);
        if(options.outWidth<=0||options.outHeight<=0)return null;
        options.inSampleSize=1;
        while(Math.max(options.outWidth,options.outHeight)/(options.inSampleSize*2)>=1280)options.inSampleSize*=2;
        options.inJustDecodeBounds=false;Bitmap decoded=BitmapFactory.decodeFile(file.getAbsolutePath(),options);
        if(decoded==null)return null;
        int longest=Math.max(decoded.getWidth(),decoded.getHeight());if(longest<=1280)return decoded;
        float scale=1280f/longest;Bitmap display=Bitmap.createScaledBitmap(decoded,Math.max(1,Math.round(decoded.getWidth()*scale)),Math.max(1,Math.round(decoded.getHeight()*scale)),true);
        if(display!=decoded)decoded.recycle();return display;
    }
    public static final long MAX_DISK_CACHE_BYTES = 512L * 1024L * 1024L;
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final LruCache<String, Bitmap> cache;
    private final File diskDir;
    private final Object[] downloadLocks = new Object[32];
    private long diskBytes=-1;

    @FunctionalInterface
    private interface ConnectionFactory {
        HttpsURLConnection open() throws Exception;
    }

    public ImageLoader(Context context) {
        for(int i=0;i<downloadLocks.length;i++)downloadLocks[i]=new Object();
        int maxKb = (int) Math.min(96 * 1024, Runtime.getRuntime().maxMemory() / 1024 / 6);
        cache = new LruCache<>(maxKb) {
            @Override protected int sizeOf(String key, Bitmap bitmap) { return bitmap.getByteCount() / 1024; }
        };
        diskDir = new File(context.getFilesDir(), "thumbnail-cache-v1");
        if (!diskDir.exists()) diskDir.mkdirs();
        File[] unfinished=diskDir.listFiles((dir,name)->name.endsWith(".part")&&System.currentTimeMillis()-new File(dir,name).lastModified()>86400000L);
        if(unfinished!=null)for(File file:unfinished)file.delete();
        executor.execute(this::pruneDiskCache);
    }

    public void load(NikkiSyncClient client, AssetSummary asset, ImageView target) {
        String resourceId = asset.thumbnailResourceId() != null ? asset.thumbnailResourceId() : asset.previewResourceId();
        String scope=client==null?"unpaired":client.server().serverId()+":"+client.server().tlsFingerprintSha256();
        target.setTag(R.id.photo_source_asset_id, asset.assetId());
        target.setTag(R.id.photo_source_identity, scope+":"+asset.assetId());
        String key = scope+":"+asset.assetId() + ":" + resourceId + ":r" + asset.revision();
        if (resourceId == null) { target.setTag(key); target.setImageDrawable(null); return; }
        loadNetwork(key, target, () -> client.resource(asset.assetId(), resourceId), null);
    }

    public void loadClothingThumbnail(NikkiSyncClient client, String assetId, String clothingId, String cacheVersion, ImageView target) {
        String key = ClothingCacheKey.of(client==null?null:client.server(),assetId,clothingId,cacheVersion);
        loadNetwork(key, target, () -> client.clothingThumbnail(assetId, clothingId), () -> showClothingPlaceholder(target));
    }

    private void loadNetwork(String key, ImageView target, ConnectionFactory connectionFactory, Runnable onFailure) {
        target.setTag(key);
        target.setImageDrawable(null);
        Bitmap cached = cache.get(key);
        if (cached != null) { target.setImageBitmap(cached); return; }
        executor.execute(() -> {
            synchronized(downloadLocks[(key.hashCode()&0x7fffffff)%downloadLocks.length]) {
            HttpsURLConnection connection = null;
            File temp=null;
            try {
                Bitmap memory=cache.get(key);
                if(memory!=null) {main.post(()->{if(key.equals(target.getTag()))target.setImageBitmap(memory);});return;}
                File disk = diskFile(key);
                if (disk.isFile()) {
                    Bitmap bitmap;
                    bitmap = decodeDisplayFile(disk);
                    if (bitmap != null) {
                        disk.setLastModified(System.currentTimeMillis());
                        cache.put(key, bitmap);
                        main.post(() -> { if (key.equals(target.getTag())) target.setImageBitmap(bitmap); });
                        return;
                    }
                    disk.delete();
                }
                connection = connectionFactory.open();
                int responseCode = connection.getResponseCode();
                if (responseCode != 200) throw new IllegalStateException("image request HTTP " + responseCode);
                Bitmap bitmap;
                temp = File.createTempFile("ui-", ".part", diskDir);
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temp)) {
                    byte[] buffer = new byte[64 * 1024]; int read;
                    while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                }
                bitmap = decodeDisplayFile(temp);
                if (bitmap == null) { temp.delete(); throw new IllegalStateException("image decode failed"); }
                publishExportThumbnail(temp,disk);
                cache.put(key, bitmap);
                main.post(() -> { if (key.equals(target.getTag())) target.setImageBitmap(bitmap); });
                diskFileAdded(disk.length());
            } catch (Exception ignored) {
                if (onFailure != null) main.post(() -> { if (key.equals(target.getTag())) onFailure.run(); });
            } finally {
                if (connection != null) connection.disconnect();
                if(temp!=null)temp.delete();
            }
            }
        });
    }

    /** Keep a failed clothing image visible and diagnosable instead of leaving an empty grey tile. */
    private void showClothingPlaceholder(ImageView target) {
        final int size = 128;
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.rgb(236, 232, 228));
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.rgb(112, 105, 100));
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setTextSize(25f);
        canvas.drawText("暂无图", size / 2f, size / 2f + 9f, paint);
        target.setImageBitmap(bitmap);
    }

    private File diskFile(String key) throws Exception {
        return diskFile(diskDir, key);
    }

    private static File diskFile(File directory, String key) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(key.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder name = new StringBuilder(64);
        for (byte b : hash) name.append(String.format("%02x", b));
        return new File(directory, name + ".img");
    }

    /** Worker-thread export path. Returns an independently owned, bounded bitmap, including offline cache hits. */
    public static Bitmap readClothingForExport(Context context, NikkiSyncClient client,
                                               String assetId, String clothingId, String version) {
        return readClothingForExport(context, client, assetId, clothingId, version,
                android.os.SystemClock.elapsedRealtime() + 12000);
    }

    public static Bitmap readClothingForExport(Context context, NikkiSyncClient client,
                                               String assetId, String clothingId, String version, long deadline) {
        if (clothingId == null || clothingId.isBlank()) return null;
        HttpsURLConnection connection = null;
        File temp = null;
        try {
            File dir = new File(context.getFilesDir(), "thumbnail-cache-v1");
            dir.mkdirs();
            File disk = diskFile(dir, ClothingCacheKey.of(client==null?null:client.server(),assetId,clothingId,version));
            Bitmap cached = decodeExportThumbnail(disk);
            if (cached != null) return cached;
            if (client == null || android.os.SystemClock.elapsedRealtime() >= deadline) return null;
            connection = client.clothingThumbnail(assetId, clothingId);
            connection.setConnectTimeout((int) Math.max(1, Math.min(1500, deadline - android.os.SystemClock.elapsedRealtime())));
            connection.setReadTimeout((int) Math.max(1, Math.min(2500, deadline - android.os.SystemClock.elapsedRealtime())));
            if (connection.getResponseCode() != 200) return null;
            // Unique temporary files cannot collide with the UI loader's .part file.
            temp = File.createTempFile("share-", ".tmp", dir);
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temp)) {
                copyExportThumbnail(input, output, deadline, android.os.SystemClock::elapsedRealtime);
            }
            Bitmap bitmap = decodeExportThumbnail(temp);
            if (bitmap != null) {
                try { publishExportThumbnail(temp, disk); } catch (Exception ignored) { /* Export can use decoded pixels. */ }
            }
            return bitmap;
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
            if (temp != null) temp.delete();
        }
    }

    static void publishExportThumbnail(File temp, File disk) throws java.io.IOException {
        // Same-directory atomic replacement also repairs corrupt old entries without exposing partial data.
        try {
            java.nio.file.Files.move(temp.toPath(), disk.toPath(),
                    java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } catch (java.nio.file.FileSystemException unsupportedReplacement) {
            // Windows-hosted native tests/filesystems may not support atomic replacement.
            // Move a complete validated file, never copy bytes into an entry readers can see.
            java.nio.file.Files.move(temp.toPath(), disk.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
    }

    static void copyExportThumbnail(InputStream input, java.io.OutputStream output, long deadline,
                                    java.util.function.LongSupplier clock) throws java.io.IOException {
        byte[] buffer = new byte[8192];
        int total = 0;
        while (true) {
            if (clock.getAsLong() >= deadline) throw new java.io.IOException("thumbnail export deadline exceeded");
            int read = input.read(buffer);
            if (clock.getAsLong() >= deadline) throw new java.io.IOException("thumbnail export deadline exceeded");
            if (read == -1) return;
            total += read;
            if (total > 4 * 1024 * 1024) throw new java.io.IOException("thumbnail exceeds export limit");
            output.write(buffer, 0, read);
        }
    }

    private static Bitmap decodeExportThumbnail(File file) throws java.io.IOException {
        if (!file.isFile()) return null;
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream input = new FileInputStream(file)) { BitmapFactory.decodeStream(input, null, bounds); }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / options.inSampleSize > 512) options.inSampleSize *= 2;
        try (InputStream input = new FileInputStream(file)) { return BitmapFactory.decodeStream(input, null, options); }
    }

    private synchronized void diskFileAdded(long bytes) {
        if(diskBytes>=0)diskBytes+=bytes;
        pruneDiskCache();
    }

    private synchronized void pruneDiskCache() {
        if(diskBytes>=0&&diskBytes<=MAX_DISK_CACHE_BYTES)return;
        File[] files = diskDir.listFiles((dir, name) -> name.endsWith(".img"));
        if (files == null) return;
        long total = 0; for (File file : files) total += file.length();
        diskBytes=total;
        if (total <= MAX_DISK_CACHE_BYTES) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        for (File file : files) {
            if (total <= MAX_DISK_CACHE_BYTES) break;
            long size = file.length(); if (file.delete()) total -= size;
        }
        diskBytes=total;
    }

    public void shutdown() { executor.shutdownNow(); cache.evictAll(); }
}
