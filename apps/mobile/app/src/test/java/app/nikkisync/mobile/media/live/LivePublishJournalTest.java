package app.nikkisync.mobile.media.live;

import static org.junit.Assert.*;

import android.content.Context;
import android.net.Uri;
import app.nikkisync.mobile.storage.SavedPhotoStore;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;

@RunWith(RobolectricTestRunner.class)
public final class LivePublishJournalTest {
    private static final Uri IMAGES = Uri.parse("content://media/external/images/media");
    private static final Uri VIDEOS = Uri.parse("content://media/external/video/media");
    private Context context;
    private LivePublishJournal journal;
    private FakeMedia media;

    @Before public void setUp() {
        context = RuntimeEnvironment.getApplication();
        context.getSharedPreferences("nikkisync_live_publish_journal", Context.MODE_PRIVATE).edit().clear().commit();
        journal = new LivePublishJournal(context);
        media = new FakeMedia();
    }

    @Test public void secondInsertFailureDeletesOnlyFirstCreatedItem() throws Exception {
        String tx = journal.begin();
        int first = journal.expect(tx, IMAGES, "private-a.jpg", "DCIM/Camera");
        Uri image = Uri.parse("content://media/external/images/media/101");
        journal.attached(tx, first, image);
        journal.expect(tx, VIDEOS, "private-a.mp4", "DCIM/Camera");
        new LivePublishJournal(context).recover(uri -> false, media);
        assertEquals(List.of(image), media.deleted);
        assertEquals(0, journal.pendingCount());
    }

    @Test public void publishFailureAfterBothInsertsCompensatesBoth() throws Exception {
        String tx = journal.begin();
        int first = journal.expect(tx, IMAGES, "private-b.jpg", "DCIM/Camera");
        Uri image = Uri.parse("content://media/external/images/media/102");
        journal.attached(tx, first, image);
        int second = journal.expect(tx, VIDEOS, "private-b.mp4", "DCIM/Camera");
        Uri video = Uri.parse("content://media/external/video/media/103");
        journal.attached(tx, second, video);
        new LivePublishJournal(context).recover(uri -> false, media);
        assertEquals(List.of(image, video), media.deleted);
        assertEquals(0, journal.pendingCount());
    }

    @Test public void processDeathBetweenInsertAndUriReceiptFindsOnlyOwnedExactName() throws Exception {
        String tx = journal.begin();
        journal.expect(tx, IMAGES, "private-c.jpg", "Pictures/NikkiSync");
        Uri orphan = Uri.parse("content://media/external/images/media/104");
        media.found.put("private-c.jpg", List.of(orphan));
        new LivePublishJournal(context).recover(uri -> false, media);
        assertEquals(List.of(orphan), media.deleted);
        assertEquals(0, journal.pendingCount());
    }

    @Test public void committedSavedRecordWinsOverStaleJournal() throws Exception {
        String tx = journal.begin();
        int first = journal.expect(tx, IMAGES, "private-d.jpg", "Pictures/NikkiSync");
        Uri image = Uri.parse("content://media/external/images/media/105");
        journal.attached(tx, first, image);
        new LivePublishJournal(context).recover(uri -> uri.equals(image.toString()), media);
        assertTrue(media.deleted.isEmpty());
        assertEquals(0, journal.pendingCount());
    }

    @Test public void deleteFailureKeepsJournalForNextLaunch() throws Exception {
        String tx = journal.begin();
        int first = journal.expect(tx, IMAGES, "private-e.jpg", "Pictures/NikkiSync");
        Uri image = Uri.parse("content://media/external/images/media/106");
        journal.attached(tx, first, image);
        media.failDelete = true;
        try { new LivePublishJournal(context).recover(uri -> false, media); fail("expected delete error"); }
        catch (IOException expected) { assertEquals(1, journal.pendingCount()); }
        media.failDelete = false;
        new LivePublishJournal(context).recover(uri -> false, media);
        assertEquals(List.of(image), media.deleted);
        assertEquals(0, journal.pendingCount());
    }

    @Test public void savedRecordCorruptionNeverAuthorizesCleanup() throws Exception {
        context.getSharedPreferences("nikkisync_saved_photos", Context.MODE_PRIVATE).edit()
                .putString("records", "not-json").commit();
        SavedPhotoStore saved = new SavedPhotoStore(context);
        try { saved.containsDurableUri("content://media/external/images/media/107"); fail("expected failure"); }
        catch (IOException expected) { assertTrue(expected.getMessage().contains("untouched")); }
    }

    @Test public void ambiguousOwnedNameIsNotDeleted() throws Exception {
        String tx = journal.begin();
        journal.expect(tx, IMAGES, "private-f.jpg", "Pictures/NikkiSync");
        media.found.put("private-f.jpg", List.of(
                Uri.parse("content://media/external/images/media/108"),
                Uri.parse("content://media/external/images/media/109")));
        try { journal.recover(uri -> false, media); fail("expected ambiguous match"); }
        catch (IOException expected) {
            assertTrue(media.deleted.isEmpty());
            assertEquals(1, journal.pendingCount());
        }
    }

    private static final class FakeMedia implements LivePublishJournal.MediaAccess {
        final Map<String, List<Uri>> found = new HashMap<>();
        final List<Uri> deleted = new ArrayList<>();
        boolean failDelete;
        @Override public List<Uri> findOwned(Uri collection, String name, String path) {
            return found.getOrDefault(name, List.of());
        }
        @Override public void delete(Uri uri) throws IOException {
            if (failDelete) throw new IOException("injected delete failure");
            deleted.add(uri);
        }
    }
}
