package app.nikkisync.mobile.media;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;

import app.nikkisync.mobile.model.Models.AssetDetail;
import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.model.Models.MediaResource;
import app.nikkisync.mobile.net.NikkiSyncClient;

import java.io.InputStream;
import java.io.OutputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;

import app.nikkisync.mobile.util.Hex;

import javax.net.ssl.HttpsURLConnection;

public final class OriginalSaver {
    public Uri save(Context context, NikkiSyncClient client, AssetSummary asset) throws Exception {
        AssetDetail detail = client.asset(asset.assetId());
        MediaResource original = detail.originalStill();
        if (original == null) throw new IllegalStateException("这张照片没有可保存的原始静态资源");
        HttpsURLConnection connection = client.resource(asset.assetId(), original.resourceId());
        int status = connection.getResponseCode();
        if (status != 200) throw new IllegalStateException("原图请求失败：HTTP " + status);
        String expectedHash = connection.getHeaderField("X-NikkiSync-SHA256");
        if (expectedHash == null || !expectedHash.matches("[0-9a-fA-F]{64}")) {
            throw new SecurityException("PC 未返回有效原图 SHA-256");
        }

        ContentResolver resolver = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, original.fileName());
        values.put(MediaStore.Images.Media.MIME_TYPE, original.mimeType());
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/NikkiSync");
        values.put(MediaStore.Images.Media.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IllegalStateException("系统相册创建文件失败");

        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream raw = connection.getInputStream();
                 DigestInputStream input = new DigestInputStream(raw, digest);
                 OutputStream output = resolver.openOutputStream(uri, "w")) {
                if (output == null) throw new IllegalStateException("系统相册无法写入文件");
                byte[] buffer = new byte[128 * 1024]; int read;
                while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
                output.flush();
            }
            String actualHash = Hex.lower(digest.digest());
            if (!actualHash.equalsIgnoreCase(expectedHash)) {
                throw new SecurityException("原图 SHA-256 校验失败，已取消保存");
            }
            ContentValues ready = new ContentValues();
            ready.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(uri, ready, null, null);
            return uri;
        } catch (Exception error) {
            resolver.delete(uri, null, null);
            throw error;
        } finally {
            connection.disconnect();
        }
    }
}
