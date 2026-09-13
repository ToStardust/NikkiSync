package app.nikkisync.mobile.storage;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import app.nikkisync.mobile.model.Models.AssetSummary;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public final class SavedPhotoStore {
    private static final String PREFS = "nikkisync_saved_photos";
    private static final String KEY_RECORDS = "records";
    private static final int LIMIT = 2000;

    public static final class Record {
        private final String assetId, uri, capturedAt, gameVersion, format;
        private final long savedAt;
        private final boolean hasMotion;
        private final int rotationDegrees;

        public Record(String assetId, String uri, long savedAt, boolean hasMotion, int rotationDegrees,
                      String capturedAt, String gameVersion, String format) {
            this.assetId = assetId;
            this.uri = uri;
            this.savedAt = savedAt;
            this.hasMotion = hasMotion;
            this.rotationDegrees = rotationDegrees;
            this.capturedAt = capturedAt;
            this.gameVersion = gameVersion;
            this.format = format;
        }

        public String assetId() { return assetId; }
        public String uri() { return uri; }
        public long savedAt() { return savedAt; }
        public boolean hasMotion() { return hasMotion; }
        public int rotationDegrees() { return rotationDegrees; }
        public String capturedAt() { return capturedAt; }
        public String gameVersion() { return gameVersion; }
        public String format() { return format; }
        public Uri mediaUri() { return Uri.parse(uri); }
    }

    private final SharedPreferences prefs;

    public SavedPhotoStore(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized void record(AssetSummary asset, Uri uri, int rotationDegrees, String format) {
        List<Record> next = load();
        String uriText = uri.toString();
        next.removeIf(record -> uriText.equals(record.uri()));
        next.add(new Record(
                asset.assetId(),
                uriText,
                System.currentTimeMillis(),
                asset.hasMotion(),
                rotationDegrees,
                asset.capturedAt(),
                asset.gameVersion(),
                format
        ));
        next.sort(Comparator.comparingLong(Record::savedAt).reversed());
        if (next.size() > LIMIT) next = new ArrayList<>(next.subList(0, LIMIT));
        save(next);
    }

    public synchronized List<Record> load() {
        List<Record> records = new ArrayList<>();
        String raw = prefs.getString(KEY_RECORDS, "[]");
        try {
            JSONArray rows = new JSONArray(raw == null ? "[]" : raw);
            for (int index = 0; index < rows.length(); index++) {
                JSONObject row = rows.optJSONObject(index);
                if (row == null) continue;
                String assetId = row.optString("assetId", "").trim();
                String uri = row.optString("uri", "").trim();
                if (assetId.isEmpty() || uri.isEmpty()) continue;
                records.add(new Record(
                        assetId,
                        uri,
                        row.optLong("savedAt", 0L),
                        row.optBoolean("hasMotion", false),
                        row.optInt("rotationDegrees", 0),
                        optional(row, "capturedAt"),
                        optional(row, "gameVersion"),
                        optional(row, "format")
                ));
            }
        } catch (Exception ignored) {
            // Corrupt old local history must not block the app.
        }
        records.sort(Comparator.comparingLong(Record::savedAt).reversed());
        return records;
    }

    public synchronized void removeUri(String uri) {
        List<Record> next = load();
        next.removeIf(record -> uri.equals(record.uri()));
        save(next);
    }

    private void save(List<Record> records) {
        JSONArray rows = new JSONArray();
        for (Record record : records) {
            JSONObject row = new JSONObject();
            try {
                row.put("assetId", record.assetId());
                row.put("uri", record.uri());
                row.put("savedAt", record.savedAt());
                row.put("hasMotion", record.hasMotion());
                row.put("rotationDegrees", record.rotationDegrees());
                if (record.capturedAt() != null) row.put("capturedAt", record.capturedAt());
                if (record.gameVersion() != null) row.put("gameVersion", record.gameVersion());
                if (record.format() != null) row.put("format", record.format());
                rows.put(row);
            } catch (Exception ignored) {
                // A malformed single record must not block the rest of the history.
            }
        }
        prefs.edit().putString(KEY_RECORDS, rows.toString()).apply();
    }

    private static String optional(JSONObject row, String key) {
        if (!row.has(key) || row.isNull(key)) return null;
        String value = row.optString(key, "").trim();
        return value.isEmpty() ? null : value;
    }
}
