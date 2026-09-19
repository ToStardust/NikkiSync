package app.nikkisync.mobile.ui;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Human-readable canonical Infinity Nikki metadata used by source and Saved details. */
public final class SavedMetadataText {
    private SavedMetadataText() {}

    public static String summary(String metadataJson) {
        if (metadataJson == null || metadataJson.isBlank()) {
            return "暖暖原生参数：未检测到\nNikkiSync 参数：暂无";
        }
        try {
            JSONObject metadata = new JSONObject(metadataJson);
            JSONObject raw = metadata.optJSONObject("raw");
            JSONObject camera = metadata.optJSONObject("camera");
            JSONObject filter = metadata.optJSONObject("filter");
            JSONObject lighting = metadata.optJSONObject("lighting");
            JSONObject dressing = metadata.optJSONObject("dressing");
            JSONArray clothes = dressing == null ? null : dressing.optJSONArray("clothes");
            JSONObject resolver = raw == null ? null : raw.optJSONObject("resolver");
            boolean nativeDetected = raw != null && raw.optString("nativeParamToken", "").length() == 44;

            StringBuilder out = new StringBuilder();
            out.append(nativeDetected ? "暖暖原生参数：已读取" : "暖暖原生参数：未检测到");
            boolean hasCanonical = camera != null && camera.length() > 0;
            if (hasCanonical) {
                appendParam(out, camera, "focalLength", "焦距");
                appendParam(out, camera, "exposure", "曝光");
                appendParam(out, camera, "brightness", "亮度");
                appendParam(out, camera, "contrast", "对比度");
                appendParam(out, camera, "saturation", "饱和度");
                appendParam(out, camera, "vibrance", "鲜艳度");
                appendParam(out, camera, "highlights", "高光");
                appendParam(out, camera, "shadows", "阴影");
            }
            if (filter != null && filter.length() > 0) {
                hasCanonical = true;
                appendMetadataIdStrength(out, filter, "滤镜");
            }
            if (lighting != null && lighting.length() > 0) {
                hasCanonical = true;
                appendMetadataIdStrength(out, lighting, "光照");
            }
            if (clothes != null && clothes.length() > 0) {
                hasCanonical = true;
                out.append("\n穿搭：").append(clothes.length()).append(" 件");
            }
            if (hasCanonical) return out.toString();

            String resolverStatus = resolver == null ? "" : resolver.optString("status", "");
            if ("resolved".equals(resolverStatus)) return out.append("\nNikkiSync 参数：已解析").toString();
            if ("failed".equals(resolverStatus)) {
                String reason = resolver.optString("error", "解析失败")
                        .replace('\n', ' ')
                        .replace('\r', ' ')
                        .trim();
                if (reason.length() > 80) reason = reason.substring(0, 80);
                return out.append("\nNikkiSync 参数：解析失败")
                        .append(reason.isEmpty() ? "" : "（" + reason + "）")
                        .toString();
            }
            return out.append(nativeDetected ? "\nNikkiSync 参数：解析中" : "\nNikkiSync 参数：暂无").toString();
        } catch (Exception error) {
            String reason = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            return "参数数据损坏：" + reason;
        }
    }

    public static List<String> clothingLines(String metadataJson) {
        if (metadataJson == null || metadataJson.isBlank()) return List.of();
        try {
            JSONObject metadata = new JSONObject(metadataJson);
            JSONObject dressing = metadata.optJSONObject("dressing");
            JSONArray clothes = dressing == null ? null : dressing.optJSONArray("clothes");
            if (clothes == null || clothes.length() == 0) return List.of();

            List<String> result = new ArrayList<>();
            for (int i = 0; i < clothes.length(); i++) {
                JSONObject clothing = clothes.optJSONObject(i);
                if (clothing == null || !clothing.has("id") || clothing.isNull("id")) continue;
                String id = String.valueOf(clothing.opt("id")).trim();
                if (id.isEmpty()) continue;
                String name = clothing.optString("name", "").trim();
                if (name.isEmpty()) name = "服装 " + id;
                String category = clothing.optString("category", "").trim();
                result.add(name + " · " + categoryLabel(category) + " · ID " + id);
            }
            return List.copyOf(result);
        } catch (Exception ignored) {
            return List.of();
        }
    }

    public static String categoryLabel(String category) {
        if (category == null) category = "";
        return switch (category) {
            case "hair" -> "发型";
            case "dresses" -> "连衣裙";
            case "outerwear" -> "外套";
            case "tops" -> "上衣";
            case "bottoms" -> "下装";
            case "socks" -> "袜子";
            case "shoes" -> "鞋子";
            case "hairAccessories" -> "发饰";
            case "headwear" -> "帽子";
            case "earrings" -> "耳饰";
            case "neckwear" -> "颈饰";
            case "bracelets" -> "腕饰";
            case "chokers" -> "项圈";
            case "gloves" -> "手套";
            case "faceDecorations" -> "面饰";
            case "chestAccessories" -> "胸饰";
            case "pendants" -> "挂饰";
            case "backpieces" -> "背饰";
            case "rings" -> "戒指";
            case "armDecorations" -> "臂饰";
            case "handhelds" -> "手持物";
            case "bodyPaint" -> "肤绘";
            case "fullMakeup" -> "全妆";
            case "baseMakeup" -> "底妆";
            case "eyebrows" -> "眉妆";
            case "eyelashes" -> "睫毛";
            case "contacts" -> "美瞳";
            case "lips" -> "唇妆";
            case "skinTones" -> "肤色";
            default -> category.isEmpty() ? "未知部位" : category;
        };
    }

    private static void appendMetadataIdStrength(StringBuilder out, JSONObject object, String label) {
        String id = object.optString("id", "").trim();
        String strength = object.has("strength") && !object.isNull("strength")
                ? String.valueOf(object.opt("strength"))
                : "";
        if (id.isEmpty() && strength.isEmpty()) return;
        out.append("\n").append(label).append("：");
        if (!id.isEmpty()) out.append(id);
        if (!strength.isEmpty()) out.append(id.isEmpty() ? "" : " · ").append("强度 ").append(strength);
    }

    private static void appendParam(StringBuilder out, JSONObject object, String key, String label) {
        if (object.has(key) && !object.isNull(key)) {
            out.append("\n").append(label).append("：").append(object.opt(key));
        }
    }
}
