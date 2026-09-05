package app.nikkisync.mobile.ui;

public final class RotationDegrees {
    private RotationDegrees() {}

    public static int nextClockwise(int degrees) {
        return switch (sanitize(degrees)) {
            case 0 -> 90;
            case 90 -> 180;
            case 180 -> 270;
            default -> 0;
        };
    }

    public static int sanitize(int degrees) {
        return isValid(degrees) ? degrees : 0;
    }

    public static boolean isValid(int degrees) {
        return degrees == 0 || degrees == 90 || degrees == 180 || degrees == 270;
    }
}
