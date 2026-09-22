package app.nikkisync.mobile.share;

import app.nikkisync.mobile.ui.SavedMetadataText;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class ShareCardPayloadBuilder {
    private static final Map<String, Integer> OUTFIT_ORDER = outfitOrder();

    private ShareCardPayloadBuilder() {}

    public static ShareCardPayload build(
            String assetId,
            String capturedAt,
            String gameVersion,
            String metadataJson
    ) {
        List<ShareCardPayload.Item> outfit = new ArrayList<>();
        List<ShareCardPayload.Item> camera = new ArrayList<>();
        List<ShareCardPayload.Item> effects = new ArrayList<>();

        if (metadataJson != null && !metadataJson.isBlank()) {
            try {
                JSONObject metadata = new JSONObject(metadataJson);
                readOutfit(metadata.optJSONObject("dressing"), outfit);
                readCamera(metadata.optJSONObject("camera"), camera);
                readEffect(metadata.optJSONObject("pose"), "动作", effects);
                readEffect(metadata.optJSONObject("action"), "动作", effects);
                readEffect(metadata.optJSONObject("lighting"), "光照", effects);
                readEffect(metadata.optJSONObject("filter"), "滤镜", effects);
            } catch (Exception ignored) {
                // A damaged optional metadata payload must not prevent exporting the photo.
            }
        }

        outfit.sort(Comparator.comparingInt(item -> outfitRank(item.label())));
        return new ShareCardPayload(assetId, capturedAt, gameVersion, outfit, camera, effects);
    }

    private static void readOutfit(JSONObject dressing, List<ShareCardPayload.Item> output) {
        JSONArray clothes = dressing == null ? null : dressing.optJSONArray("clothes");
        if (clothes == null) return;
        for (int i = 0; i < clothes.length(); i++) {
            JSONObject clothing = clothes.optJSONObject(i);
            if (clothing == null) continue;
            String id = stringValue(clothing.opt("id"));
            String name = clothing.optString("name", "").trim();
            if (name.isEmpty() && id.isEmpty()) continue;
            if (name.isEmpty()) name = "服装 " + id;
            String category = SavedMetadataText.categoryLabel(clothing.optString("category", "").trim());
            output.add(new ShareCardPayload.Item(category, name));
        }
    }

    private static void readCamera(JSONObject camera, List<ShareCardPayload.Item> output) {
        if (camera == null) return;
        add(output, camera, "focalLength", "焦距");
        add(output, camera, "rotation", "镜头旋转");
        add(output, camera, "aperture", "光圈");
        add(output, camera, "depthOfField", "景深");
        add(output, camera, "softLightStrength", "柔光强度");
        add(output, camera, "softLightRange", "柔光范围");
        add(output, camera, "brightness", "亮度");
        add(output, camera, "exposure", "曝光");
        add(output, camera, "contrast", "对比度");
        add(output, camera, "saturation", "饱和度");
        add(output, camera, "vibrance", "鲜艳度");
        add(output, camera, "highlights", "高光");
        add(output, camera, "shadows", "阴影");
    }

    private static void readEffect(JSONObject effect, String label, List<ShareCardPayload.Item> output) {
        if (effect == null || effect.length() == 0) return;
        String name = firstNonBlank(
                effect.optString("name", ""),
                effect.optString("displayName", ""),
                effect.optString("id", "")
        );
        String strength = stringValue(effect.opt("strength"));
        if (name.isEmpty() && strength.isEmpty()) return;
        String value = name;
        if (!strength.isEmpty()) value += (value.isEmpty() ? "" : " · ") + strength + "%";
        // Prefer the first canonical action/pose if both aliases are present.
        if ("动作".equals(label)) {
            for (ShareCardPayload.Item item : output) {
                if ("动作".equals(item.label())) return;
            }
        }
        output.add(new ShareCardPayload.Item(label, value));
    }

    private static void add(List<ShareCardPayload.Item> output, JSONObject object, String key, String label) {
        if (!object.has(key) || object.isNull(key)) return;
        String value = stringValue(object.opt(key));
        if (!value.isEmpty()) output.add(new ShareCardPayload.Item(label, value));
    }

    private static String stringValue(Object value) {
        if (value == null || value == JSONObject.NULL) return "";
        return String.valueOf(value).trim();
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) if (value != null && !value.isBlank()) return value.trim();
        return "";
    }

    private static int outfitRank(String label) {
        return OUTFIT_ORDER.getOrDefault(label, 10_000);
    }

    private static Map<String, Integer> outfitOrder() {
        String[] labels = {
                "发型", "连衣裙", "外套", "上衣", "下装", "袜子", "鞋子",
                "发饰", "帽子", "耳饰", "颈饰", "项圈", "腕饰", "手套",
                "面饰", "胸饰", "挂饰", "背饰", "戒指", "臂饰", "手持物",
                "全妆", "底妆", "眉妆", "睫毛", "美瞳", "唇妆", "肤色", "肤绘"
        };
        Map<String, Integer> order = new HashMap<>();
        for (int i = 0; i < labels.length; i++) order.put(labels[i], i);
        return order;
    }
}
