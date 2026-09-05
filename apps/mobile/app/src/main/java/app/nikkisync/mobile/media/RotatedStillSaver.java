package app.nikkisync.mobile.media;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;

import app.nikkisync.mobile.model.Models.AssetDetail;
import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.model.Models.MediaResource;
import app.nikkisync.mobile.net.NikkiSyncClient;
import app.nikkisync.mobile.ui.RotationDegrees;
import app.nikkisync.mobile.util.Hex;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;

import javax.net.ssl.HttpsURLConnection;

public final class RotatedStillSaver {
    public Uri save(Context context, NikkiSyncClient client, AssetSummary asset, int degrees) throws Exception {
        if (!RotationDegrees.isValid(degrees) || degrees == 0) {
            throw new IllegalArgumentException("旋转导出仅支持 90°、180°、270°");
        }
        if (asset.hasMotion()) {
            throw new UnsupportedOperationException("旋转后的 LIVE 照片暂不支持保存");
        }

        AssetDetail detail = client.asset(asset.assetId());
        MediaResource original = detail.originalStill();
        if (original == null) throw new IllegalStateException("这张照片没有可导出的原始静态资源");

        HttpsURLConnection connection = client.resource(asset.assetId(), original.resourceId());
        File verifiedSource = File.createTempFile("nikkisync-rotate-", ".source", context.getCacheDir());
        Bitmap sourceBitmap = null;
        Bitmap rotatedBitmap = null;
        Uri pendingUri = null;
        try {
            int status = connection.getResponseCode();
            if (status != 200) throw new IllegalStateException("原图请求失败：HTTP " + status);
            String expectedHash = connection.getHeaderField("X-NikkiSync-SHA256");
            if (expectedHash == null || !expectedHash.matches("[0-9a-fA-F]{64}")) {
                throw new SecurityException("PC 未返回有效原图 SHA-256");
            }

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream raw = connection.getInputStream();
                 DigestInputStream input = new DigestInputStream(raw, digest);
                 OutputStream output = new BufferedOutputStream(new FileOutputStream(verifiedSource))) {
                byte[] buffer = new byte[128 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
                output.flush();
            }
            String actualHash = Hex.lower(digest.digest());
            if (!actualHash.equalsIgnoreCase(expectedHash)) {
                throw new SecurityException("原图 SHA-256 校验失败，已取消旋转导出");
            }

            try (InputStream input = new FileInputStream(verifiedSource)) {
                sourceBitmap = BitmapFactory.decodeStream(input);
            }
            if (sourceBitmap == null) throw new IllegalStateException("原图无法解码，不能执行旋转导出");

            Matrix matrix = new Matrix();
            matrix.postRotate(degrees);
            try {
                rotatedBitmap = Bitmap.createBitmap(
                        sourceBitmap,
                        0,
                        0,
                        sourceBitmap.getWidth(),
                        sourceBitmap.getHeight(),
                        matrix,
                        true
                );
            } catch (OutOfMemoryError error) {
                throw new IllegalStateException("照片尺寸过大，当前设备内存不足以完成旋转导出", error);
            }
            if (rotatedBitmap == null) throw new IllegalStateException("旋转图像生成失败");

            RotatedExportSpec spec = RotatedExportSpec.forSource(original.fileName(), original.mimeType(), degrees);
            ContentResolver resolver = context.getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, spec.fileName());
            values.put(MediaStore.Images.Media.MIME_TYPE, spec.mimeType());
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/NikkiSync");
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
            pendingUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (pendingUri == null) throw new IllegalStateException("系统相册创建旋转照片失败");

            Bitmap.CompressFormat format = "image/png".equals(spec.mimeType())
                    ? Bitmap.CompressFormat.PNG
                    : Bitmap.CompressFormat.JPEG;
            try (OutputStream output = resolver.openOutputStream(pendingUri, "w")) {
                if (output == null) throw new IllegalStateException("系统相册无法写入旋转照片");
                if (!rotatedBitmap.compress(format, spec.quality(), output)) {
                    throw new IllegalStateException("旋转照片编码失败");
                }
                output.flush();
            }

            ContentValues ready = new ContentValues();
            ready.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(pendingUri, ready, null, null);
            Uri result = pendingUri;
            pendingUri = null;
            return result;
        } catch (Exception error) {
            if (pendingUri != null) context.getContentResolver().delete(pendingUri, null, null);
            throw error;
        } finally {
            connection.disconnect();
            if (rotatedBitmap != null && rotatedBitmap != sourceBitmap && !rotatedBitmap.isRecycled()) rotatedBitmap.recycle();
            if (sourceBitmap != null && !sourceBitmap.isRecycled()) sourceBitmap.recycle();
            if (verifiedSource.exists()) verifiedSource.delete();
        }
    }
}
