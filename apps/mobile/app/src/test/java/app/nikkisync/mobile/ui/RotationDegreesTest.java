package app.nikkisync.mobile.ui;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class RotationDegreesTest {
    @Test public void cyclesClockwiseThroughQuarterTurns() {
        assertEquals(90, RotationDegrees.nextClockwise(0));
        assertEquals(180, RotationDegrees.nextClockwise(90));
        assertEquals(270, RotationDegrees.nextClockwise(180));
        assertEquals(0, RotationDegrees.nextClockwise(270));
    }

    @Test public void sanitizesPersistedGarbageBackToOriginalOrientation() {
        assertEquals(0, RotationDegrees.sanitize(-90));
        assertEquals(0, RotationDegrees.sanitize(45));
        assertEquals(0, RotationDegrees.sanitize(360));
        assertEquals(270, RotationDegrees.sanitize(270));
    }
}
