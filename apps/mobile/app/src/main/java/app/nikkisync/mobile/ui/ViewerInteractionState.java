package app.nikkisync.mobile.ui;

public final class ViewerInteractionState {
    private boolean chromeVisible = true;
    private float scale = 1f;

    public boolean isChromeVisible() { return chromeVisible; }

    public void toggleChrome() { chromeVisible = !chromeVisible; }

    public float scale() { return scale; }

    public void setScale(float value) {
        scale = Math.max(1f, Math.min(4f, value));
    }

    public void resetZoom() { scale = 1f; }

    public boolean canNavigate() { return scale <= 1.001f; }
}
