package app.nikkisync.mobile.media.live;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Durable receipts for MediaStore items created by one Live export, never a gallery-wide cleanup. */
public final class LivePublishJournal {
    private static final String PREFS = "nikkisync_live_publish_journal";
    private static final String KEY = "transactions";

    @FunctionalInterface public interface SavedCheck { boolean contains(String primaryUri) throws IOException; }
    public interface MediaAccess {
        /** Only exact-name/path items owned by this application may be returned. */
        List<Uri> findOwned(Uri collection, String name, String path) throws IOException;
        void delete(Uri uri) throws IOException;
    }

    private record Item(String collection, String name, String path, String uri) {}
    private record Tx(String id, List<Item> items) {}
    private final SharedPreferences prefs;

    public LivePublishJournal(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Persist the transaction before any MediaStore insert. */
    public synchronized String begin() throws IOException {
        List<Tx> txs = read();
        String id = UUID.randomUUID().toString();
        txs.add(new Tx(id, new ArrayList<>()));
        write(txs);
        return id;
    }

    /** Persist an unpredictable exact display name before insert, closing the insert-to-receipt crash gap. */
    public synchronized int expect(String id, Uri collection, String name, String path) throws IOException {
        List<Tx> txs = read();
        Tx tx = require(txs, id);
        List<Item> items = new ArrayList<>(tx.items());
        int index = items.size();
        items.add(new Item(collection.toString(), name, path, null));
        replace(txs, new Tx(id, items));
        write(txs);
        return index;
    }

    /** The inserted URI is committed before writing bytes or publishing another item. */
    public synchronized void attached(String id, int index, Uri uri) throws IOException {
        List<Tx> txs = read();
        Tx tx = require(txs, id);
        if (index < 0 || index >= tx.items().size()) throw new IOException("Live journal item index invalid");
        List<Item> items = new ArrayList<>(tx.items());
        Item old = items.get(index);
        items.set(index, new Item(old.collection(), old.name(), old.path(), uri.toString()));
        replace(txs, new Tx(id, items));
        write(txs);
    }

    /** Called only after the matching SavedPhotoStore record has been durably committed. */
    public synchronized void complete(String id) throws IOException {
        List<Tx> txs = read();
        if (txs.removeIf(tx -> tx.id().equals(id))) write(txs);
    }

    /** Retryable on startup or after a handled export failure. A deletion error retains the receipt. */
    public synchronized void recover(SavedCheck saved, MediaAccess media) throws IOException {
        for (Tx tx : read()) recoverOne(tx, saved, media);
    }

    public synchronized void recoverOne(String id, SavedCheck saved, MediaAccess media) throws IOException {
        recoverOne(require(read(), id), saved, media);
    }

    private void recoverOne(Tx tx, SavedCheck saved, MediaAccess media) throws IOException {
        if (!tx.items().isEmpty()) {
            String primary = tx.items().get(0).uri();
            if (primary != null && saved.contains(primary)) {
                complete(tx.id());
                return;
            }
        }
        LinkedHashSet<Uri> targets = new LinkedHashSet<>();
        for (Item item : tx.items()) {
            if (item.uri() != null) targets.add(Uri.parse(item.uri()));
            else {
                List<Uri> found = media.findOwned(Uri.parse(item.collection()), item.name(), item.path());
                if (found.size() > 1) throw new IOException("Live journal found ambiguous owned media: " + item.name());
                targets.addAll(found);
            }
        }
        for (Uri uri : targets) media.delete(uri);
        complete(tx.id());
    }

    synchronized int pendingCount() throws IOException { return read().size(); }

    private List<Tx> read() throws IOException {
        String raw = prefs.getString(KEY, "[]");
        try {
            JSONArray rows = new JSONArray(raw);
            List<Tx> txs = new ArrayList<>();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.getJSONObject(i);
                String id = row.getString("id");
                JSONArray savedItems = row.getJSONArray("items");
                List<Item> items = new ArrayList<>();
                for (int j = 0; j < savedItems.length(); j++) {
                    JSONObject item = savedItems.getJSONObject(j);
                    items.add(new Item(item.getString("collection"), item.getString("name"),
                            item.getString("path"), item.optString("uri", null)));
                }
                txs.add(new Tx(id, items));
            }
            return txs;
        } catch (JSONException | NullPointerException error) {
            throw new IOException("Live journal unreadable; media left untouched", error);
        }
    }

    private void write(List<Tx> txs) throws IOException {
        try {
            JSONArray rows = new JSONArray();
            for (Tx tx : txs) {
                JSONObject row = new JSONObject().put("id", tx.id());
                JSONArray items = new JSONArray();
                for (Item item : tx.items()) {
                    JSONObject saved = new JSONObject().put("collection", item.collection()).put("name", item.name())
                            .put("path", item.path());
                    if (item.uri() != null) saved.put("uri", item.uri());
                    items.put(saved);
                }
                row.put("items", items);
                rows.put(row);
            }
            if (!prefs.edit().putString(KEY, rows.toString()).commit())
                throw new IOException("Live journal persistence failed; media not published");
        } catch (JSONException error) {
            throw new IOException("Live journal encoding failed", error);
        }
    }

    private static Tx require(List<Tx> txs, String id) throws IOException {
        for (Tx tx : txs) if (tx.id().equals(id)) return tx;
        throw new IOException("Live journal transaction missing: " + id);
    }
    private static void replace(List<Tx> txs, Tx next) throws IOException {
        for (int i = 0; i < txs.size(); i++) if (txs.get(i).id().equals(next.id())) { txs.set(i, next); return; }
        throw new IOException("Live journal transaction missing: " + next.id());
    }

    public static MediaAccess androidMedia(ContentResolver resolver, String packageName) {
        return new MediaAccess() {
            @Override public List<Uri> findOwned(Uri collection, String name, String path) throws IOException {
                List<Uri> found = new ArrayList<>();
                try (Cursor rows = resolver.query(MediaStore.setIncludePending(collection),
                        new String[] {MediaStore.MediaColumns._ID, MediaStore.MediaColumns.RELATIVE_PATH},
                        MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + MediaStore.MediaColumns.OWNER_PACKAGE_NAME + "=?",
                        new String[] {name, packageName}, null)) {
                    if (rows == null) throw new IOException("MediaStore could not inspect pending Live item");
                    int idColumn = rows.getColumnIndexOrThrow(MediaStore.MediaColumns._ID);
                    int pathColumn = rows.getColumnIndexOrThrow(MediaStore.MediaColumns.RELATIVE_PATH);
                    while (rows.moveToNext()) {
                        if (normalizePath(path).equals(normalizePath(rows.getString(pathColumn))))
                            found.add(ContentUris.withAppendedId(collection, rows.getLong(idColumn)));
                    }
                } catch (RuntimeException error) {
                    throw new IOException("MediaStore Live recovery query failed", error);
                }
                return found;
            }
            @Override public void delete(Uri uri) throws IOException {
                try {
                    if (resolver.delete(uri, null, null) == 0) {
                        // Zero may mean already gone after a previous partial recovery. Confirm before dropping the receipt.
                        try (Cursor check = resolver.query(MediaStore.setIncludePending(uri),
                                new String[] {MediaStore.MediaColumns._ID}, null, null, null)) {
                            if (check == null || check.moveToFirst())
                                throw new IOException("MediaStore did not confirm Live deletion: " + uri);
                        }
                    }
                }
                catch (RuntimeException error) { throw new IOException("MediaStore Live recovery deletion failed", error); }
            }
        };
    }

    private static String normalizePath(String path) {
        if (path == null) return "";
        return path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
    }
}
