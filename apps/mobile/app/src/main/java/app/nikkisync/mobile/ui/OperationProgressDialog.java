package app.nikkisync.mobile.ui;

import android.app.Activity;
import android.app.Dialog;
import android.content.res.ColorStateList;
import android.view.ViewGroup;
import android.widget.*;
import app.nikkisync.mobile.R;

/** Visible over full-screen photo pages as well as the gallery. */
public final class OperationProgressDialog extends Dialog {
    private final ProgressBar progress;
    private final TextView status;
    private boolean closed;
    public OperationProgressDialog(Activity activity,String title,Runnable cancel) {
        super(activity);
        LinearLayout body=new LinearLayout(activity);body.setOrientation(LinearLayout.VERTICAL);
        int pad=Math.round(22*activity.getResources().getDisplayMetrics().density);body.setPadding(pad,pad,pad,pad);
        body.setBackgroundResource(R.drawable.bg_glass_card);
        TextView heading=new TextView(activity);heading.setText(title);heading.setTextSize(19);
        heading.setTextColor(activity.getColor(R.color.text_primary));body.addView(heading);
        status=new TextView(activity);status.setTextSize(13);status.setTextColor(activity.getColor(R.color.text_secondary));
        status.setPadding(0,pad/2,0,pad/2);body.addView(status);
        progress=new ProgressBar(activity,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);
        progress.setProgressTintList(ColorStateList.valueOf(0xFFC77F9C));
        progress.setIndeterminateTintList(ColorStateList.valueOf(0xFFC77F9C));
        body.addView(progress,new LinearLayout.LayoutParams(-1,-2));
        setContentView(body);setCanceledOnTouchOutside(false);setCancelable(cancel!=null);
        if(cancel!=null) {
            Button stop=new Button(activity);stop.setText("取消生成");stop.setAllCaps(false);
            stop.setBackground(GalleryUxStyle.glassButton(activity));stop.setTextColor(activity.getColor(R.color.text_primary));
            body.addView(stop);stop.setOnClickListener(v->cancel());setOnCancelListener(d->cancel.run());
        }
        update("准备中…",0,0);
    }
    @Override public void show(){super.show();getWindow().setLayout((int)(getContext().getResources().getDisplayMetrics().widthPixels*.88),ViewGroup.LayoutParams.WRAP_CONTENT);}
    @Override public void dismiss(){closed=true;super.dismiss();}
    public void update(String stage,long completed,long total){
        if(closed)return;boolean measured=total>0;
        int percent=measured?(int)Math.max(0,Math.min(100,completed*100.0/total)):0;
        progress.setIndeterminate(!measured);if(measured)progress.setProgress(percent);
        String amount=total>=1024&& (stage.contains("下载")||stage.contains("写入"))
                ?String.format(java.util.Locale.ROOT,"%.1f / %.1f MB",completed/1048576.0,total/1048576.0)
                :completed+" / "+total;
        status.setText(stage+(measured?" · "+percent+"%  ("+amount+")":""));
    }
    ProgressBar bar(){return progress;}
    TextView label(){return status;}
}
