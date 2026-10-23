package app.nikkisync.mobile;

import android.widget.Button;
import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.media.ImageLoader;
import app.nikkisync.mobile.share.ShareCardExportCoordinator;
import app.nikkisync.mobile.storage.SavedPhotoStore;
import app.nikkisync.mobile.storage.EditedVariantStore;
import java.lang.reflect.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@org.robolectric.annotation.Config(sdk={30,31,32,35})
public class MainViewerEntryTest {
    @Test public void viewerFindsPhotoThumbnailWithComputerScopedCacheKey() throws Exception {
        var activity=fixture();
        try {
            var asset=new AssetSummary("synthetic","photo","ready","2026-09-25T10:20:00Z",null,
                    1,1000,1200,false,false,null,null,"2.9","inferred");
            var scope=new android.widget.FrameLayout(activity);
            var thumbnail=new android.widget.ImageView(activity);scope.addView(thumbnail);
            Field loader=MainActivity.class.getDeclaredField("imageLoader");loader.setAccessible(true);
            ((ImageLoader)loader.get(activity)).load(null,asset,thumbnail);
            Method find=MainActivity.class.getDeclaredMethod("findThumbnail",android.view.View.class,String.class);find.setAccessible(true);
            assertSame("The viewer must locate its original tile independently of the disk cache key",thumbnail,find.invoke(activity,scope,"synthetic:"));
            assertNull(find.invoke(activity,scope,"another-photo:"));
            // Recycled holders must not be mistaken for the previously opened photo.
            var other=new AssetSummary("another-photo","photo","ready",null,null,2,1000,1200,false,false,null,null,null,null);
            ((ImageLoader)loader.get(activity)).load(null,other,thumbnail);
            assertNull(find.invoke(activity,scope,"synthetic:"));
        } finally {cleanup(activity);}
    }
    private MainActivity fixture() throws Exception {
        var activity=Robolectric.buildActivity(MainActivity.class).get();
        set(activity,"shareCardExportCoordinator",new ShareCardExportCoordinator(activity,Runnable::run,Runnable::run));
        set(activity,"imageLoader",new ImageLoader(activity));
        set(activity,"savedPhotoStore",new SavedPhotoStore(activity));
        invoke(activity,"buildUi",new Class<?>[0]);
        Field connectionField=MainActivity.class.getDeclaredField("connectionState");connectionField.setAccessible(true);
        var connection=(app.nikkisync.mobile.net.ConnectionState)connectionField.get(activity);connection.httpResult(connection.session(),true);
        return activity;
    }
    @Test public void offlinePhotoUsesSameViewerWithDisabledNetworkActions()throws Exception{
        var activity=fixture();try{
            Field field=MainActivity.class.getDeclaredField("connectionState");field.setAccessible(true);var state=(app.nikkisync.mobile.net.ConnectionState)field.get(activity);state.beginSession();
            set(activity,"pairedServer",new app.nikkisync.mobile.model.Models.PairedServer("pc","PC","127.0.0.1",1,"00","","",0));
            var asset=new AssetSummary("synthetic","photo","ready",null,null,1,100,100,false,false,"thumb","original",null,null);
            invoke(activity,"showViewer",new Class<?>[]{AssetSummary.class},asset);
            assertEquals(1,activity.navigationHost().overlayCount());
            assertNotNull(activity.navigationHost().findViewWithTag("photo-gestures"));
            assertFalse(findButton(activity.navigationHost(),"保存").isEnabled());assertFalse(findButton(activity.navigationHost(),"分享").isEnabled());
            assertTrue(findButton(activity.navigationHost(),"旋转").isEnabled());
            findButton(activity.navigationHost(),"详情").performClick();assertNotNull(findButton(activity.navigationHost(),"加入待删除"));
        }finally{cleanup(activity);}
    }
    @Test public void openingFirstPhotoWithoutShareWorkShowsFullscreenViewer() throws Exception {
        var activity=fixture();
        try {
            var asset=new AssetSummary("synthetic","photo","ready","2026-09-25T10:20:00Z",null,
                    1,1000,1200,false,false,null,null,"2.9","inferred");
            invoke(activity,"showViewer",new Class<?>[]{AssetSummary.class},asset);
            assertEquals(1,activity.navigationHost().overlayCount());
            assertNull(activity.navigationHost().findViewWithTag("live-playback-controls"));
            findButton(activity.navigationHost(),"详情").performClick();
            assertNull(findButton(activity.navigationHost(),"保存原视频"));
        } finally {cleanup(activity);}
    }
    @Test public void liveSaveOffersLiveOrVideoAndCancellationKeepsTheViewer() throws Exception {
        var activity=fixture();
        try {
            var asset=new AssetSummary("synthetic-live","motion_photo","ready",null,null,
                    1,3840,2160,true,false,null,null,null,null);
            invoke(activity,"showViewer",new Class<?>[]{AssetSummary.class},asset);
            assertNotNull(activity.navigationHost().findViewWithTag("live-playback-controls"));
            findButton(activity.navigationHost(),"保存").performClick();
            assertEquals(2,activity.navigationHost().overlayCount());
            assertNotNull(findButton(activity.navigationHost(),"实况照片"));
            assertNotNull(findButton(activity.navigationHost(),"视频"));
            findButton(activity.navigationHost(),"取消").performClick();
            activity.navigationHost().interrupt();
            assertEquals(1,activity.navigationHost().overlayCount());
            findButton(activity.navigationHost(),"保存").performClick();
            findButton(activity.navigationHost(),"视频").performClick();
            assertEquals("请先连接电脑",org.robolectric.shadows.ShadowToast.getTextOfLatestToast());
            activity.navigationHost().interrupt();
            assertEquals(1,activity.navigationHost().overlayCount());
        } finally {cleanup(activity);}
    }
    @Test public void ordinaryPhotoSaveDoesNotOfferVideo() throws Exception {
        var activity=fixture();
        try {
            var asset=new AssetSummary("synthetic","photo","ready",null,null,1,1000,1200,false,false,null,null,null,null);
            invoke(activity,"showViewer",new Class<?>[]{AssetSummary.class},asset);
            findButton(activity.navigationHost(),"保存").performClick();
            assertEquals(1,activity.navigationHost().overlayCount());
            assertNull(findButton(activity.navigationHost(),"视频"));
            assertEquals("请先连接电脑",org.robolectric.shadows.ShadowToast.getTextOfLatestToast());
        } finally {cleanup(activity);}
    }
    @Test public void mixedBatchOffersTheSameMotionSaveChoices() throws Exception {
        var activity=fixture();
        try {
            var photo=new AssetSummary("synthetic","photo","ready",null,null,1,1000,1200,false,false,null,null,null,null);
            var live=new AssetSummary("synthetic-live","motion_photo","ready",null,null,1,3840,2160,true,false,null,null,null,null);
            invoke(activity,"requestPhotoSave",new Class<?>[]{java.util.List.class,boolean.class},java.util.List.of(photo,live),true);
            assertEquals(1,activity.navigationHost().overlayCount());
            assertNotNull(findButton(activity.navigationHost(),"实况照片"));
            assertNotNull(findButton(activity.navigationHost(),"视频"));
            findButton(activity.navigationHost(),"实况照片").performClick();
            assertEquals("请先连接电脑",org.robolectric.shadows.ShadowToast.getTextOfLatestToast());
            activity.navigationHost().interrupt();assertEquals(0,activity.navigationHost().overlayCount());
        } finally {cleanup(activity);}
    }
    private static Button findButton(android.view.View view,String text) {
        if(view instanceof Button button&&text.contentEquals(button.getText()))return button;
        if(view instanceof android.view.ViewGroup group)for(int i=0;i<group.getChildCount();i++){
            Button found=findButton(group.getChildAt(i),text);if(found!=null)return found;
        }
        return null;
    }
    @Test public void noPendingShareWorkCanBeCancelledWithoutTouchingButtons() throws Exception {
        var activity=fixture();
        try {invoke(activity,"cancelShareCardFrom",new Class<?>[]{Button.class},(Object)null);}
        finally {cleanup(activity);}
    }
    @Test public void openingSavedPhotoWithoutShareWorkShowsFullscreenViewer() throws Exception {
        var activity=fixture();
        try {
            var record=new SavedPhotoStore.Record("synthetic","content://media/external/images/media/100",0,false,0,
                    "2026-09-25T10:20:00Z","2.9","jpg");
            invoke(activity,"showSavedPhotoDetails",new Class<?>[]{SavedPhotoStore.Record.class},record);
            assertEquals(1,activity.navigationHost().overlayCount());
        } finally {cleanup(activity);}
    }
    @Test public void widgetOpensOnlyAPhotoAlreadyInSavedHistory() throws Exception {
        var activity=fixture();
        try {
            String uri="content://media/external/images/media/100";
            activity.getSharedPreferences("nikkisync_saved_photos",0).edit().putString("records",
                    new org.json.JSONArray().put(new org.json.JSONObject().put("assetId","synthetic").put("uri",uri)).toString()).commit();
            var intent=new android.content.Intent(activity,MainActivity.class)
                    .setAction(app.nikkisync.mobile.widget.PhotoAlbumWidgetProvider.OPEN_PHOTO)
                    .putExtra(app.nikkisync.mobile.widget.PhotoAlbumWidgetProvider.PHOTO_URI,"content://untrusted/unknown");
            invoke(activity,"handleIntent",new Class<?>[]{android.content.Intent.class},intent);
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
            assertEquals(0,activity.navigationHost().overlayCount());
            intent.putExtra(app.nikkisync.mobile.widget.PhotoAlbumWidgetProvider.PHOTO_URI,uri);
            invoke(activity,"handleIntent",new Class<?>[]{android.content.Intent.class},intent);
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
            assertEquals(1,activity.navigationHost().overlayCount());
        } finally {cleanup(activity);}
    }
    @Test public void openingEditedPhotoWithoutShareWorkShowsFullscreenViewer() throws Exception {
        var activity=fixture();
        try {
            var variant=new EditedVariantStore.Variant("variant","synthetic","content://media/external/images/media/101",
                    0,"synthetic.jpg","image/jpeg","content://media/external/images/media/100");
            invoke(activity,"showEditedPhotoDetails",new Class<?>[]{EditedVariantStore.Variant.class},variant);
            assertEquals(1,activity.navigationHost().overlayCount());
        } finally {cleanup(activity);}
    }
    private static void invoke(MainActivity activity,String name,Class<?>[] types,Object... args) throws Exception {
        Method method=MainActivity.class.getDeclaredMethod(name,types);method.setAccessible(true);
        try {method.invoke(activity,args);}catch(InvocationTargetException error){throw (Exception)error.getCause();}
    }
    @Test public void savingRotatedPhotoKeepsViewerDirectionForFollowingShare() throws Exception {
        var activity=fixture();
        try {
            var asset=new AssetSummary("synthetic","photo","ready","2026-09-25T10:20:00Z",null,
                    1,1000,1200,false,false,null,null,"2.9","inferred");
            invoke(activity,"rememberRotation",new Class<?>[]{String.class,int.class},"synthetic",90);
            invoke(activity,"showViewer",new Class<?>[]{AssetSummary.class},asset);
            invoke(activity,"applyCompletedSaves",new Class<?>[]{java.util.List.class,java.util.Map.class,boolean.class},
                    java.util.List.of(asset),java.util.Map.of("synthetic",90),false);
            Field field=MainActivity.class.getDeclaredField("rotationByAssetId");field.setAccessible(true);
            assertEquals("Sharing must keep the direction still shown in the open viewer",90,((java.util.Map<?,?>)field.get(activity)).get("synthetic"));
        } finally {cleanup(activity);}
    }
    private static void set(MainActivity activity,String name,Object value) throws Exception {
        Field field=MainActivity.class.getDeclaredField(name);field.setAccessible(true);field.set(activity,value);
    }
    private static void cleanup(MainActivity activity) throws Exception {
        activity.navigationHost().close();
        for(String name:new String[]{"io","shareWorker","organizerIo"}) {
            Field field=MainActivity.class.getDeclaredField(name);field.setAccessible(true);
            ((java.util.concurrent.ExecutorService)field.get(activity)).shutdownNow();
        }
        Field field=MainActivity.class.getDeclaredField("imageLoader");field.setAccessible(true);
        ((ImageLoader)field.get(activity)).shutdown();
        field=MainActivity.class.getDeclaredField("savedAdapter");field.setAccessible(true);
        ((app.nikkisync.mobile.ui.SavedPhotoAdapter)field.get(activity)).shutdown();
    }
}
