package app.nikkisync.mobile.ui;

public final class RotationFit {
    public static final class Result {
        private final int rotatedWidth;
        private final int rotatedHeight;
        private final double scale;
        private final double offsetX;
        private final double offsetY;

        private Result(int rotatedWidth, int rotatedHeight, double scale, double offsetX, double offsetY) {
            this.rotatedWidth = rotatedWidth;
            this.rotatedHeight = rotatedHeight;
            this.scale = scale;
            this.offsetX = offsetX;
            this.offsetY = offsetY;
        }

        public int rotatedWidth() { return rotatedWidth; }
        public int rotatedHeight() { return rotatedHeight; }
        public double scale() { return scale; }
        public double offsetX() { return offsetX; }
        public double offsetY() { return offsetY; }
    }

    private RotationFit() {}

    public static Result calculate(
            int sourceWidth,
            int sourceHeight,
            int viewportWidth,
            int viewportHeight,
            int degrees
    ) {
        if (sourceWidth <= 0 || sourceHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
            throw new IllegalArgumentException("source and viewport dimensions must be positive");
        }
        if (!RotationDegrees.isValid(degrees)) {
            throw new IllegalArgumentException("rotation must be 0, 90, 180, or 270 degrees");
        }

        boolean swapsBounds = degrees == 90 || degrees == 270;
        int rotatedWidth = swapsBounds ? sourceHeight : sourceWidth;
        int rotatedHeight = swapsBounds ? sourceWidth : sourceHeight;
        double scale = Math.min(
                (double) viewportWidth / rotatedWidth,
                (double) viewportHeight / rotatedHeight
        );
        double fittedWidth = rotatedWidth * scale;
        double fittedHeight = rotatedHeight * scale;
        double offsetX = (viewportWidth - fittedWidth) / 2.0;
        double offsetY = (viewportHeight - fittedHeight) / 2.0;
        return new Result(rotatedWidth, rotatedHeight, scale, offsetX, offsetY);
    }
}
