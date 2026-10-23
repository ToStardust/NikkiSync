package app.nikkisync.mobile.storage;

import android.content.Context;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.model.Models.PairedServer;
import org.json.*;
import java.util.*;

/** User-owned pending intentions survive app/process restarts, independently of disposable thumbnail caches. */
public final class OrganizerStore extends SQLiteOpenHelper {
    public record Entry(String id,AssetSummary asset,String state,String message) {
        public boolean pending(){return Set.of("local","preparing","pending","confirming","queued","checking").contains(state);}
    }
    public OrganizerStore(Context context){super(context.getApplicationContext(),"nikkisync-organizer.db",null,2);setWriteAheadLoggingEnabled(true);}
    public static String scope(PairedServer server){return server==null?"":server.serverId()+":"+server.tlsFingerprintSha256();}
    @Override public void onCreate(SQLiteDatabase db){
        db.execSQL("CREATE TABLE library(scope TEXT NOT NULL,asset_id TEXT NOT NULL,summary TEXT NOT NULL,snapshot_position INTEGER NOT NULL,PRIMARY KEY(scope,asset_id))");
        db.execSQL("CREATE TABLE deletions(id TEXT PRIMARY KEY,scope TEXT NOT NULL,asset_id TEXT NOT NULL,summary TEXT NOT NULL,state TEXT NOT NULL,message TEXT NOT NULL,created INTEGER NOT NULL,approval TEXT NOT NULL DEFAULT '')");
    }
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){
        if(oldVersion==1&&newVersion==2){
            db.execSQL("ALTER TABLE library ADD COLUMN snapshot_position INTEGER NOT NULL DEFAULT 0");
            // v1 wrote the complete online snapshot in insertion order. Recover that
            // order while offline; do not rebuild chronology from nullable dates or IDs.
            db.execSQL("UPDATE library SET snapshot_position=rowid");
            return;
        }
        throw new IllegalStateException("Unsupported organizer schema");
    }
    public synchronized void remember(String scope,List<AssetSummary> assets)throws Exception{
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{db.delete("library","scope=?",new String[]{scope});
            int position=0;
            for(AssetSummary asset:assets){ContentValues value=new ContentValues();value.put("scope",scope);value.put("asset_id",asset.assetId());value.put("summary",FavoritePhotoStore.encode(asset).toString());value.put("snapshot_position",position++);db.insertOrThrow("library",null,value);}db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }
    public synchronized List<AssetSummary> library(String scope){List<AssetSummary> out=new ArrayList<>();try(Cursor rows=getReadableDatabase().rawQuery("SELECT summary FROM library WHERE scope=? ORDER BY snapshot_position ASC, rowid ASC",new String[]{scope})){while(rows.moveToNext())try{out.add(FavoritePhotoStore.decode(new JSONObject(rows.getString(0))));}catch(Exception ignored){}}return out;}
    public synchronized List<Entry> entries(String scope){List<Entry> out=new ArrayList<>();try(Cursor rows=getReadableDatabase().rawQuery("SELECT id,summary,state,message FROM deletions WHERE scope=? ORDER BY created DESC",new String[]{scope})){while(rows.moveToNext())try{out.add(new Entry(rows.getString(0),FavoritePhotoStore.decode(new JSONObject(rows.getString(1))),rows.getString(2),rows.getString(3)));}catch(Exception ignored){}}return out;}
    public synchronized void enqueue(String scope,List<AssetSummary> photos)throws Exception{
        if(scope.isBlank())throw new IllegalStateException("No paired computer");
        var existing=entries(scope);long count=existing.stream().filter(e->e.pending()||e.state().equals("executing")||e.state().equals("cancel_requested")).count();
        if(count+photos.size()>500)throw new IllegalStateException("待处理照片最多 500 张，请先连接电脑处理");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{for(AssetSummary asset:photos){
            if(existing.stream().anyMatch(e->e.asset().assetId().equals(asset.assetId())&&(e.pending()||e.state().equals("executing"))))continue;
            ContentValues value=new ContentValues();value.put("id",UUID.randomUUID().toString());value.put("scope",scope);value.put("asset_id",asset.assetId());value.put("summary",FavoritePhotoStore.encode(asset).toString());value.put("state","local");value.put("message","仅手机记录 · 等待重连并由电脑确认");value.put("created",System.currentTimeMillis());db.insertOrThrow("deletions",null,value);
        }db.setTransactionSuccessful();}finally{db.endTransaction();}
    }
    public synchronized void cancel(String scope,Collection<String> ids){SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{for(String id:ids){
        ContentValues values=new ContentValues();values.put("state","cancel_requested");values.put("message","已在手机取消，重连后通知电脑；若电脑已开始处理，请检查回收站");
        db.update("deletions",values,"scope=? AND id=? AND state IN ('local','preparing','pending','confirming','queued','checking')",new String[]{scope,id});
    }db.setTransactionSuccessful();}finally{db.endTransaction();}}
    public synchronized JSONArray outgoing(String scope)throws Exception{JSONArray items=new JSONArray();for(Entry entry:entries(scope))if(entry.pending()||entry.state().equals("executing")||entry.state().equals("cancel_requested")){
        JSONObject item=new JSONObject().put("id",entry.id()).put("assetId",entry.asset().assetId()).put("revision",entry.asset().revision()).put("cancel",entry.state().equals("cancel_requested"));
        if(entry.state().equals("confirming"))try(Cursor rows=getReadableDatabase().rawQuery("SELECT approval FROM deletions WHERE scope=? AND id=?",new String[]{scope,entry.id()})){if(rows.moveToFirst())item.put("approval",rows.getString(0));}
        items.put(item);
    }return items;}
    public synchronized void acknowledge(String scope,JSONArray results)throws Exception{SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{
        for(int i=0;i<results.length();i++){JSONObject row=results.getJSONObject(i);String state=row.getString("state");
            if(!Set.of("preparing","pending","confirming","queued","checking","cancelled","recycled","rejected","changed","failed","executing").contains(state))continue;
            ContentValues values=new ContentValues();values.put("state",state);values.put("message",row.optString("message"));
            values.put("approval",row.optString("approval",""));
            String where="scope=? AND id=?"+(Set.of("preparing","pending","confirming","queued","checking").contains(state)?" AND state<>'cancel_requested'":"");db.update("deletions",values,where,new String[]{scope,row.getString("id")});
        }db.setTransactionSuccessful();}finally{db.endTransaction();}}
    /** A new desktop challenge gets one prompt follow-up, not another 15-second polling interval. */
    public static boolean needsFollowUp(JSONArray sent,JSONArray received){
        for(int i=0;i<received.length();i++){JSONObject row=received.optJSONObject(i);if(row==null||!"confirming".equals(row.optString("state")))continue;
            String approval=row.optString("approval","");if(approval.isBlank())continue;
            for(int j=0;j<sent.length();j++){JSONObject request=sent.optJSONObject(j);if(request!=null&&row.optString("id").equals(request.optString("id"))&&!request.optBoolean("cancel")&&!approval.equals(request.optString("approval","")))return true;}
        }return false;
    }
}
