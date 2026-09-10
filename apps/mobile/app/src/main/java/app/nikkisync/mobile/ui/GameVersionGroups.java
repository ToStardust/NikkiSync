package app.nikkisync.mobile.ui;

import app.nikkisync.mobile.model.Models.AssetSummary;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class GameVersionGroups {
    private GameVersionGroups() {}

    public static final class Group {
        private final String version;
        private final boolean inferred;
        private final List<AssetSummary> items;

        private Group(String version, boolean inferred, List<AssetSummary> items) {
            this.version = version;
            this.inferred = inferred;
            this.items = List.copyOf(items);
        }

        public String version() { return version; }
        public boolean inferred() { return inferred; }
        public List<AssetSummary> items() { return items; }
    }

    public static List<Group> group(List<AssetSummary> assets) {
        Map<String, List<AssetSummary>> byVersion = new LinkedHashMap<>();
        List<AssetSummary> unknown = new ArrayList<>();

        for (AssetSummary asset : assets) {
            String version = normalizedVersion(asset.gameVersion());
            if (version == null) unknown.add(asset);
            else byVersion.computeIfAbsent(version, ignored -> new ArrayList<>()).add(asset);
        }

        List<String> versions = new ArrayList<>(byVersion.keySet());
        versions.sort(GameVersionGroups::compareVersionsNewestFirst);

        List<Group> result = new ArrayList<>();
        for (String version : versions) {
            List<AssetSummary> items = byVersion.get(version);
            items.sort(GameVersionGroups::compareCaptureTimeNewestFirst);
            boolean inferred = !items.isEmpty();
            for (AssetSummary item : items) {
                if (!"inferred".equals(item.gameVersionSource())) {
                    inferred = false;
                    break;
                }
            }
            result.add(new Group(version, inferred, items));
        }

        if (!unknown.isEmpty()) {
            unknown.sort(GameVersionGroups::compareCaptureTimeNewestFirst);
            result.add(new Group(null, false, unknown));
        }
        return List.copyOf(result);
    }

    private static String normalizedVersion(String version) {
        if (version == null) return null;
        String trimmed = version.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static int compareVersionsNewestFirst(String left, String right) {
        String[] a = left.split("\\.");
        String[] b = right.split("\\.");
        int length = Math.max(a.length, b.length);
        for (int i = 0; i < length; i++) {
            Integer av = segment(a, i);
            Integer bv = segment(b, i);
            if (av == null || bv == null) return right.compareTo(left);
            int comparison = Integer.compare(bv, av);
            if (comparison != 0) return comparison;
        }
        return 0;
    }

    private static Integer segment(String[] parts, int index) {
        if (index >= parts.length) return 0;
        try { return Integer.parseInt(parts[index]); }
        catch (NumberFormatException ignored) { return null; }
    }

    private static int compareCaptureTimeNewestFirst(AssetSummary left, AssetSummary right) {
        return captureInstant(right.capturedAt()).compareTo(captureInstant(left.capturedAt()));
    }

    private static Instant captureInstant(String value) {
        if (value == null || value.isBlank()) return Instant.MIN;
        try { return Instant.parse(value); }
        catch (DateTimeParseException ignored) { return Instant.MIN; }
    }
}
