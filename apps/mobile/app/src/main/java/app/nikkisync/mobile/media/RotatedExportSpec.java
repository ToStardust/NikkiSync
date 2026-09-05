package app.nikkisync.mobile.media;

import app.nikkisync.mobile.ui.RotationDegrees;

public final class RotatedExportSpec {
    private final String fileName;
    private final String mimeType;
    private final int quality;

    private RotatedExportSpec(String fileName, String mimeType, int quality) {
        this.fileName = fileName;
        this.mimeType = mimeType;
        this.quality = quality;
    }

    public String fileName() { return fileName; }
    public String mimeType() { return mimeType; }
    public int quality() { return quality; }

    public static RotatedExportSpec forSource(String sourceFileName, String sourceMimeType, int degrees) {
        if (!RotationDegrees.isValid(degrees) || degrees == 0) {
            throw new IllegalArgumentException("rotated export requires 90, 180, or 270 degrees");
        }
        boolean png = "image/png".equalsIgnoreCase(sourceMimeType);
        String base = baseName(sourceFileName);
        return new RotatedExportSpec(
                base + "_rotated_" + degrees + (png ? ".png" : ".jpg"),
                png ? "image/png" : "image/jpeg",
                png ? 100 : 95
        );
    }

    private static String baseName(String sourceFileName) {
        if (sourceFileName == null || sourceFileName.isBlank()) return "NikkiSync";
        String value = sourceFileName.trim();
        int slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
        if (slash >= 0 && slash + 1 < value.length()) value = value.substring(slash + 1);
        int dot = value.lastIndexOf('.');
        if (dot > 0) value = value.substring(0, dot);
        return value.isBlank() ? "NikkiSync" : value;
    }
}
