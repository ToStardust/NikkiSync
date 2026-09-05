package app.nikkisync.mobile.ui;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class RotationFitTest {
    @Test public void quarterTurnSwapsBoundsAndFitsPortraitViewportWithoutClipping() {
        RotationFit.Result fit = RotationFit.calculate(1920, 1080, 1080, 1920, 90);

        assertEquals(1080, fit.rotatedWidth());
        assertEquals(1920, fit.rotatedHeight());
        assertEquals(1.0, fit.scale(), 0.0001);
        assertEquals(0.0, fit.offsetX(), 0.0001);
        assertEquals(0.0, fit.offsetY(), 0.0001);
    }

    @Test public void unrotatedLandscapeImageIsLetterboxedInPortraitViewport() {
        RotationFit.Result fit = RotationFit.calculate(1920, 1080, 1080, 1920, 0);

        assertEquals(1920, fit.rotatedWidth());
        assertEquals(1080, fit.rotatedHeight());
        assertEquals(0.5625, fit.scale(), 0.0001);
        assertEquals(0.0, fit.offsetX(), 0.0001);
        assertEquals(656.25, fit.offsetY(), 0.0001);
    }

    @Test public void twoHundredSeventyDegreesUsesTheSameSwappedBounds() {
        RotationFit.Result fit = RotationFit.calculate(4000, 3000, 1000, 1000, 270);

        assertEquals(3000, fit.rotatedWidth());
        assertEquals(4000, fit.rotatedHeight());
        assertEquals(0.25, fit.scale(), 0.0001);
        assertEquals(125.0, fit.offsetX(), 0.0001);
        assertEquals(0.0, fit.offsetY(), 0.0001);
    }
}
