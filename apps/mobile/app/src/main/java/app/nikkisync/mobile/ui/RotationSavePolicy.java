package app.nikkisync.mobile.ui;

public final class RotationSavePolicy {
    public enum Mode {
        ORIGINAL,
        ROTATED_STILL,
        ROTATED_LIVE_UNSUPPORTED
    }

    private RotationSavePolicy() {}

    public static Mode select(int degrees, boolean hasMotion) {
        int sanitized = RotationDegrees.sanitize(degrees);
        if (sanitized == 0) return Mode.ORIGINAL;
        return hasMotion ? Mode.ROTATED_LIVE_UNSUPPORTED : Mode.ROTATED_STILL;
    }
}
