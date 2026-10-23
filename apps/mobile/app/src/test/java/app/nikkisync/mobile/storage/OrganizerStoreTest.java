package app.nikkisync.mobile.storage;

import android.content.Context;
import app.nikkisync.mobile.model.Models.AssetSummary;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import java.util.List;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
public class OrganizerStoreTest {
    Context context;OrganizerStore store;
    final AssetSummary photo=new AssetSummary("asset_example","photo","ready",null,null,3,100,100,false,true,"thumb","original","2.9","inferred");
    @Before public void setup(){context=RuntimeEnvironment.getApplication();context.deleteDatabase("nikkisync-organizer.db");store=new OrganizerStore(context);}
    @After public void close(){store.close();}
    @Test public void libraryAndIntentSurviveRestartAndStayBoundToComputerIdentity()throws Exception{
        store.remember("pc:certificate",List.of(photo));store.enqueue("pc:certificate",List.of(photo));store.close();store=new OrganizerStore(context);
        assertEquals(1,store.library("pc:certificate").size());assertTrue(store.library("other:certificate").isEmpty());assertEquals(1,store.outgoing("pc:certificate").length());assertEquals(0,store.outgoing("other:certificate").length());assertEquals(3,store.entries("pc:certificate").get(0).asset().revision());
    }
    @Test public void cancellationSurvivesStaleResponseAndIsSentInsteadOfApproval()throws Exception{
        store.enqueue("pc",List.of(photo));String id=store.entries("pc").get(0).id();
        store.acknowledge("pc",new JSONArray().put(new JSONObject().put("id",id).put("state","confirming").put("approval","challenge")));
        assertEquals("challenge",store.outgoing("pc").getJSONObject(0).getString("approval"));
        store.cancel("pc",List.of(id));store.acknowledge("pc",new JSONArray().put(new JSONObject().put("id",id).put("state","confirming").put("approval","stale")));
        assertTrue(store.outgoing("pc").getJSONObject(0).getBoolean("cancel"));assertFalse(store.outgoing("pc").getJSONObject(0).has("approval"));
        store.acknowledge("pc",new JSONArray().put(new JSONObject().put("id",id).put("state","cancelled")));assertEquals(0,store.outgoing("pc").length());
    }
    @Test public void offlineLibraryPreservesOnlineSequenceAcrossRestartAndSnapshotReplacement()throws Exception{
        // IDs deliberately sort in reverse; null dates cannot reconstruct the PC order.
        AssetSummary newest=versionPhoto("z-newest","2.9");
        AssetSummary previous=versionPhoto("m-previous","2.8");
        AssetSummary older=versionPhoto("b-older","1.11");
        AssetSummary oldest=versionPhoto("a-oldest","1.8");
        List<AssetSummary> online=List.of(newest,previous,older,oldest);
        store.remember("pc",online);store.remember("other-pc",List.of(oldest,newest));
        store.close();store=new OrganizerStore(context);
        assertEquals(online.stream().map(AssetSummary::assetId).toList(),store.library("pc").stream().map(AssetSummary::assetId).toList());
        assertEquals(List.of("2.9","2.8","1.11","1.8"),
            app.nikkisync.mobile.ui.GalleryVersionGroups.group(store.library("pc")).stream()
                .map(app.nikkisync.mobile.ui.GalleryVersionGroups.Group::version).toList());
        List<AssetSummary> refreshed=List.of(previous,newest,oldest);
        store.remember("pc",refreshed);store.close();store=new OrganizerStore(context);
        assertEquals(refreshed.stream().map(AssetSummary::assetId).toList(),store.library("pc").stream().map(AssetSummary::assetId).toList());
        assertEquals(List.of("a-oldest","z-newest"),store.library("other-pc").stream().map(AssetSummary::assetId).toList());
    }
    private static AssetSummary versionPhoto(String id,String version){
        return new AssetSummary(id,"photo","ready",null,null,1,100,100,false,true,"thumb","original",version,"inferred");
    }
    @Test public void existingV1CacheRepairsOrderWithoutReconnectAndKeepsDeletionIntents()throws Exception{
        store.close();context.deleteDatabase("nikkisync-organizer.db");
        try(var legacy=android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath("nikkisync-organizer.db"),null)){
            legacy.execSQL("CREATE TABLE library(scope TEXT NOT NULL,asset_id TEXT NOT NULL,summary TEXT NOT NULL,PRIMARY KEY(scope,asset_id))");
            legacy.execSQL("CREATE TABLE deletions(id TEXT PRIMARY KEY,scope TEXT NOT NULL,asset_id TEXT NOT NULL,summary TEXT NOT NULL,state TEXT NOT NULL,message TEXT NOT NULL,created INTEGER NOT NULL,approval TEXT NOT NULL DEFAULT '')");
            for(var asset:List.of(versionPhoto("z-newest","2.9"),versionPhoto("a-oldest","1.8")))legacy.execSQL("INSERT INTO library VALUES(?,?,?)",new Object[]{"pc",asset.assetId(),FavoritePhotoStore.encode(asset).toString()});
            legacy.execSQL("INSERT INTO deletions VALUES(?,?,?,?,?,?,?,?)",new Object[]{"intent","pc",photo.assetId(),FavoritePhotoStore.encode(photo).toString(),"local","keep",1,""});legacy.setVersion(1);
        }
        store=new OrganizerStore(context);
        assertEquals(List.of("z-newest","a-oldest"),store.library("pc").stream().map(AssetSummary::assetId).toList());
        assertEquals(1,store.outgoing("pc").length());assertTrue(store.entries("pc").get(0).pending());
        assertEquals(2,store.getReadableDatabase().getVersion());
    }
    @Test public void completedRecyclingIsNotResentAndLocalFilesAreNotNeeded()throws Exception{
        store.enqueue("pc",List.of(photo));store.enqueue("pc",List.of(photo));assertEquals(1,store.entries("pc").size());String id=store.entries("pc").get(0).id();
        store.acknowledge("different",new JSONArray().put(new JSONObject().put("id",id).put("state","recycled")));assertEquals(1,store.outgoing("pc").length());
        store.acknowledge("pc",new JSONArray().put(new JSONObject().put("id",id).put("state","recycled").put("message","从回收站恢复")));assertEquals(0,store.outgoing("pc").length());assertEquals("recycled",store.entries("pc").get(0).state());
    }
    @Test public void processingIsPolledUntilATerminalResultAndCancellationSurvivesLateQueuedReplies()throws Exception{
        store.enqueue("pc",List.of(photo));String id=store.entries("pc").get(0).id();
        for(String state:List.of("preparing","pending","confirming","queued","checking","executing")){
            store.acknowledge("pc",new JSONArray().put(new JSONObject().put("id",id).put("state",state).put("approval","challenge")));
            assertEquals(1,store.outgoing("pc").length());
        }
        assertFalse(store.entries("pc").get(0).pending());
        store.acknowledge("pc",new JSONArray().put(new JSONObject().put("id",id).put("state","recycled")));assertEquals(0,store.outgoing("pc").length());
        store.enqueue("pc",List.of(photo));id=store.entries("pc").stream().filter(OrganizerStore.Entry::pending).findFirst().get().id();
        store.cancel("pc",List.of(id));
        for(String state:List.of("preparing","queued","checking"))store.acknowledge("pc",new JSONArray().put(new JSONObject().put("id",id).put("state",state)));
        assertTrue(store.outgoing("pc").getJSONObject(0).getBoolean("cancel"));
    }
    @Test public void aNewChallengeHasOneImmediateFollowUpAndRepeatedOrCancelledChallengesDoNotLoop()throws Exception{
        JSONArray sent=new JSONArray().put(new JSONObject().put("id","a").put("cancel",false));
        JSONArray challenge=new JSONArray().put(new JSONObject().put("id","a").put("state","confirming").put("approval","fresh"));
        assertTrue(OrganizerStore.needsFollowUp(sent,challenge));sent.getJSONObject(0).put("approval","fresh");assertFalse(OrganizerStore.needsFollowUp(sent,challenge));
        sent.getJSONObject(0).put("cancel",true).remove("approval");assertFalse(OrganizerStore.needsFollowUp(sent,challenge));
        for(String state:List.of("queued","checking","executing","recycled")){challenge.getJSONObject(0).put("state",state);assertFalse(OrganizerStore.needsFollowUp(new JSONArray(),challenge));}
    }
}
