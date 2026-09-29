package app.nikkisync.mobile.inspiration;

import static org.junit.Assert.*;

import android.view.View;
import android.view.ViewGroup;
import android.content.Intent;
import android.os.Looper;
import android.widget.TextView;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.shadows.ShadowAlertDialog;

@RunWith(RobolectricTestRunner.class)
public final class InspirationActivityTest {
    @Test public void notebookOpensOfflineWithoutPairingOrGalleryState() {
        var controller = Robolectric.buildActivity(InspirationActivity.class).setup();
        try {
            assertTrue(containsText(controller.get().getWindow().getDecorView(), "穿搭灵感库"));
            assertTrue(containsText(controller.get().getWindow().getDecorView(), "记录新的灵感"));
        } finally { controller.pause().stop().destroy(); }
    }

    @Test public void androidShareOpensAnEditableDraftWithOriginalText() {
        Intent share = new Intent(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, "  OUTFIT-123  ");
        var controller = Robolectric.buildActivity(InspirationActivity.class, share).setup();
        try {
            Shadows.shadowOf(Looper.getMainLooper()).idle();
            var dialog = ShadowAlertDialog.getLatestAlertDialog();
            assertNotNull(dialog);
            assertTrue(dialog.isShowing());
            assertTrue(containsText(dialog.getWindow().getDecorView(), "  OUTFIT-123  "));
        } finally { controller.pause().stop().destroy(); }
    }

    private static boolean containsText(View view, String expected) {
        if (view instanceof TextView text && text.getText().toString().contains(expected)) return true;
        if (view instanceof ViewGroup group) for (int i = 0; i < group.getChildCount(); i++)
            if (containsText(group.getChildAt(i), expected)) return true;
        return false;
    }
}
