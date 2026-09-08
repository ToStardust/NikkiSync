package app.nikkisync.mobile.ui;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;

public final class ClothingPresentation {
    public record Item(String name, String thumbnailUrl) {}

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
                JSONObject item = clothes.optJSONObject(i);
                if (item == null) continue;
                String name = item.optString("name", "").trim();
                String thumbnail = item.optString("thumbnail", "").trim();
                if (name.isEmpty() || !isSafeHttpsUrl(thumbnail)) continue;
                items.add(new Item(name, thumbnail));
            }
            return List.copyOf(items);
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private static boolean isSafeHttpsUrl(String raw) {
        if (raw == null || raw.isBlank()) return false;
        try {
            URI uri = URI.create(raw);
            return "https".equalsIgnoreCase(uri.getScheme())
                    && uri.getHost() != null
                    && !uri.getHost().isBlank();
        } catch (Exception ignored) {
            return false;
        }
    }
}
