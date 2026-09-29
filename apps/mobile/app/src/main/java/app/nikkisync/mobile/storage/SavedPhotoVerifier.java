package app.nikkisync.mobile.storage;

import android.content.Context;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class SavedPhotoVerifier {
    private SavedPhotoVerifier() {}
    public static Map<String,SavedPhotoHealthStore.Entry> verify(Context context,SavedPhotoHealthStore healthStore,List<SavedPhotoStore.Record> records){
        Map<String,SavedPhotoHealthStore.Entry> result=new LinkedHashMap<>();long checkedAt=System.currentTimeMillis();
        for(SavedPhotoStore.Record record:records){
            SavedPhotoHealthStore.State state=canOpen(context,record.uri())?SavedPhotoHealthStore.State.ACTIVE:SavedPhotoHealthStore.State.MISSING;
            if(state==SavedPhotoHealthStore.State.ACTIVE){
                for(String companion:record.companionUris())if(!canOpen(context,companion)){state=SavedPhotoHealthStore.State.MOTION_MISSING;break;}
                if(state==SavedPhotoHealthStore.State.ACTIVE&&record.companionUris().isEmpty()
                    &&(record.format()!=null&&record.format().contains("OriginOS LIVE")||"vivo_legacy_pair".equals(record.motionProfileId())))state=SavedPhotoHealthStore.State.MOTION_UNVERIFIED;
            }
            healthStore.put(record.uri(),state,checkedAt);result.put(record.uri(),new SavedPhotoHealthStore.Entry(state,checkedAt));
        }return result;
    }
    public static Map<String,SavedPhotoHealthStore.Entry> verifyUris(Context context,SavedPhotoHealthStore healthStore,List<String> uris){
        Map<String,SavedPhotoHealthStore.Entry> result=new LinkedHashMap<>();long checkedAt=System.currentTimeMillis();
        for(String uri:uris){if(uri==null||uri.isBlank()||result.containsKey(uri))continue;
            SavedPhotoHealthStore.State state=canOpen(context,uri)?SavedPhotoHealthStore.State.ACTIVE:SavedPhotoHealthStore.State.MISSING;
            healthStore.put(uri,state,checkedAt);result.put(uri,new SavedPhotoHealthStore.Entry(state,checkedAt));
        }return result;
    }
    private static boolean canOpen(Context context,String uri){
        try(ParcelFileDescriptor descriptor=context.getContentResolver().openFileDescriptor(Uri.parse(uri),"r")){return descriptor!=null;}catch(Exception ignored){return false;}
    }
}