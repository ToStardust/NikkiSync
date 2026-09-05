package app.nikkisync.mobile.ui;

import android.content.Context;
import android.graphics.Matrix;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;
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

    private final ViewerInteractionState state;
    private final ScaleGestureDetector scaleDetector;
    private final GestureDetector gestureDetector;
    private GestureListener listener;
    private float translatedX;
    private float translatedY;
    private int quarterRotationDegrees;

    public ZoomableImageView(Context context) {
        this(context, new ViewerInteractionState());
    }

    public ZoomableImageView(Context context, ViewerInteractionState state) {
        super(context);
        this.state = state;
        setScaleType(ScaleType.MATRIX);
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

    public int quarterRotationDegrees() { return quarterRotationDegrees; }

    public void setQuarterRotationDegrees(int degrees) {
        if (!RotationDegrees.isValid(degrees)) {
            throw new IllegalArgumentException("rotation must be 0, 90, 180, or 270 degrees");
        }
        if (quarterRotationDegrees == degrees) {
            applyBaseImageMatrix();
            return;
        }
        quarterRotationDegrees = degrees;
        resetZoom();
        applyBaseImageMatrix();
    }

    public void resetZoom() {
        state.resetZoom();
        translatedX = 0f;
        translatedY = 0f;
        applyTransform();
    }

    @Override public void setImageDrawable(Drawable drawable) {
        super.setImageDrawable(drawable);
        post(this::applyBaseImageMatrix);
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        scaleDetector.onTouchEvent(event);
        gestureDetector.onTouchEvent(event);
        return true;
    }

    @Override protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
        super.onSizeChanged(width, height, oldWidth, oldHeight);
        applyBaseImageMatrix();
        clampTranslation();
        applyTransform();
    }

    private void applyBaseImageMatrix() {
        Drawable drawable = getDrawable();
        if (drawable == null || getWidth() <= 0 || getHeight() <= 0) return;
        int sourceWidth = drawable.getIntrinsicWidth();
        int sourceHeight = drawable.getIntrinsicHeight();
        if (sourceWidth <= 0 || sourceHeight <= 0) return;

        RotationFit.Result fit = RotationFit.calculate(
                sourceWidth,
                sourceHeight,
                getWidth(),
                getHeight(),
                quarterRotationDegrees
        );
        Matrix matrix = new Matrix();
        matrix.setRotate(quarterRotationDegrees, sourceWidth / 2f, sourceHeight / 2f);
        RectF rotatedBounds = new RectF(0f, 0f, sourceWidth, sourceHeight);
        matrix.mapRect(rotatedBounds);
        matrix.postTranslate(-rotatedBounds.left, -rotatedBounds.top);
        matrix.postScale((float) fit.scale(), (float) fit.scale());
        matrix.postTranslate((float) fit.offsetX(), (float) fit.offsetY());
        setImageMatrix(matrix);
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
