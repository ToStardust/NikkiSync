package app.nikkisync.mobile.ui;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class ViewerInteractionStateTest {
    @Test public void chromeStartsVisibleAndCanBeToggled() {
        ViewerInteractionState state = new ViewerInteractionState();

        assertTrue(state.isChromeVisible());
        state.toggleChrome();
        assertFalse(state.isChromeVisible());
        state.toggleChrome();
        assertTrue(state.isChromeVisible());
    }

    @Test public void navigationIsBlockedWhileZoomedAndReturnsAfterReset() {
        ViewerInteractionState state = new ViewerInteractionState();

        assertTrue(state.canNavigate());
        state.setScale(2.25f);
        assertFalse(state.canNavigate());

        state.resetZoom();
        assertTrue(state.canNavigate());
        assertTrue(Math.abs(state.scale() - 1f) < 0.001f);
    }

    @Test public void scaleIsClampedToViewerLimits() {
        ViewerInteractionState state = new ViewerInteractionState();

        state.setScale(0.2f);
        assertTrue(Math.abs(state.scale() - 1f) < 0.001f);
        state.setScale(9f);
        assertTrue(Math.abs(state.scale() - 4f) < 0.001f);
    }
}
