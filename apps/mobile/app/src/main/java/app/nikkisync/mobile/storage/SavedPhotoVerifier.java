package app.nikkisync.mobile.storage;

import android.content.Context;
import android.os.ParcelFileDescriptor;

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
        Map<String, SavedPhotoHealthStore.Entry> result = new LinkedHashMap<>();
        long checkedAt = System.currentTimeMillis();

        for (SavedPhotoStore.Record record : records) {
            SavedPhotoHealthStore.State state = canOpen(context, record)
                    ? SavedPhotoHealthStore.State.ACTIVE
                    : SavedPhotoHealthStore.State.MISSING;
            healthStore.put(record.uri(), state, checkedAt);
            result.put(record.uri(), new SavedPhotoHealthStore.Entry(state, checkedAt));
        }
        return result;
    }

    private static boolean canOpen(Context context, SavedPhotoStore.Record record) {
        try (ParcelFileDescriptor descriptor =
                     context.getContentResolver().openFileDescriptor(record.mediaUri(), "r")) {
            return descriptor != null;
        } catch (Exception ignored) {
            return false;
        }
    }
}
