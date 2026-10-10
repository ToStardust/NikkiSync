package app.nikkisync.mobile.share;
import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.*;
import android.widget.*;
import app.nikkisync.mobile.R;
import app.nikkisync.mobile.ui.GalleryUxStyle;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Executor;

/** Decodes one preview at a time. Late worker results cannot reopen a dismissed dialog. */
public final class ShareCardPreviewDialog extends Dialog {
    private final Activity activity;
    private final ShareCardPreparation.Prepared prepared;
    private final ShareCardExportCoordinator coordinator;
    private final Executor worker;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final Map<Integer,Uri> saved=new HashMap<>();
    private ImageView image;private Button previous,next,save,share;
    private TextView pageText,status;private Bitmap bitmap;
    private ProgressBar saveProgress;
    private int page,sequence;private boolean closed,loading,saving;
    public ShareCardPreviewDialog(Activity activity,ShareCardPreparation.Prepared prepared,
                                  ShareCardExportCoordinator coordinator,Executor worker,boolean metadataMissing) {
        super(activity);this.activity=activity;this.prepared=prepared;this.coordinator=coordinator;this.worker=worker;
        LinearLayout root=new LinearLayout(activity);root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(16),dp(12),dp(16),dp(12));root.setBackgroundResource(R.drawable.bg_gallery_ambient);
        TextView title=new TextView(activity);title.setText("穿搭与参数分享图");title.setTextSize(20);
        title.setTextColor(activity.getColor(R.color.text_primary));root.addView(title);
        ScrollView scroll=new ScrollView(activity);image=new ImageView(activity);image.setAdjustViewBounds(true);
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        scroll.addView(image,new ScrollView.LayoutParams(-1,-2));
        root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        pageText=new TextView(activity);pageText.setGravity(Gravity.CENTER);root.addView(pageText);
        status=new TextView(activity);status.setTextSize(12);status.setTextColor(activity.getColor(R.color.text_secondary));
        String note=metadataMissing?"没有离线参数快照，当前图只含已有信息。":"生成完成后可保存当前页。";
        if(prepared.missingIcons()>0) note+=" "+prepared.missingIcons()+" 件部件图标暂缺，可连接电脑后重新生成。";
        status.setText(note);root.addView(status);
        saveProgress=new ProgressBar(activity,null,android.R.attr.progressBarStyleHorizontal);
        saveProgress.setMax(100);saveProgress.setVisibility(View.GONE);
        saveProgress.setProgressTintList(android.content.res.ColorStateList.valueOf(0xFFC77F9C));
        root.addView(saveProgress,new LinearLayout.LayoutParams(-1,-2));
        LinearLayout pages=new LinearLayout(activity);
        previous=button("上一页",false);next=button("下一页",false);
        pages.addView(previous,new LinearLayout.LayoutParams(0,-2,1));pages.addView(next,new LinearLayout.LayoutParams(0,-2,1));
        root.addView(pages);
        save=button("保存当前页到相册",true);root.addView(save,new LinearLayout.LayoutParams(-1,-2));
        share=button("分享已保存的当前页",false);root.addView(share,new LinearLayout.LayoutParams(-1,-2));
        Button close=button("关闭",false);root.addView(close);setContentView(root);
        previous.setOnClickListener(v->{page--;load();});next.setOnClickListener(v->{page++;load();});
        close.setOnClickListener(v->dismiss());
        save.setOnClickListener(v->{
            final int selected=page;saving=true;update();status.setText("正在保存到相册…");
            saveProgress.setVisibility(View.VISIBLE);saveProgress.setIndeterminate(true);
            coordinator.save(prepared,selected,new ShareCardExportCoordinator.SaveListener() {
                public void onProgress(String stage,long done,long total) {
                    if(closed)return;saveProgress.setIndeterminate(total<=0);
                    if(total>0)saveProgress.setProgress((int)Math.min(100,done*100.0/total));
                    status.setText(stage+(total>0?" · "+(int)Math.min(100,done*100.0/total)+"%":"…"));
                }
                public void onSuccess(Uri uri) {saved.put(selected,uri);saving=false;if(closed)return;status.setText("当前页已保存到相册。");update();}
                public void onFailure(Exception error) {saving=false;if(closed)return;saveProgress.setVisibility(View.GONE);status.setText("保存失败，可重试："+error.getMessage());update();}
            });
        });
        share.setOnClickListener(v->{
            Uri uri=saved.get(page);if(uri==null)return;
            try {activity.startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("image/png")
                    .putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),"分享 NikkiSync 参数图"));}
            catch(Exception error) {Toast.makeText(activity,"当前设备没有可用的分享应用",Toast.LENGTH_LONG).show();}
        });
        setOnDismissListener(dialog->{
            closed=true;sequence++;image.setImageDrawable(null);
            if(bitmap!=null) {bitmap.recycle();bitmap=null;}prepared.close();
        });
    }
    @Override public void show() {
        super.show();getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT,(int)(activity.getResources().getDisplayMetrics().heightPixels*.92));
        load();
    }
    private void load() {
        int token=++sequence,selected=page;loading=true;update();
        worker.execute(()->{
            try {
                Bitmap result=prepared.preview(selected);if(result==null)throw new IllegalStateException("分享图无法预览");
                main.post(()->{
                    if(closed || token!=sequence) {result.recycle();return;}
                    image.setImageBitmap(result);Bitmap old=bitmap;bitmap=result;if(old!=null)old.recycle();
                    loading=false;update();
                });
            } catch(Exception error) {
                main.post(()->{if(closed || token!=sequence)return;loading=false;status.setText("预览失败："+error.getMessage());update();});
            }
        });
    }
    private void update() {
        pageText.setText((page+1)+" / "+prepared.pageCount()+(loading?" · 正在加载…":""));
        previous.setEnabled(!loading&&!saving&&page>0);next.setEnabled(!loading&&!saving&&page+1<prepared.pageCount());
        previous.setVisibility(prepared.pageCount()>1?View.VISIBLE:View.GONE);next.setVisibility(previous.getVisibility());
        save.setText(saved.containsKey(page)?"当前页已保存":saving?"正在保存…":"保存当前页到相册");
        save.setEnabled(!loading&&!saving&&!saved.containsKey(page));share.setEnabled(!loading&&!saving&&saved.containsKey(page));
    }
    private int dp(int value){return Math.round(value*activity.getResources().getDisplayMetrics().density);}
    private Button button(String text,boolean primary) {
        Button button=new Button(activity);button.setText(text);button.setAllCaps(false);button.setTextSize(14);
        button.setTextColor(activity.getColor(R.color.text_primary));
        button.setBackground(GalleryUxStyle.glassButton(activity));
        button.setMinHeight(dp(44));button.setPadding(dp(12),dp(8),dp(12),dp(8));return button;
    }
}
