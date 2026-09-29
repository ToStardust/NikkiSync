package app.nikkisync.mobile.media.live;

import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import app.nikkisync.mobile.storage.SavedPhotoStore;
import app.nikkisync.mobile.storage.SavedPhotoHealthStore;
import java.util.function.IntConsumer;

/** Live-specific controls; the Activity owns per-photo rotation state, never a global batch angle. */
public final class LivePhotoControls {
    private static final String PREFS="nikkisync_live_export",KEY="profile_override";
    private LivePhotoControls(){}
    public static void attachSaved(Context context,LinearLayout parent,SavedPhotoStore.Record record,SavedPhotoHealthStore.Entry health){
        if(!record.hasMotion())return;
        TextView status=new TextView(context);status.setTextSize(12);
        String warning=health==null?null:health.motionWarning();
        status.setText(warning!=null?warning:record.exportHasMotion()==null?"历史 Live 记录：导出完整性与相册播放均待核验。":"Live 容器结构已校验；系统相册完整播放仍待确认。");
        parent.addView(status);
        if(!record.companionUris().isEmpty()){
            Button video=new Button(context);video.setText("播放动态视频（双文件保底）");
            video.setEnabled(health==null||health.state()!=SavedPhotoHealthStore.State.MOTION_MISSING);
            video.setOnClickListener(v->{try{context.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(record.companionUris().get(0)),"video/mp4").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));}
                catch(Exception e){Toast.makeText(context,"无法打开动态视频，请检查文件或播放器",Toast.LENGTH_LONG).show();}});parent.addView(video);
        }
    }
    public static LivePhotoProfile selectedProfile(Context context){
        String id=context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).getString(KEY,"");
        if(id!=null&&!id.isEmpty())try{return LivePhotoProfile.fromId(id);}catch(IllegalArgumentException ignored){}
        return LivePhotoProfile.defaultFor(Build.MANUFACTURER,Build.BRAND);
    }
    public static void attach(Context context,LinearLayout parent,ImageView preview,int initial,IntConsumer remember){
        int[] degrees={QuarterTurn.normalize(initial)};LinearLayout row=new LinearLayout(context);row.setGravity(Gravity.CENTER_VERTICAL);
        Button left=new Button(context),right=new Button(context);left.setText("左转 90°");right.setText("右转 90°");
        TextView value=new TextView(context);value.setGravity(Gravity.CENTER);value.setText(degrees[0]+"°");
        IntConsumer rotate=delta->{degrees[0]=QuarterTurn.normalize(degrees[0]+delta);remember.accept(degrees[0]);preview.setRotation(degrees[0]);value.setText(degrees[0]+"°");};
        left.setOnClickListener(v->rotate.accept(-90));right.setOnClickListener(v->rotate.accept(90));
        row.addView(left);row.addView(value,new LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1));row.addView(right);parent.addView(row);
        TextView note=new TextView(context);note.setText("Live 旋转会同步处理封面和完整视频，非零角度需要重新编码；不覆盖原文件。当前预览为封面，动态方向以导出后的播放验收为准。");
        note.setTextSize(11);parent.addView(note);
        Button profile=new Button(context);profile.setAllCaps(false);profile.setText("Live 格式："+selectedProfile(context).label);
        profile.setOnClickListener(v->{
            LivePhotoProfile[] all=LivePhotoProfile.values();String[] labels=new String[all.length+1];labels[0]="自动选择（不代表机型已验收）";
            for(int i=0;i<all.length;i++)labels[i+1]=all[i].label;
            String override=context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).getString(KEY,"");int selected=0;
            for(int i=0;i<all.length;i++)if(all[i].id.equals(override))selected=i+1;
            new AlertDialog.Builder(context).setTitle("选择 Live 封装候选").setSingleChoiceItems(labels,selected,(dialog,which)->{
                context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putString(KEY,which==0?"":all[which-1].id).apply();
                profile.setText("Live 格式："+selectedProfile(context).label);dialog.dismiss();
            }).setNegativeButton("取消",null).show();
        });parent.addView(profile);
        TextView scope=new TextView(context);scope.setTextSize(11);
        scope.setText("支持状态按系统/相册版本分别验收。荣耀 SDK 和原生鸿蒙尚未接入；未知环境默认尝试标准格式，不保证原生相册识别。");parent.addView(scope);
    }
}