package app.nikkisync.mobile.ui;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public final class MetadataPresentation {
    private final String summary;
    private final String technicalDetails;

    private MetadataPresentation(String summary, String technicalDetails) {
        this.summary = summary;
        this.technicalDetails = technicalDetails;
    }

    public String summary() { return summary; }
    public String technicalDetails() { return technicalDetails; }

    public static MetadataPresentation fromMetadataJson(String metadataJson, Integer width, Integer height) {
        return fromMetadataJson(metadataJson, width, height, null);
    }

    public static MetadataPresentation fromMetadataJson(
            String metadataJson,
            Integer width,
            Integer height,
            String capturedAtFallback
    ) {
        List<String> lines = new ArrayList<>();
        if (width != null && height != null) lines.add("分辨率：" + width + " × " + height);

        if (metadataJson == null || metadataJson.isBlank()) {
            appendFallbackCapturedAt(lines, capturedAtFallback);
            if (lines.isEmpty()) lines.add("暂无可显示的照片参数");
            return new MetadataPresentation(String.join("\n", lines), "暂无技术详情");
        }

        try {
            JSONObject metadata = new JSONObject(metadataJson);
            JSONObject capture = metadata.optJSONObject("capture");
            boolean hasCapturedAt = capture != null && !capture.optString("capturedAt", "").trim().isEmpty();
            appendNamedValue(lines, capture, "capturedAt", "拍摄时间");
            if (!hasCapturedAt) appendFallbackCapturedAt(lines, capturedAtFallback);

            JSONObject location = metadata.optJSONObject("location");
            appendNamedValue(lines, location, "name", "地点");

            JSONObject dressing = metadata.optJSONObject("dressing");
            if (dressing != null) {
                appendCollection(lines, dressing.optJSONArray("clothes"), "服装");
                appendCollection(lines, dressing.optJSONArray("eureka"), "奇想星");
            }

            appendNamedObject(lines, metadata.optJSONObject("filter"), "滤镜");
            appendNamedObject(lines, metadata.optJSONObject("lighting"), "灯光");

            JSONObject camera = metadata.optJSONObject("camera");
            if (camera != null) {
                appendCamera(lines, camera, "focalLength", "焦距");
                appendCamera(lines, camera, "apertureSection", "光圈档位");
                appendCamera(lines, camera, "exposure", "曝光");
                appendCamera(lines, camera, "brightness", "亮度");
                appendCamera(lines, camera, "contrast", "对比度");
                appendCamera(lines, camera, "saturation", "饱和度");
                appendCamera(lines, camera, "vibrance", "鲜艳度");
                appendCamera(lines, camera, "highlights", "高光");
                appendCamera(lines, camera, "shadows", "阴影");
                appendCamera(lines, camera, "vignetteIntensity", "暗角");
                appendCamera(lines, camera, "bloomIntensity", "辉光");
                appendCamera(lines, camera, "bloomThreshold", "辉光阈值");
                appendCamera(lines, camera, "portraitMode", "人像模式");
            }

            if (lines.isEmpty()) lines.add("暂无可显示的照片参数");
            return new MetadataPresentation(String.join("\n", lines), metadata.toString(2));
        } catch (Exception error) {
            appendFallbackCapturedAt(lines, capturedAtFallback);
            lines.add("照片参数读取失败");
            return new MetadataPresentation(String.join("\n", lines), "原始参数无法解析");
        }
    }

    private static void appendFallbackCapturedAt(List<String> lines, String capturedAtFallback) {
        if (capturedAtFallback == null || capturedAtFallback.isBlank()) return;
        lines.add("拍摄时间：" + capturedAtFallback.trim());
    }

    private static void appendNamedValue(List<String> lines, JSONObject object, String key, String label) {
        if (object == null || !object.has(key) || object.isNull(key)) return;
        String value = object.optString(key, "").trim();
        if (!value.isEmpty()) lines.add(label + "：" + value);
    }

    private static void appendNamedObject(List<String> lines, JSONObject object, String label) {
        if (object == null) return;
        String name = object.optString("name", "").trim();
        if (name.isEmpty()) return;
        String text = label + "：" + name;
        if (object.has("strength") && !object.isNull("strength")) text += " · 强度 " + object.opt("strength");
        lines.add(text);
    }

    private static void appendCollection(List<String> lines, JSONArray array, String label) {
        if (array == null || array.length() == 0) return;
        List<String> names = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            JSONObject item = array.optJSONObject(i);
            if (item == null) continue;
            String name = item.optString("name", "").trim();
            if (!name.isEmpty()) names.add(name);
        }
        String text = label + " " + array.length() + " 件";
        if (!names.isEmpty()) text += " · " + String.join("、", names);
        lines.add(text);
    }

    private static void appendCamera(List<String> lines, JSONObject camera, String key, String label) {
        if (!camera.has(key) || camera.isNull(key)) return;
        lines.add(label + "：" + camera.opt(key));
    }
}
