package app.nikkisync.mobile.ui;

import android.content.Context;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.widget.ImageView;

public final class ZoomableImageView extends ImageView {
    public interface GestureListener {
        void onSingleTap();
        void onSwipeLeft();
        void onSwipeRight();
    }

    private final ViewerInteractionState state = new ViewerInteractionState();
    private final ScaleGestureDetector scaleDetector;
    private final GestureDetector gestureDetector;
    private GestureListener listener;
    private float translatedX;
    private float translatedY;

    public ZoomableImageView(Context context) {
        super(context);
        setScaleType(ScaleType.FIT_CENTER);
        scaleDetector = new ScaleGestureDetector(context, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override public boolean onScale(ScaleGestureDetector detector) {
                state.setScale(state.scale() * detector.getScaleFactor());
                if (state.scale() <= 1.001f) {
                    translatedX = 0f;
                    translatedY = 0f;
                }
                applyTransform();
                return true;
            }

            @Override public void onScaleEnd(ScaleGestureDetector detector) {
                if (state.scale() <= 1.001f) resetZoom();
            }
        });
        gestureDetector = new GestureDetector(context, new GestureDetector.SimpleOnGestureListener() {
            @Override public boolean onDown(MotionEvent event) { return true; }

            @Override public boolean onSingleTapConfirmed(MotionEvent event) {
                if (listener != null) listener.onSingleTap();
                return true;
            }

            @Override public boolean onDoubleTap(MotionEvent event) {
                if (state.scale() > 1.001f) resetZoom();
                else {
                    state.setScale(2.5f);
                    applyTransform();
                }
                return true;
            }

            @Override public boolean onScroll(MotionEvent first, MotionEvent current, float distanceX, float distanceY) {
                if (state.canNavigate()) return false;
                translatedX -= distanceX;
                translatedY -= distanceY;
                clampTranslation();
                applyTransform();
                return true;
            }

            @Override public boolean onFling(MotionEvent first, MotionEvent current, float velocityX, float velocityY) {
                if (!state.canNavigate() || listener == null) return false;
                if (Math.abs(velocityX) < 700f || Math.abs(velocityX) <= Math.abs(velocityY)) return false;
                if (velocityX < 0f) listener.onSwipeLeft();
                else listener.onSwipeRight();
                return true;
            }
        });
        setClickable(true);
    }

    public void setGestureListener(GestureListener listener) { this.listener = listener; }

    public float zoomScale() { return state.scale(); }

    public void resetZoom() {
        state.resetZoom();
        translatedX = 0f;
        translatedY = 0f;
        applyTransform();
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        scaleDetector.onTouchEvent(event);
        gestureDetector.onTouchEvent(event);
        return true;
    }

    @Override protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
        super.onSizeChanged(width, height, oldWidth, oldHeight);
        clampTranslation();
        applyTransform();
    }

    private void clampTranslation() {
        float extraX = Math.max(0f, getWidth() * (state.scale() - 1f) / 2f);
        float extraY = Math.max(0f, getHeight() * (state.scale() - 1f) / 2f);
        translatedX = Math.max(-extraX, Math.min(extraX, translatedX));
        translatedY = Math.max(-extraY, Math.min(extraY, translatedY));
    }

    private void applyTransform() {
        setScaleX(state.scale());
        setScaleY(state.scale());
        setTranslationX(translatedX);
        setTranslationY(translatedY);
    }
}
