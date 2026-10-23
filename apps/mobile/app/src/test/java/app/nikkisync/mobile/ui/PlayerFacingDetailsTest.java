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

    @Test public void plainScreenshotExplainsMissingDataWithoutClaimingAFormatOrProgram() {
        String notice=PlayerFacingDetails.metadataNotice(null);
        assertTrue(notice.contains("穿搭和拍摄参数"));assertTrue(notice.contains("普通截图或搬迁后的相册可能"));
        assertTrue(notice.contains("原游戏相册目录"));assertFalse(notice.contains("损坏"));
        assertEquals(notice,PlayerFacingDetails.metadataNotice("{\"camera\":{},\"dressing\":{\"clothes\":[]}}"));
    }

    @Test public void knownNativeDataAndResolverFailureAreUnparsedRatherThanLost() {
        for(String raw:new String[]{"{\"nativeParamToken\":\"private-token\"}","{\"sourceParametersPresent\":true}","{\"resolver\":{\"status\":\"failed\",\"error\":\"private-error\"}}"}) {
            String notice=PlayerFacingDetails.metadataNotice("{\"raw\":"+raw+"}");
            assertTrue(notice.contains("尚未解析完整"));assertTrue(notice.contains("在线参数解析"));
            assertFalse(notice.contains("缺少原始数据"));assertFalse(notice.contains("private"));
        }
    }

    @Test public void partiallyDecodedMetadataKeepsTheCorrectExplanation() {
        String notice=PlayerFacingDetails.metadataNotice("{\"camera\":{\"focalLength\":50},\"raw\":{\"resolver\":{\"status\":\"resolved\"}}}");
        assertTrue(notice.startsWith("穿搭数据未能完整读取"));assertFalse(notice.contains("联网"));assertFalse(notice.contains("缺少原始数据"));
        String partial=PlayerFacingDetails.metadataNotice("{\"dressing\":{\"clothes\":[{\"id\":\"123\"}]}}");
        assertTrue(partial.startsWith("部分拍摄参数"));
    }

    @Test public void decodedIdsWithoutNamesOrIconsAreNotMissingOutfitData() {
        assertEquals("",PlayerFacingDetails.metadataNotice("{\"camera\":{\"exposure\":0},\"dressing\":{\"clothes\":[{\"id\":\"123\"}]}}"));
    }

    @Test public void corruptMetadataOffersResyncRatherThanAFalseMissingSourceDiagnosis() {
        String notice=PlayerFacingDetails.metadataNotice("{broken");assertTrue(notice.contains("重新同步"));assertFalse(notice.contains("普通截图"));
    }
}
