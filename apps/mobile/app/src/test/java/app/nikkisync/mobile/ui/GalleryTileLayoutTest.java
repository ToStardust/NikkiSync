package app.nikkisync.mobile.ui;

import static org.junit.Assert.assertEquals;

import android.app.Activity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public final class GalleryTileLayoutTest {
    @Test public void selectionOutlineUsesExactlyThePhotoRadiusAndBounds() {
        var activity=Robolectric.buildActivity(Activity.class).setup().get();
        GalleryAdapter adapter=new GalleryAdapter(activity,null,()->null,null);
        ViewGroup tile=(ViewGroup)adapter.onCreateViewHolder(new FrameLayout(activity),1).itemView;
        tile.getChildAt(1).setVisibility(View.VISIBLE);
        checkWidths(tile,true);
        View image=tile.getChildAt(0),selection=tile.getChildAt(1);
        android.graphics.Outline photo=new android.graphics.Outline(),selected=new android.graphics.Outline();
        image.getBackground().getOutline(photo);selection.getBackground().getOutline(selected);
        assertEquals(photo.getRadius(),selected.getRadius(),.01f);
        assertEquals(image.getLeft(),selection.getLeft());assertEquals(image.getRight(),selection.getRight());
        assertEquals(image.getTop(),selection.getTop());assertEquals(image.getBottom(),selection.getBottom());
        activity.finish();
    }
    @Test public void galleryPhotoAndSelectionStaySquareAfterWidthChanges() {
        var controller = Robolectric.buildActivity(Activity.class).setup();
        try {
            Activity activity = controller.get();
            GalleryAdapter adapter = new GalleryAdapter(activity, null, () -> null, null);
            ViewGroup tile = (ViewGroup) adapter.onCreateViewHolder(new FrameLayout(activity), 1).itemView;
            checkWidths(tile, true);
        } finally { controller.pause().stop().destroy(); }
    }

    @Test public void savedPhotosUseTheSameSquareGeometry() {
        var controller = Robolectric.buildActivity(Activity.class).setup();
        SavedPhotoAdapter adapter = new SavedPhotoAdapter(controller.get(), null);
        try {
            ViewGroup tile = (ViewGroup) adapter.onCreateViewHolder(new FrameLayout(controller.get()), 1).itemView;
            checkWidths(tile, false);
        } finally { adapter.shutdown(); controller.pause().stop().destroy(); }
    }

    private void checkWidths(ViewGroup tile, boolean selection) {
        for (int width : new int[]{94, 132, 210}) {
            tile.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
            tile.layout(0, 0, tile.getMeasuredWidth(), tile.getMeasuredHeight());
            assertEquals("square cell after changing width", width, tile.getMeasuredHeight());
            View image = tile.getChildAt(0);
            assertEquals("photo stays square", image.getMeasuredWidth(), image.getMeasuredHeight());
            if (selection) {
                View overlay = tile.getChildAt(1);
                assertEquals("selection bounds follow photo", image.getLayoutParams().height, overlay.getLayoutParams().height);
            }
        }
    }
}
