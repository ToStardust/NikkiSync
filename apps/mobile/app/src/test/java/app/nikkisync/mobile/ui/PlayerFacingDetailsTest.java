package app.nikkisync.mobile.ui;

import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.storage.EditedVariantStore;
import app.nikkisync.mobile.storage.SavedPhotoStore;
import org.junit.Test;
import static org.junit.Assert.*;

public final class PlayerFacingDetailsTest {
    @Test public void sourcePhotoShowsDateVersionAndLiveWithoutDimensionsOrIds() {
        AssetSummary asset = new AssetSummary("internal-99", "photo", "ready", "2026-09-25T10:20:00Z",
                "12345", 7, 3840, 2160, true, true, null, null, "2.9", "inferred");
        String copy = PlayerFacingDetails.sourcePhoto(asset);
        assertTrue(copy.contains("拍摄时间"));
        assertTrue(copy.contains("游戏版本：2.9"));
        assertTrue(copy.contains("LIVE"));
        assertFalse(copy.contains("3840"));
        assertFalse(copy.contains("internal-99"));
    }

    @Test public void savedPhotoKeepsMissingFileAndRotationButHidesTechnicalFields() {
        SavedPhotoStore.Record record = new SavedPhotoStore.Record("internal-99", "content://saved/1",
                1_790_000_000_000L, false, 90, "2026-09-25T10:20:00Z", "2.9", "image/jpeg");
        String copy = PlayerFacingDetails.savedPhoto(record, true);
        assertTrue(copy.contains("文件不存在"));
        assertTrue(copy.contains("保存时间"));
        assertTrue(copy.contains("拍摄时间"));
        assertTrue(copy.contains("游戏版本：2.9"));
        assertTrue(copy.contains("旋转"));
        assertFalse(copy.contains("internal-99"));
        assertFalse(copy.contains("image/jpeg"));
    }

    @Test public void editedPhotoHidesFileNameMimeAndAssetId() {
        EditedVariantStore.Variant variant = new EditedVariantStore.Variant("v1", "internal-99",
                "content://saved/2", 1_790_000_000_000L, "DSC_1234.jpg", "image/jpeg", "content://saved/1");
        String copy = PlayerFacingDetails.editedPhoto(variant, false);
        assertTrue(copy.contains("关联时间"));
        assertFalse(copy.contains("DSC_1234.jpg"));
        assertFalse(copy.contains("image/jpeg"));
        assertFalse(copy.contains("internal-99"));
    }

    @Test public void unnamedOutfitNeverShowsNumericCode() {
        assertEquals("名称暂缺", PlayerFacingDetails.clothingName("", "104321"));
        assertEquals("名称暂缺", PlayerFacingDetails.clothingName("服装 104321", "104321"));
        assertEquals("名称暂缺", PlayerFacingDetails.clothingName("服装+104321", "104321"));
        assertEquals("星海长裙", PlayerFacingDetails.clothingName("星海长裙", "104321"));
    }
}
