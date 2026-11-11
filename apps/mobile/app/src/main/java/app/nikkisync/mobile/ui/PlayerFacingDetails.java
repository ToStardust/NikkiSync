package app.nikkisync.mobile.ui;

import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.storage.EditedVariantStore;
import app.nikkisync.mobile.storage.SavedPhotoStore;
import java.text.DateFormat;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Date;
import org.json.JSONArray;
import org.json.JSONObject;

/** Short detail copy for players; IDs and raw metadata are intentionally not rendered here. */
public final class PlayerFacingDetails {
    private PlayerFacingDetails() {}

    public static String sourcePhoto(AssetSummary asset) {
        StringBuilder out = new StringBuilder();
        if (asset.isVideo()) out.append("视频");
        else if (asset.hasMotion()) out.append("LIVE 照片");
        String captured = date(asset.capturedAt());
        if (captured != null) {
            if (out.length() > 0) out.append("\n");
            out.append("拍摄时间：").append(captured);
        }
        if (asset.gameVersion() != null && !asset.gameVersion().isBlank()) {
            if (out.length() > 0) out.append("\n");
            out.append("游戏版本：").append(asset.gameVersion());
        }
        return out.toString();
    }

    public static String savedPhoto(SavedPhotoStore.Record record, boolean missing) {
        StringBuilder out = new StringBuilder();
        if (missing) out.append("文件不存在\n");
        out.append("保存时间：").append(date(record.savedAt()));
        String captured = date(record.capturedAt());
        if (captured != null) out.append("\n拍摄时间：").append(captured);
        if (record.gameVersion() != null && !record.gameVersion().isBlank()) {
            out.append("\n游戏版本：").append(record.gameVersion());
        }
        if (record.rotationDegrees() != 0) out.append("\n已旋转保存");
        return out.toString();
    }

    public static String editedPhoto(EditedVariantStore.Variant variant, boolean missing) {
        StringBuilder out = new StringBuilder();
        if (missing) out.append("文件不可访问\n");
        out.append("关联时间：").append(date(variant.linkedAt()));
        return out.toString();
    }

    public static String clothingName(String name, String internalId) {
        if (name == null || name.isBlank()) return "名称暂缺";
        String visible = name.trim();
        if (visible.equals(internalId) || visible.matches("服装\\s*[+＋#＃:：-]?\\s*\\d+")) return "名称暂缺";
        return visible;
    }

    /** Describe the observed result; do not present a list of unrelated guesses. */
    public static String metadataNotice(String metadataJson) {
        try {
            JSONObject metadata = metadataJson == null || metadataJson.isBlank() ? new JSONObject() : new JSONObject(metadataJson);
            JSONObject dressing = metadata.optJSONObject("dressing"), camera = metadata.optJSONObject("camera");
            JSONArray clothes = dressing == null ? null : dressing.optJSONArray("clothes");
            boolean hasClothes = false, hasCamera = false;
            if (clothes != null) for (int i = 0; i < clothes.length(); i++) {
                JSONObject item = clothes.optJSONObject(i);
                if (item != null && !item.isNull("id") && !item.optString("id", "").isBlank()) hasClothes = true;
            }
            if (camera != null) {
                var keys = camera.keys();
                while (keys.hasNext()) {String key = keys.next();if (!camera.isNull(key) && !camera.optString(key, "").isBlank()) hasCamera = true;}
            }
            if (hasClothes && hasCamera) return "";
            String missing = hasClothes ? "部分拍摄参数" : hasCamera ? "穿搭数据" : "穿搭和拍摄参数";
            JSONObject raw = metadata.optJSONObject("raw"), resolver = raw == null ? null : raw.optJSONObject("resolver");
            String status = resolver == null ? "" : resolver.optString("status", "");
            boolean embedded = raw != null && (raw.optBoolean("sourceParametersPresent", false)
                    || !raw.optString("nativeParamToken", "").isBlank() || !raw.optString("nativeParamPayload", "").isBlank());
            if (!"resolved".equals(status) && embedded && raw.has("sourceParametersComplete")) {
                if(!raw.optBoolean("sourceParametersComplete"))return "检测到参数标记，但当前能读取的原始数据不完整。请保留原图，并在电脑补充包含 UID 的游戏相册目录。";
                JSONObject identity=metadata.optJSONObject("identity");
                if(identity==null||identity.optString("uid", "").isBlank())return "检测到原始参数，但未识别到所属 UID。请在电脑添加保留 UID 文件夹的原游戏相册后重新扫描。";
            }
            if (!"resolved".equals(status) && (embedded || "failed".equals(status)))
                return "检测到游戏参数，但" + missing + "尚未解码成功。请在电脑端重新扫描并检查参数解析状态。";
            if ("resolved".equals(status)) return missing + "未能完整读取，当前仅展示已读取的信息。";
            if (raw != null && raw.optBoolean("sourceParametersChecked", false) && !raw.optBoolean("sourceParametersPresent"))
                return "电脑已检查这张照片，未检测到可读取的游戏参数。请使用游戏内相机原图。";
            if (hasClothes || hasCamera) return missing + "未能完整读取，当前仅展示已读取的信息。";
            return "当前未读到穿搭和拍摄参数。请查看照片来源并尝试使用游戏内相机原图。";
        } catch (Exception ignored) {
            return "照片参数暂不可用，请连接电脑重新同步。";
        }
    }

    public static String metadataNotice(String metadataJson, String sourcePath) {
        String notice = metadataNotice(metadataJson);
        if (notice.isEmpty() || !isScreenShotPath(sourcePath)) return notice;
        try {
            JSONObject metadata = metadataJson == null || metadataJson.isBlank() ? new JSONObject() : new JSONObject(metadataJson);
            JSONObject raw = metadata.optJSONObject("raw");
            JSONObject resolver = raw == null ? null : raw.optJSONObject("resolver");
            boolean hasOriginalParameters = raw != null && (raw.optBoolean("sourceParametersPresent", false)
                    || !raw.optString("nativeParamToken", "").isBlank()
                    || !raw.optString("nativeParamPayload", "").isBlank());
            if (hasOriginalParameters || resolver != null && ("failed".equals(resolver.optString("status"))
                    || "resolved".equals(resolver.optString("status")))) return notice;
            if (raw != null && raw.optBoolean("sourceParametersChecked", false))
                return "这张照片来自 ScreenShot，电脑已检查但未检测到游戏参数。请使用游戏内相机原图。";
        } catch (Exception ignored) { return notice; }
        return "这张照片来自 ScreenShot，当前未读到游戏参数。请使用游戏内相机原图。";
    }

    /** Asset type and indexed source are available for both online and saved photo viewers. */
    public static String metadataNoticeForAsset(AssetSummary asset, String metadataJson) {
        if (asset == null) return metadataNotice(metadataJson);
        String notice = metadataNotice(metadataJson, asset.sourcePath());
        if (notice.isEmpty()) return notice;
        try {
            JSONObject metadata = metadataJson == null || metadataJson.isBlank() ? new JSONObject() : new JSONObject(metadataJson);
            JSONObject raw = metadata.optJSONObject("raw");
            JSONObject resolver = raw == null ? null : raw.optJSONObject("resolver");
            boolean sourcePresent = raw != null && (raw.optBoolean("sourceParametersPresent", false)
                    || !raw.optString("nativeParamToken", "").isBlank()
                    || !raw.optString("nativeParamPayload", "").isBlank());
            boolean checkedMissing = raw != null && raw.optBoolean("sourceParametersChecked", false) && !sourcePresent;
            JSONObject camera = metadata.optJSONObject("camera"), dressing = metadata.optJSONObject("dressing");
            JSONArray clothes = dressing == null ? null : dressing.optJSONArray("clothes");
            boolean partial = camera != null && camera.length() > 0 || clothes != null && clothes.length() > 0;
            if (!sourcePresent && !partial && (resolver == null || !"failed".equals(resolver.optString("status", "")))
                    && (checkedMissing || !asset.hasMetadata())) {
                if (asset.hasMotion()) return "这张 LIVE 照片未读到游戏参数，因此无法显示穿搭和拍摄设置。";
                if (isScreenShotPath(asset.sourcePath()))
                    return "这张照片来自 ScreenShot，未读到游戏参数；请使用游戏内相机原图。";
                if (isGamePlayPhotosPath(asset.sourcePath()))
                    return "这张游戏内相机照片未读到参数。请在电脑重新扫描这张原图。";
                return "这张照片未读到游戏参数，因此无法显示穿搭和拍摄设置。";
            }
        } catch (Exception ignored) { return notice; }
        return notice;
    }

    public static boolean isScreenShotPath(String sourcePath) {
        return sourcePath != null && ("/" + sourcePath.replace('\\', '/') + "/").matches("(?is).*/ScreenShot(?:/.*)?");
    }

    private static boolean isGamePlayPhotosPath(String sourcePath) {
        return sourcePath != null && ("/" + sourcePath.replace('\\', '/') + "/").matches("(?is).*/GamePlayPhotos(?:/.*)?");
    }

    private static String date(String capturedAt) {
        if (capturedAt == null || capturedAt.isBlank()) return null;
        try {
            return date(Instant.parse(capturedAt).toEpochMilli());
        } catch (Exception ignored) {
            try {
                long millis = LocalDateTime.parse(capturedAt.replace(' ', 'T'))
                        .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
                return date(millis);
            } catch (Exception ignoredAgain) {
                return null;
            }
        }
    }

    private static String date(long millis) {
        return DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
                .format(new Date(millis));
    }
}
