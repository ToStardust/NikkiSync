package app.nikkisync.mobile.media;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public final class RotatedExportSpecTest {
    @Test public void namesJpegExportsDistinctlyFromTheOriginal() {
        RotatedExportSpec spec = RotatedExportSpec.forSource("IMG_0001.JPG", "image/jpeg", 90);

        assertEquals("IMG_0001_rotated_90.jpg", spec.fileName());
        assertEquals("image/jpeg", spec.mimeType());
        assertEquals(95, spec.quality());
    }

    @Test public void preservesPngAsPngForLosslessQuarterTurnExport() {
        RotatedExportSpec spec = RotatedExportSpec.forSource("snapshot.png", "image/png", 270);

        assertEquals("snapshot_rotated_270.png", spec.fileName());
        assertEquals("image/png", spec.mimeType());
        assertEquals(100, spec.quality());
    }

    @Test public void refusesZeroDegreeBecauseThatMustUseOriginalSaver() {
        assertThrows(IllegalArgumentException.class,
                () -> RotatedExportSpec.forSource("photo.jpg", "image/jpeg", 0));
    }
}
