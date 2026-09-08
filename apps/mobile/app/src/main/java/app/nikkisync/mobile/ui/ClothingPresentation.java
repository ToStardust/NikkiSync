package app.nikkisync.mobile.ui;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;

public final class ClothingPresentation {
    public record Item(String displayName, String thumbnailUrl) {}

    private ClothingPresentation() {}

    public static List<Item> fromMetadataJson(String metadataJson) {
        if (metadataJson == null || metadataJson.isBlank()) return List.of();
        try {
            JSONObject metadata = new JSONObject(metadataJson);
            JSONObject dressing = metadata.optJSONObject("dressing");
            if (dressing == null) return List.of();
            JSONArray clothes = dressing.optJSONArray("clothes");
            if (clothes == null || clothes.length() == 0) return List.of();

            List<Item> items = new ArrayList<>();
            for (int i = 0; i < clothes.length(); i++) {
                JSONObject clothing = clothes.optJSONObject(i);
                if (clothing == null) continue;
                String name = clothing.optString("name", "").trim();
                if (name.isEmpty()) name = "未命名服装";
                items.add(new Item(name, safeHttpsUrl(clothing.optString("thumbnail", null))));
            }
            return List.copyOf(items);
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private static String safeHttpsUrl(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            URI uri = URI.create(value.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme())) return null;
            if (uri.getHost() == null || uri.getHost().isBlank()) return null;
            return uri.toString();
        } catch (Exception ignored) {
            return null;
        }
    }
}
