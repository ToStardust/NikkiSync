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
import app.nikkisync.mobile.R;
import app.nikkisync.mobile.BuildConfig;
import android.content.ClipData;
import android.content.ClipboardManager;
import app.nikkisync.mobile.ui.GalleryUxStyle;

/** Live-specific controls; the Activity owns per-photo rotation state, never a global batch angle. */
public final class LivePhotoControls {
    private static final String PREFS="nikkisync_live_export",KEY="profile_override";
    private LivePhotoControls(){}
    private static int dp(Context context,int value){return Math.round(value*context.getResources().getDisplayMetrics().density);}
    private static Button action(Context context,String text,boolean primary){
        Button button=new Button(context);button.setText(text);button.setAllCaps(false);button.setTextSize(13);
        button.setTextColor(context.getColor(R.color.text_primary));
        button.setBackground(GalleryUxStyle.glassButton(context));
        button.setMinHeight(dp(context,44));button.setPadding(dp(context,14),dp(context,8),dp(context,14),dp(context,8));button.setStateListAnimator(null);
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,ViewGroup.LayoutParams.WRAP_CONTENT);lp.setMargins(dp(context,4),dp(context,6),dp(context,4),dp(context,6));button.setLayoutParams(lp);return button;
    }
    public static void attachSaved(Context context,LinearLayout parent,SavedPhotoStore.Record record,SavedPhotoHealthStore.Entry health){
        if(!record.hasMotion())return;
        TextView status=new TextView(context);status.setTextSize(12);status.setTextColor(context.getColor(R.color.text_secondary));
        String warning=health==null?null:health.motionWarning();
        status.setText(warning!=null?warning:record.exportHasMotion()==null?"历史 Live 记录：导出完整性与相册播放均待核验。":"Live 容器结构已校验；系统相册完整播放仍待确认。");
        parent.addView(status);
        if(!record.companionUris().isEmpty()){
            Button video=action(context,"播放动态视频（双文件保底）",false);
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
    public static IntConsumer attach(Context context,LinearLayout parent,ImageView preview,int initial,IntConsumer remember){
        int[] degrees={QuarterTurn.normalize(initial)};LinearLayout row=new LinearLayout(context);row.setGravity(Gravity.CENTER_VERTICAL);
        Button left=action(context,"左转 90°",false),right=action(context,"右转 90°",false);
        TextView value=new TextView(context);value.setTextColor(context.getColor(R.color.text_primary));value.setGravity(Gravity.CENTER);value.setText(degrees[0]+"°");
        IntConsumer rotate=delta->{degrees[0]=QuarterTurn.normalize(degrees[0]+delta);preview.setRotation(degrees[0]);value.setText(degrees[0]+"°");remember.accept(degrees[0]);};
        left.setOnClickListener(v->rotate.accept(-90));right.setOnClickListener(v->rotate.accept(90));
        row.addView(left);row.addView(value,new LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1));row.addView(right);parent.addView(row);
        TextView note=new TextView(context);note.setText("Live 旋转会同步处理封面和完整视频，非零角度需要重新编码；不覆盖原文件。当前预览为封面，动态方向以导出后的播放验收为准。");
        note.setTextSize(12);note.setTextColor(context.getColor(R.color.text_secondary));parent.addView(note);
        Button profile=action(context,"Live 格式："+selectedProfile(context).label,true);
        TextView guidance=new TextView(context);guidance.setTextSize(12);
        guidance.setTextColor(context.getColor(R.color.text_secondary));
        guidance.setText(selectedProfile(context).guidance());
        profile.setOnClickListener(v->{
            LivePhotoProfile[] all=LivePhotoProfile.values();String[] labels=new String[all.length+1];labels[0]="自动选择（推荐）";
            for(int i=0;i<all.length;i++)labels[i+1]=all[i].label;
            String override=context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).getString(KEY,"");int selected=0;
            for(int i=0;i<all.length;i++)if(all[i].id.equals(override))selected=i+1;
            new AlertDialog.Builder(context).setTitle("选择 Live 封装候选").setSingleChoiceItems(labels,selected,(dialog,which)->{
                context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putString(KEY,which==0?"":all[which-1].id).apply();
                profile.setText("Live 格式："+selectedProfile(context).label);dialog.dismiss();
                guidance.setText(selectedProfile(context).guidance());
            }).setNegativeButton("取消",null).show();
        });parent.addView(profile);
        parent.addView(guidance);
        TextView scope=new TextView(context);scope.setTextSize(12);scope.setTextColor(context.getColor(R.color.text_secondary));
        scope.setText("默认按设备选择格式，也可手动更改。兼容性取决于系统与图库版本；华为/荣耀使用兼容封装，荣耀官方 SDK 与原生鸿蒙客户端尚未接入。");parent.addView(scope);
        Button report=action(context,"复制当前设备测试信息",false);
        report.setOnClickListener(v->{
            LivePhotoProfile selected=selectedProfile(context);
            String details="NikkiSync Live 测试信息\n品牌："+Build.MANUFACTURER+" / "+Build.BRAND
                    +"\n型号："+Build.MODEL+"\nAndroid："+Build.VERSION.RELEASE+" / API "+Build.VERSION.SDK_INT
                    +"\n系统构建："+Build.DISPLAY+"\nApp："+BuildConfig.VERSION_NAME+" ("+BuildConfig.VERSION_CODE+")"
                    +"\n格式："+selected.id+"\n当前照片旋转："+degrees[0]+"°"
                    +"\n相册名称 / 版本 / 地区：待填写"
                    +"\n识别 LIVE / 完整动态 / 声音 / 关闭重开 / 重启后播放：待实机填写";
            ClipboardManager clipboard=(ClipboardManager)context.getSystemService(Context.CLIPBOARD_SERVICE);
            if(clipboard!=null) {clipboard.setPrimaryClip(ClipData.newPlainText("Live 测试信息",details));
                Toast.makeText(context,"已复制设备与格式信息",Toast.LENGTH_SHORT).show();}
        });parent.addView(report);
        return rotate;
    }
}
