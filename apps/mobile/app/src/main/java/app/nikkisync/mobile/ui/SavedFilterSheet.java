package app.nikkisync.mobile.ui;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import app.nikkisync.mobile.R;
import app.nikkisync.mobile.storage.SavedViewState;

/** A short, app-owned filter sheet. Choices remain drafts until Apply is tapped. */
public final class SavedFilterSheet extends LinearLayout {
    public interface Listener {
        void onApply(int filter, int sort);
        void onRecoverHistoricalSavedPhotos();
        void onCancel();
    }

    private final Button[] filterButtons = new Button[3];
    private final Button[] sortButtons = new Button[2];
    private int filter;
    private int sort;
    private boolean actionSubmitted;
    private Listener listener;

    public SavedFilterSheet(Context context, int currentFilter, int currentSort) {
        super(context);
        filter=currentFilter;
        sort=currentSort;
        setOrientation(VERTICAL);
        setPadding(dp(18),dp(16),dp(18),dp(18));
        setBackgroundColor(Color.TRANSPARENT);

        LinearLayout header=new LinearLayout(context);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title=label("筛选与排序",19,true,context.getColor(R.color.text_primary));
        header.addView(title,new LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1));
        Button cancel=button("取消");
        cancel.setOnClickListener(v->{if(listener!=null)listener.onCancel();});
        header.addView(cancel);
        addView(header);

        addView(section("照片类型",10));
        LinearLayout filters=row();
        filterButtons[0]=choice(filters,"全部",SavedViewState.FILTER_ALL,true);
        filterButtons[1]=choice(filters,"LIVE",SavedViewState.FILTER_MOTION,true);
        filterButtons[2]=choice(filters,"普通",SavedViewState.FILTER_STILL,true);
        addView(filters);

        addView(section("排序方式",14));
        LinearLayout sorts=row();
        sortButtons[0]=choice(sorts,"最近保存",SavedViewState.SORT_SAVED,false);
        sortButtons[1]=choice(sorts,"拍摄时间",SavedViewState.SORT_CAPTURED,false);
        addView(sorts);

        Button apply=button("应用");
        LayoutParams applyLp=new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(44));
        applyLp.topMargin=dp(18);
        apply.setOnClickListener(v->{
            if(listener==null||actionSubmitted)return;
            actionSubmitted=true;
            apply.setEnabled(false);
            listener.onApply(filter,sort);
        });
        addView(apply,applyLp);

        Button recover=button("找回历史保存");
        recover.setTextColor(context.getColor(R.color.text_secondary));
        LayoutParams recoverLp=new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(40));
        recoverLp.topMargin=dp(12);
        recover.setOnClickListener(v->{
            if(listener==null||actionSubmitted)return;
            actionSubmitted=true;
            recover.setEnabled(false);
            listener.onRecoverHistoricalSavedPhotos();
        });
        addView(recover,recoverLp);
        updateChoices();
    }

    public void setListener(Listener next) {listener=next;}

    public static String triggerLabel(int filter,int sort) {
        String type=switch(filter) {
            case SavedViewState.FILTER_MOTION -> "LIVE";
            case SavedViewState.FILTER_STILL -> "普通";
            default -> "全部";
        };
        return "筛选 · "+type+" · "+(sort==SavedViewState.SORT_CAPTURED?"拍摄时间":"最近保存");
    }

    private Button choice(LinearLayout row,String title,int value,boolean isFilter) {
        Button choice=button(title);
        choice.setBackgroundColor(Color.TRANSPARENT);
        choice.setOnClickListener(v->{if(isFilter)filter=value;else sort=value;updateChoices();});
        LayoutParams lp=new LayoutParams(0,dp(40),1);
        if(row.getChildCount()>0)lp.leftMargin=dp(6);
        row.addView(choice,lp);
        return choice;
    }

    private void updateChoices() {
        for(int i=0;i<filterButtons.length;i++)style(filterButtons[i],filter==i);
        for(int i=0;i<sortButtons.length;i++)style(sortButtons[i],sort==i);
    }

    private void style(Button button,boolean selected) {
        button.setTypeface(selected?Typeface.DEFAULT_BOLD:Typeface.DEFAULT);
        button.setAlpha(selected?1f:.65f);
        button.setBackgroundResource(selected?R.drawable.bg_glass_chip:android.R.color.transparent);
        button.setSelected(selected);
    }

    private LinearLayout row() {LinearLayout row=new LinearLayout(getContext());row.setGravity(Gravity.CENTER_VERTICAL);return row;}
    private TextView section(String value,int topMargin) {
        TextView heading=label(value,12,true,getContext().getColor(R.color.text_secondary));
        heading.setPadding(dp(2),dp(topMargin),dp(2),dp(7));
        return heading;
    }
    private TextView label(String value,int sp,boolean bold,int color) {
        TextView label=new TextView(getContext());label.setText(value);label.setTextSize(sp);label.setTextColor(color);
        if(bold)label.setTypeface(Typeface.DEFAULT_BOLD);
        return label;
    }
    private Button button(String value) {
        Button button=new Button(getContext());button.setText(value);button.setTextSize(12);button.setAllCaps(false);
        button.setTextColor(getContext().getColor(R.color.text_primary));button.setBackgroundResource(R.drawable.bg_glass_chip);
        button.setMinHeight(dp(38));button.setMinimumHeight(dp(38));return button;
    }
    private int dp(int value) {return Math.round(value*getResources().getDisplayMetrics().density);}
}
