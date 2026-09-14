package app.nikkisync.mobile.ui;

import app.nikkisync.mobile.model.Models.AssetSummary;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Pure presentation grouping that preserves the server's newest-first chronology. */
public final class GalleryVersionGroups {
    private static final String UNKNOWN_KEY = "__unknown__";

    private GalleryVersionGroups() {}

    public record Group(String version, String versionLabel, boolean inferred, List<AssetSummary> items) {}

    public static List<Group> group(List<AssetSummary> assets) {
        Map<String, List<AssetSummary>> grouped = new LinkedHashMap<>();
        for (AssetSummary asset : assets) {
            String version = normalizeVersion(asset.gameVersion());
            grouped.computeIfAbsent(version == null ? UNKNOWN_KEY : version, ignored -> new ArrayList<>()).add(asset);
        }

        List<Group> output = new ArrayList<>();
        for (Map.Entry<String, List<AssetSummary>> entry : grouped.entrySet()) {
            List<AssetSummary> items = entry.getValue();
            boolean unknown = UNKNOWN_KEY.equals(entry.getKey());
            boolean inferred = !unknown && !items.isEmpty()
                    && items.stream().allMatch(item -> "inferred".equals(item.gameVersionSource()));
            String version = unknown ? null : entry.getKey();
            String label = unknown ? "版本未知" : version + " 版本";
            output.add(new Group(version, label, inferred, List.copyOf(items)));
        }
        return List.copyOf(output);
    }

    static String normalizeVersion(String value) {
        if (value == null) return null;
        String normalized = value.trim();
        if (normalized.isEmpty()) return null;
        if ((normalized.startsWith("v") || normalized.startsWith("V")) && normalized.length() > 1) {
            normalized = normalized.substring(1).trim();
        }
        return normalized.isEmpty() ? null : normalized;
    }
}
