package app.nikkisync.mobile.ui;

import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.storage.EditedVariantStore;
import app.nikkisync.mobile.storage.SavedPhotoStore;
import java.text.DateFormat;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Date;

/** Short detail copy for players; IDs and raw metadata are intentionally not rendered here. */
public final class PlayerFacingDetails {
    private PlayerFacingDetails() {}

    public static String sourcePhoto(AssetSummary asset) {
        StringBuilder out = new StringBuilder();
        if (asset.hasMotion()) out.append("LIVE 照片");
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
