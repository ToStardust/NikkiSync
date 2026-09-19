package app.nikkisync.mobile.storage;

import android.content.Context;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class SavedPhotoVerifier {
    private SavedPhotoVerifier() {}

    public static Map<String, SavedPhotoHealthStore.Entry> verify(
            Context context,
            SavedPhotoHealthStore healthStore,
            List<SavedPhotoStore.Record> records
    ) {
        List<String> uris = new ArrayList<>();
        for (SavedPhotoStore.Record record : records) uris.add(record.uri());
        return verifyUris(context, healthStore, uris);
    }

    public static Map<String, SavedPhotoHealthStore.Entry> verifyUris(
            Context context,
            SavedPhotoHealthStore healthStore,
            List<String> uris
    ) {
        Map<String, SavedPhotoHealthStore.Entry> result = new LinkedHashMap<>();
        long checkedAt = System.currentTimeMillis();

        for (String uri : uris) {
            if (uri == null || uri.isBlank() || result.containsKey(uri)) continue;
            SavedPhotoHealthStore.State state = canOpen(context, uri)
                    ? SavedPhotoHealthStore.State.ACTIVE
                    : SavedPhotoHealthStore.State.MISSING;
            healthStore.put(uri, state, checkedAt);
            result.put(uri, new SavedPhotoHealthStore.Entry(state, checkedAt));
        }
        return result;
    }

    private static boolean canOpen(Context context, String uri) {
        try (ParcelFileDescriptor descriptor =
                     context.getContentResolver().openFileDescriptor(Uri.parse(uri), "r")) {
            return descriptor != null;
        } catch (Exception ignored) {
            return false;
        }
    }
}
