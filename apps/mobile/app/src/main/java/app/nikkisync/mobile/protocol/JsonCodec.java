package app.nikkisync.mobile.protocol;

import app.nikkisync.mobile.model.Models.AssetDetail;
import app.nikkisync.mobile.model.Models.AssetPage;
import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.model.Models.Change;
import app.nikkisync.mobile.model.Models.Changes;
import app.nikkisync.mobile.model.Models.MediaResource;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public final class JsonCodec {
    private JsonCodec() {}

    public static AssetPage assetPage(String json) throws Exception {
        JSONObject root = new JSONObject(json);
        JSONArray rows = root.getJSONArray("items");
        List<AssetSummary> items = new ArrayList<>(rows.length());
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            items.add(new AssetSummary(
                    row.getString("assetId"),
                    row.getString("type"),
                    row.getString("state"),
                    optionalString(row, "capturedAt"),
                    optionalString(row, "uid"),
                    row.getLong("revision"),
                    optionalInt(row, "width"),
                    optionalInt(row, "height"),
                    row.optBoolean("hasMotion", false),
                    row.optBoolean("hasMetadata", false),
                    optionalString(row, "thumbnailResourceId"),
                    optionalString(row, "previewResourceId")
            ));
        }
        return new AssetPage(items, optionalString(root, "nextCursor"), root.getLong("libraryRevision"));
    }

    public static AssetDetail assetDetail(String json) throws Exception {
        JSONObject asset = new JSONObject(json).getJSONObject("asset");
        JSONArray rows = asset.getJSONArray("resources");
        List<MediaResource> resources = new ArrayList<>(rows.length());
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            resources.add(new MediaResource(
                    row.getString("resourceId"), row.getString("role"), row.getString("fileName"),
                    row.getString("mimeType"), row.getString("fileExt"), row.getLong("sizeBytes"),
                    row.getString("sha256"), optionalInt(row, "width"), optionalInt(row, "height"),
                    optionalLong(row, "durationMs")
            ));
        }
        JSONObject motion = asset.optJSONObject("motion");
        return new AssetDetail(asset.getString("assetId"), asset.getString("type"), asset.getString("state"),
                resources, motion != null,
                motion == null ? null : optionalString(motion, "stillResourceId"),
                motion == null ? null : optionalString(motion, "motionResourceId"),
                motion == null ? null : optionalLong(motion, "presentationTimestampUs"),
                asset.has("metadata") && !asset.isNull("metadata") ? asset.getJSONObject("metadata").toString() : null);
    }

    public static Changes changes(String json) throws Exception {
        JSONObject root = new JSONObject(json);
        JSONArray rows = root.getJSONArray("changes");
        List<Change> items = new ArrayList<>(rows.length());
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            items.add(new Change(row.getLong("revision"), row.getString("type"), row.getString("assetId"),
                    row.getString("occurredAt")));
        }
        return new Changes(items, root.getLong("libraryRevision"), root.optBoolean("fullResyncRequired", false));
    }

    private static String optionalString(JSONObject object, String key) {
        return object.has(key) && !object.isNull(key) ? object.optString(key, null) : null;
    }

    private static Integer optionalInt(JSONObject object, String key) {
        Object value = object.opt(key);
        return value instanceof Number ? ((Number) value).intValue() : null;
    }

    private static Long optionalLong(JSONObject object, String key) {
        Object value = object.opt(key);
        return value instanceof Number ? ((Number) value).longValue() : null;
    }
}
