package app.nikkisync.mobile.ui;

import app.nikkisync.mobile.model.Models.AssetSummary;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Pure presentation grouping for the version-first gallery home. */
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
            List<AssetSummary> items = new ArrayList<>(entry.getValue());
            items.sort(Comparator
                    .comparing(AssetSummary::capturedAt, Comparator.nullsLast(Comparator.reverseOrder()))
                    .thenComparing(AssetSummary::assetId));
            boolean unknown = UNKNOWN_KEY.equals(entry.getKey());
            boolean inferred = !unknown && items.stream().anyMatch(item -> "inferred".equals(item.gameVersionSource()));
            String version = unknown ? null : entry.getKey();
            String label = unknown ? "版本未知" : version + " 版本";
            output.add(new Group(version, label, inferred, List.copyOf(items)));
        }

        output.sort((left, right) -> {
            if (left.version() == null && right.version() == null) return 0;
            if (left.version() == null) return 1;
            if (right.version() == null) return -1;
            return -compareSemanticVersions(left.version(), right.version());
        });
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

    /** Ascending semantic comparison; callers reverse it when newest-first ordering is required. */
    public static int compareSemanticVersions(String left, String right) {
        String[] a = normalizeVersion(left).split("\\.");
        String[] b = normalizeVersion(right).split("\\.");
        int length = Math.max(a.length, b.length);
        for (int i = 0; i < length; i++) {
            Integer av = i < a.length ? numericSegment(a[i]) : 0;
            Integer bv = i < b.length ? numericSegment(b[i]) : 0;
            if (av == null || bv == null) return left.compareToIgnoreCase(right);
            int compared = Integer.compare(av, bv);
            if (compared != 0) return compared;
        }
        return 0;
    }

    private static Integer numericSegment(String value) {
        if (value == null || value.isEmpty()) return 0;
        for (int i = 0; i < value.length(); i++) if (!Character.isDigit(value.charAt(i))) return null;
        try { return Integer.parseInt(value); }
        catch (NumberFormatException ignored) { return null; }
    }
}
