package app.nikkisync.mobile.media;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.widget.ImageView;
import app.nikkisync.mobile.model.Models.*;
import app.nikkisync.mobile.net.NikkiSyncClient;
import app.nikkisync.mobile.protocol.JsonCodec;
import java.io.*;
import java.net.URL;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.HttpsURLConnection;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.*;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=35)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class PhotoCacheTest {
    @Test public void moreThanTwentyThousandCachedPhotosRemainAvailableOfflineAndPinnedIntentSurvivesPruning()throws Exception{
        var context=RuntimeEnvironment.getApplication();byte[] bytes=jpeg(48,48);List<AssetSummary> photos=new ArrayList<>();File directory=new File(context.getFilesDir(),"photo-thumbnails-v2");directory.mkdirs();
        for(int i=0;i<21005;i++){var photo=asset("over-limit-"+i,1,"a".repeat(64));photos.add(photo);try(var out=new FileOutputStream(new File(directory,PhotoCacheKey.fileName(PC,photo,false)))){out.write(bytes);}}
        ImageLoader loader=new ImageLoader(context);loader.setNetworkAvailable(false);var organizer=new app.nikkisync.mobile.storage.OrganizerStore(context);
        try{
            organizer.remember(app.nikkisync.mobile.storage.OrganizerStore.scope(PC),photos);var restored=loader.cachedAssets(PC,organizer.library(app.nikkisync.mobile.storage.OrganizerStore.scope(PC)));
            assertEquals(21005,restored.size());assertEquals("over-limit-21004",restored.get(21004).assetId());
            organizer.enqueue(app.nikkisync.mobile.storage.OrganizerStore.scope(PC),List.of(restored.get(20800)));loader.pinForOrganizer(PC,restored.get(20800));loader.photos.trim(0,0);
            assertTrue(loader.hasCached(PC,restored.get(20800)));assertEquals(1,organizer.entries(app.nikkisync.mobile.storage.OrganizerStore.scope(PC)).size());
        }finally{loader.shutdown();organizer.close();}
    }
    static final PairedServer PC=new PairedServer("photo-cache-pc","PC","invalid.local",28080,"cert","","",0);
    static AssetSummary asset(String id,long revision,String hash)throws Exception {
        return JsonCodec.assetPage("{\"items\":[{\"assetId\":\""+id+"\",\"type\":\"photo\",\"state\":\"ready\",\"revision\":"+revision+
            ",\"previewResourceId\":\"preview\",\"previewSha256\":\""+hash+"\",\"fullPreviewResourceId\":\"original\",\"fullPreviewSha256\":\""+hash+"\"}],\"libraryRevision\":1}").items().get(0);
    }
    static byte[] jpeg(int width,int height)throws Exception {
        Bitmap b=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);b.eraseColor(Color.MAGENTA);
        try(var out=new ByteArrayOutputStream()){assertTrue(b.compress(Bitmap.CompressFormat.JPEG,95,out));return out.toByteArray();}finally{b.recycle();}
    }
    static String hash(byte[] bytes)throws Exception{return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
    static File source(byte[] bytes)throws Exception{File f=File.createTempFile("photo-source-",".jpg",RuntimeEnvironment.getApplication().getCacheDir());try(var out=new FileOutputStream(f)){out.write(bytes);}return f;}
    static HttpsURLConnection connection(byte[] bytes)throws Exception {
        return new HttpsURLConnection(new URL("https://invalid.local/photo")){
            public int getResponseCode(){return 200;} public InputStream getInputStream(){return new ByteArrayInputStream(bytes);}
            public void disconnect(){} public void connect(){} public boolean usingProxy(){return false;}
            public String getCipherSuite(){return "test";} public java.security.cert.Certificate[] getLocalCertificates(){return null;}
            public java.security.cert.Certificate[] getServerCertificates(){return null;}
        };
    }
    static void await(java.util.function.BooleanSupplier done)throws Exception {
        for(int i=0;i<500&&!done.getAsBoolean();i++){Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();Thread.sleep(5);}
        assertTrue("background cache work did not complete",done.getAsBoolean());
    }
    @Test public void cacheIdentitySurvivesMetadataChangesButNotImageChangesOrOtherComputers()throws Exception {
        var first=asset("same",1,"a".repeat(64));var metadata=asset("same",800,"a".repeat(64));var changed=asset("same",801,"b".repeat(64));
        assertEquals(PhotoCacheKey.thumbnail(PC,first),PhotoCacheKey.thumbnail(PC,metadata));
        assertEquals(PhotoCacheKey.preview(PC,first),PhotoCacheKey.preview(PC,metadata));
        assertNotEquals(PhotoCacheKey.thumbnail(PC,first),PhotoCacheKey.thumbnail(PC,changed));
        assertNotEquals(PhotoCacheKey.thumbnail(PC,first),PhotoCacheKey.thumbnail(new PairedServer("other","PC","invalid.local",1,"cert","","",0),first));
        assertNotEquals(PhotoCacheKey.thumbnail(PC,first),PhotoCacheKey.thumbnail(new PairedServer(PC.serverId(),"PC","invalid.local",1,"other-cert","","",0),first));
        var legacy=new AssetSummary("same","photo","ready",null,null,1,null,null,false,false,null,"preview",null,null);
        assertTrue(PhotoCacheKey.thumbnail(PC,legacy).contains("revision:1"));
    }
    @Test public void thumbnailAndPreviewAreSizedIndependentlyAndPendingSurvivesBothEvictions()throws Exception {
        var context=RuntimeEnvironment.getApplication();var preferences=new PhotoCachePreferences(context);var disk=new PhotoDiskCache(context,preferences);
        byte[] bytes=jpeg(3200,1800);File file=source(bytes);var asset=asset("sized",1,hash(bytes));
        try {
            assertTrue(disk.storeThumbnail(PC,asset,file,true));disk.storePreview(PC,asset,file);
            Bitmap thumb=PhotoDiskCache.decode(disk.thumbnail(PC,asset),512),preview=PhotoDiskCache.decode(disk.preview(PC,asset),2048);
            assertEquals(512,thumb.getWidth());assertEquals(2048,preview.getWidth());thumb.recycle();preview.recycle();
            disk.pin(PC,asset);disk.trim(preferences.thumbnailBytes(),0);
            assertTrue(disk.thumbnail(PC,asset).isFile());assertFalse(disk.preview(PC,asset).exists());
            disk.trim(0,0);assertFalse(disk.thumbnail(PC,asset).exists());assertTrue(disk.pinned(PC,asset).isFile());
        }finally{file.delete();}
    }
    @Test public void restartedGridAndMetadataRefreshReuseDiskWithoutDownloadingAndViewerUsesOwnTier()throws Exception {
        var context=RuntimeEnvironment.getApplication();byte[] bytes=jpeg(1600,900);String sha=hash(bytes);AtomicInteger requests=new AtomicInteger();List<String> resources=Collections.synchronizedList(new ArrayList<>());
        ImageLoader.PhotoSource source=(client,asset,id)->{requests.incrementAndGet();resources.add(id);return connection(bytes);};
        var client=new NikkiSyncClient(PC,null);ImageLoader loader=new ImageLoader(context,source);ImageView view=new ImageView(context);
        try {loader.load(client,asset("repeat",1,sha),view);await(()->view.getDrawable()!=null);assertEquals(1,requests.get());assertEquals(List.of("preview"),resources);}
        finally{loader.shutdown();}
        loader=new ImageLoader(context,source);ImageView next=new ImageView(context);final ImageLoader restarted=loader;
        try {
            loader.load(client,asset("repeat",99,sha),next);await(()->next.getDrawable()!=null);assertEquals(1,requests.get());
            var photo=asset("repeat",99,sha);loader.loadPreview(client,photo,next);
            await(()->requests.get()==2&&restarted.photos.preview(PC,photo).isFile());assertEquals(List.of("preview","original"),resources);
            loader.setNetworkAvailable(false);ImageView offline=new ImageView(context);loader.loadOfflinePreview(PC,asset("repeat",100,sha),offline);await(()->offline.getDrawable()!=null);assertEquals(2,requests.get());
        }finally{loader.shutdown();}
    }
    @Test public void completeLargeOfflineLibraryKeepsOrderAfterRestartAndQueueStillRecordsAndCancels()throws Exception {
        var context=RuntimeEnvironment.getApplication();ImageLoader loader=new ImageLoader(context);File source=source(jpeg(48,48));List<AssetSummary> photos=new ArrayList<>();
        var organizer=new app.nikkisync.mobile.storage.OrganizerStore(context);
        try {
            for(int i=0;i<2200;i++){var photo=asset("large-"+i,1,"a".repeat(64));photos.add(photo);assertTrue(loader.photos.storeThumbnail(PC,photo,source,false));}
            organizer.remember(app.nikkisync.mobile.storage.OrganizerStore.scope(PC),photos);loader.shutdown();loader=new ImageLoader(context);loader.setNetworkAvailable(false);
            List<AssetSummary> available=loader.cachedAssets(PC,organizer.library(app.nikkisync.mobile.storage.OrganizerStore.scope(PC)));
            assertEquals(2200,available.size());assertEquals("large-0",available.get(0).assetId());assertEquals("large-2199",available.get(2199).assetId());
            organizer.enqueue(app.nikkisync.mobile.storage.OrganizerStore.scope(PC),List.of(available.get(2100)));loader.pinForOrganizer(PC,available.get(2100));loader.photos.trim(0,0);
            assertTrue(loader.hasCached(PC,available.get(2100)));var entries=organizer.entries(app.nikkisync.mobile.storage.OrganizerStore.scope(PC));assertEquals(1,entries.size());
            organizer.cancel(app.nikkisync.mobile.storage.OrganizerStore.scope(PC),List.of(entries.get(0).id()));assertEquals("cancel_requested",organizer.entries(app.nikkisync.mobile.storage.OrganizerStore.scope(PC)).get(0).state());
        }finally{loader.shutdown();organizer.close();source.delete();}
    }
    @Test public void warmingStopsAtCapacityRatherThanEvictingTheAlbumAndRedownloadingIt()throws Exception {
        var context=RuntimeEnvironment.getApplication();byte[] bytes=jpeg(48,48);AtomicInteger requests=new AtomicInteger();
        ImageLoader loader=new ImageLoader(context,(client,asset,id)->{requests.incrementAndGet();return connection(bytes);});
        try {
            var field=ImageLoader.class.getDeclaredField("executor");field.setAccessible(true);((java.util.concurrent.ExecutorService)field.get(loader)).submit(()->{}).get();
            loader.photos.trim(1,0);var client=new NikkiSyncClient(PC,null);List<AssetSummary> items=List.of(asset("warm-a",1,hash(bytes)),asset("warm-b",1,hash(bytes)));
            loader.warmThumbnails(client,items,null);await(()->loader.offlineProgress().full());assertEquals(1,requests.get());
            loader.warmThumbnails(client,items,null);Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();Thread.sleep(100);assertEquals(1,requests.get());
        }finally{loader.shutdown();}
    }
    @Test public void actualViewerEntryUpgradesCachedGridPixelsToTheOriginalResource()throws Exception {
        var context=RuntimeEnvironment.getApplication();byte[] bytes=jpeg(2400,1600);List<String> requested=Collections.synchronizedList(new ArrayList<>());
        ImageLoader loader=new ImageLoader(context,(client,asset,id)->{requested.add(id);return connection(bytes);});
        var client=new NikkiSyncClient(PC,null);var photo=asset("entry",1,hash(bytes));ImageView grid=new ImageView(context);
        var activity=Robolectric.buildActivity(app.nikkisync.mobile.MainActivity.class).get();
        try{
            loader.load(client,photo,grid);await(()->grid.getDrawable()!=null);assertEquals(512,grid.getDrawable().getIntrinsicWidth());
            for(var entry:Map.of("imageLoader",loader,"client",client).entrySet()){var field=activity.getClass().getDeclaredField(entry.getKey());field.setAccessible(true);field.set(activity,entry.getValue());}
            ImageView viewer=new ImageView(context);viewer.setImageDrawable(grid.getDrawable());viewer.setRotation(90);
            var method=activity.getClass().getDeclaredMethod("loadViewerPhoto",AssetSummary.class,ImageView.class,boolean.class);method.setAccessible(true);method.invoke(activity,photo,viewer,true);
            await(()->viewer.getDrawable()!=null&&viewer.getDrawable().getIntrinsicWidth()==2048);
            assertEquals(List.of("preview","original"),requested);assertEquals(90,viewer.getRotation(),.001);
        }finally{loader.shutdown();for(String name:List.of("io","organizerIo","organizerNetworkIo")){var field=activity.getClass().getDeclaredField(name);field.setAccessible(true);((java.util.concurrent.ExecutorService)field.get(activity)).shutdownNow();}}
    }
    @Test public void memoryAndDiskChoicesPersistAndRespectTheRuntimeHeap() {
        var context=RuntimeEnvironment.getApplication();var settings=new PhotoCachePreferences(context);
        settings.setThumbnailMiB(2048);settings.setPreviewMiB(1024);settings.setMemoryMiB(256);
        settings=new PhotoCachePreferences(context);assertEquals(2048L*1024*1024,settings.thumbnailBytes());assertEquals(1024L*1024*1024,settings.previewBytes());
        assertTrue(settings.effectiveMemoryBytes(192L*1024*1024)<=64L*1024*1024);
        assertEquals(256L*1024*1024,settings.effectiveMemoryBytes(2L*1024*1024*1024));
        assertThrows(IllegalArgumentException.class,()->new PhotoCachePreferences(context).setThumbnailMiB(Integer.MAX_VALUE));
    }
    @Test public void olderPcDetailsUpgradeTheViewerToItsOriginalStillWithoutChangingTheGridIdentity()throws Exception{
        var photo=asset("legacy-detail",2,"a".repeat(64));
        var detail=new AssetDetail(photo.assetId(),"photo","ready",List.of(new MediaResource("real-original","source_high_quality","photo.jpg","image/jpeg","jpg",10,"b".repeat(64),4000,3000,null)),false,null,null,null,null);
        var upgraded=ImageLoader.withFullPreview(photo,detail);
        assertEquals("real-original",PhotoCacheKey.resource(upgraded,true));assertEquals("b".repeat(64),PhotoCacheKey.contentHash(upgraded,true));
        assertEquals(PhotoCacheKey.thumbnail(PC,photo),PhotoCacheKey.thumbnail(PC,upgraded));
        assertTrue(PhotoDiskCache.previewEdge(128L*1024*1024)<=1280);assertEquals(2048,PhotoDiskCache.previewEdge(1024L*1024*1024));
    }
    @Test public void corruptedCachedThumbnailIsReplacedAndMismatchedTransfersAreNeverPublished()throws Exception {
        var context=RuntimeEnvironment.getApplication();byte[] bytes=jpeg(80,60);AtomicInteger requests=new AtomicInteger();
        ImageLoader loader=new ImageLoader(context,(client,asset,id)->{requests.incrementAndGet();return connection(bytes);});
        try{
            var good=asset("corrupt",1,hash(bytes));File target=loader.photos.thumbnail(PC,good);target.getParentFile().mkdirs();try(var out=new FileOutputStream(target)){out.write(new byte[]{1,2,3});}
            ImageView view=new ImageView(context);loader.load(new NikkiSyncClient(PC,null),good,view);await(()->view.getDrawable()!=null);assertEquals(1,requests.get());
            var wrong=asset("bad-hash",1,"f".repeat(64));loader.load(new NikkiSyncClient(PC,null),wrong,new ImageView(context));await(()->requests.get()==2);Thread.sleep(80);
            assertFalse(loader.photos.thumbnail(PC,wrong).exists());
        }finally{loader.shutdown();}
    }
}
