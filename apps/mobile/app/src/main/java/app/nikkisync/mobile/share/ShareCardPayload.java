package app.nikkisync.mobile.share;

import java.util.List;

public record ShareCardPayload(
        String assetId,
        String capturedAt,
        String gameVersion,
        List<Item> outfitItems,
        List<Item> cameraItems,
        List<Item> effectItems
) {
    public ShareCardPayload {
        outfitItems = List.copyOf(outfitItems == null ? List.of() : outfitItems);
        cameraItems = List.copyOf(cameraItems == null ? List.of() : cameraItems);
        effectItems = List.copyOf(effectItems == null ? List.of() : effectItems);
    }

    public record Item(String label, String value) {
        public Item {
            label = label == null ? "" : label.trim();
            value = value == null ? "" : value.trim();
        }
    }
}
