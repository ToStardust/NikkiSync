package app.nikkisync.mobile.ui;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class RotationSavePolicyTest {
    @Test public void preservesExistingSavePathAtZeroDegrees() {
        assertEquals(RotationSavePolicy.Mode.ORIGINAL, RotationSavePolicy.select(0, false));
        assertEquals(RotationSavePolicy.Mode.ORIGINAL, RotationSavePolicy.select(0, true));
    }

    @Test public void routesRotatedStillToDerivedExport() {
        assertEquals(RotationSavePolicy.Mode.ROTATED_STILL, RotationSavePolicy.select(90, false));
        assertEquals(RotationSavePolicy.Mode.ROTATED_STILL, RotationSavePolicy.select(180, false));
        assertEquals(RotationSavePolicy.Mode.ROTATED_STILL, RotationSavePolicy.select(270, false));
    }

    @Test public void blocksRotatedLiveUntilVendorPackagingIsVerified() {
        assertEquals(RotationSavePolicy.Mode.ROTATED_LIVE_UNSUPPORTED, RotationSavePolicy.select(90, true));
        assertEquals(RotationSavePolicy.Mode.ROTATED_LIVE_UNSUPPORTED, RotationSavePolicy.select(270, true));
    }
}
