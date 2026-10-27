package app.nikkisync.mobile.ui;

import android.content.Context;
import android.app.Activity;
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
import app.nikkisync.mobile.ui.chrome.ChromePage;
import app.nikkisync.mobile.ui.chrome.ChromeNavigationHost;
import app.nikkisync.mobile.ui.chrome.ChromeSheetLayout;

/** One bottom drawer for all filters; expanded source choices remain drafts until Apply. */
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
    private final LinearLayout form;
    private final Button recover;
    private ChromeNavigationHost navigation;
    private final android.widget.ScrollView scrolling;
    private View openChoices;
    private String uid,folder;
    public String selectedUid(){return uid;}
    public String selectedFolder(){return folder;}
    public SavedFilterSheet withSources(java.util.List<app.nikkisync.mobile.model.Models.AssetSummary> assets,String currentUid,String currentFolder,boolean gallery){
        uid=currentUid;folder=currentFolder;
        java.util.SortedSet<String> uids=new java.util.TreeSet<>(),folders=new java.util.TreeSet<>();
        for(var asset:assets){uids.add(asset.uid()==null?"":asset.uid());folders.add(asset.sourceFolder()==null?"":asset.sourceFolder());}
        if(uid!=null)uids.add(uid);if(folder!=null)folders.add(folder);
        int position=form.getChildCount()-1;
        form.addView(scopeChoice("所属 UID",uids,uid,true),position++);form.addView(scopeChoice("来源文件夹",folders,folder,false),position);
        if(gallery){sortButtons[0].setText("最新拍摄");sortButtons[1].setText("最早拍摄");recover.setVisibility(GONE);}
        return this;
    }
    private View scopeChoice(String title,java.util.SortedSet<String> options,String selected,boolean byUid){
        LinearLayout box=new LinearLayout(getContext());box.setOrientation(VERTICAL);box.addView(section(title,12));
        java.util.List<String> values=new java.util.ArrayList<>();values.add(null);values.addAll(options);
        var contexts=SourceFolderLabels.contexts(values);
        Button choices=button(sourceLabel(selected,byUid,contexts));choices.setTag(byUid?"source-uid":"source-folder");
        choices.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);choices.setPadding(dp(14),dp(10),dp(14),dp(10));choices.setMinHeight(dp(48));choices.setMinimumHeight(dp(48));
        box.addView(choices,new LayoutParams(-1,-2));
        android.widget.ListView list=sourceOptions(values,byUid,contexts,choices);list.setVisibility(GONE);
        LayoutParams optionsLp=new LayoutParams(-1,dp(Math.min(224,values.size()*(byUid?56:88))));optionsLp.topMargin=dp(8);box.addView(list,optionsLp);
        choices.setOnClickListener(v->{boolean expand=list.getVisibility()!=VISIBLE;if(openChoices!=null)openChoices.setVisibility(GONE);list.setVisibility(expand?VISIBLE:GONE);openChoices=expand?list:null;choices.setContentDescription(title+(expand?"，已展开":"，已收起"));if(expand){scrolling.getViewTreeObserver().addOnGlobalLayoutListener(new android.view.ViewTreeObserver.OnGlobalLayoutListener(){public void onGlobalLayout(){scrolling.getViewTreeObserver().removeOnGlobalLayoutListener(this);if(list.getVisibility()==VISIBLE)scrolling.scrollTo(0,box.getTop());}});}});
        return box;
    }

    private String sourceLabel(String value,boolean byUid,java.util.Map<String,String> contexts){
        if(byUid)return (value==null?"全部账号":value.isEmpty()?"未识别 UID":"UID "+value)+"  ⌄";
        String name=SourceFolderLabels.title(value);return name+(value==null||value.isEmpty()?"  ⌄":"\n"+contexts.getOrDefault(value,value)+"  ⌄");
    }

    private android.widget.ListView sourceOptions(java.util.List<String> values,boolean byUid,java.util.Map<String,String> contexts,Button trigger){
        android.widget.ListView list=new android.widget.ListView(getContext());list.setDivider(null);list.setSelector(android.R.color.transparent);list.setBackgroundColor(Color.TRANSPARENT);
        list.setOnTouchListener((view,event)->{if(event.getActionMasked()==android.view.MotionEvent.ACTION_DOWN)view.getParent().requestDisallowInterceptTouchEvent(list.canScrollVertically(1)||list.canScrollVertically(-1));if(event.getActionMasked()==android.view.MotionEvent.ACTION_UP||event.getActionMasked()==android.view.MotionEvent.ACTION_CANCEL)view.getParent().requestDisallowInterceptTouchEvent(false);return false;});
        list.setAdapter(new android.widget.BaseAdapter(){
            public int getCount(){return values.size();}public String getItem(int position){return values.get(position);}public long getItemId(int position){return position;}
            public View getView(int position,View convert,ViewGroup parent){
                String value=getItem(position);boolean selected=java.util.Objects.equals(value,byUid?uid:folder);
                LinearLayout option=new LinearLayout(getContext());option.setOrientation(HORIZONTAL);option.setGravity(Gravity.CENTER_VERTICAL);option.setPadding(dp(12),dp(12),dp(12),dp(12));option.setMinimumHeight(dp(48));option.setTag(value);
                android.graphics.drawable.GradientDrawable surface=new android.graphics.drawable.GradientDrawable();surface.setColor(selected?0xFFF4DCE5:0xEDFFF8FA);surface.setCornerRadius(dp(16));surface.setStroke(dp(1),0xB3FFFFFF);option.setBackground(surface);
                LinearLayout text=new LinearLayout(getContext());text.setOrientation(VERTICAL);option.addView(text,new LayoutParams(0,-2,1));
                String name=byUid?(value==null?"全部账号":value.isEmpty()?"未识别 UID":"UID "+value):SourceFolderLabels.title(value);
                TextView heading=label(name,14,selected,getContext().getColor(R.color.text_primary));heading.setSingleLine(false);text.addView(heading,new LayoutParams(-1,-2));
                if(!byUid&&value!=null&&!value.isEmpty()){
                    TextView path=label(contexts.getOrDefault(value,value),12,false,getContext().getColor(R.color.text_secondary));path.setPadding(0,dp(6),0,0);path.setContentDescription("展开完整路径："+value);
                    path.setOnClickListener(v->path.setText(value));
                    path.setOnLongClickListener(v->{var clipboard=(android.content.ClipboardManager)getContext().getSystemService(Context.CLIPBOARD_SERVICE);clipboard.setPrimaryClip(android.content.ClipData.newPlainText("来源文件夹",value));android.widget.Toast.makeText(getContext(),"已复制完整路径",android.widget.Toast.LENGTH_SHORT).show();return true;});text.addView(path,new LayoutParams(-1,-2));
                }
                TextView check=label(selected?"✓":"",16,true,getContext().getColor(R.color.text_primary));check.setGravity(Gravity.CENTER);option.addView(check,new LayoutParams(dp(24),-2));
                option.setContentDescription(name+(value==null?"":"，"+value)+(selected?"，已选中":""));option.setFocusable(true);
                option.setOnClickListener(v->{if(byUid)uid=value;else folder=value;trigger.setText(sourceLabel(value,byUid,contexts));list.setVisibility(GONE);openChoices=null;notifyDataSetChanged();scrolling.scrollTo(0,0);});
                android.widget.FrameLayout spacing=new android.widget.FrameLayout(getContext());spacing.setPadding(0,0,0,dp(8));spacing.addView(option,new android.widget.FrameLayout.LayoutParams(-1,-2));return spacing;
            }
        });
        return list;
    }

    public void show(Activity activity){navigation=((ChromePage.Owner)activity).navigationHost();navigation.showSheet(this);}
    public void dismiss(){if(navigation!=null)navigation.dismiss(this);}
    @Override protected void onMeasure(int widthSpec,int heightSpec){int maximum=View.MeasureSpec.getSize(heightSpec);super.onMeasure(widthSpec,View.MeasureSpec.makeMeasureSpec(Math.round(maximum*.88f),View.MeasureSpec.AT_MOST));}

    public SavedFilterSheet(Context context, int currentFilter, int currentSort) {
        super(context);
        filter=currentFilter;
        sort=currentSort;
        setOrientation(VERTICAL);
        setPadding(0,0,0,0);
        android.graphics.drawable.GradientDrawable surface=new android.graphics.drawable.GradientDrawable();surface.setColor(0xB3FFF8FA);surface.setCornerRadius(dp(28));surface.setStroke(dp(1),0xB3FFFFFF);setBackground(surface);
        form=new LinearLayout(context);form.setOrientation(VERTICAL);
        scrolling=new android.widget.ScrollView(context);scrolling.setFillViewport(false);scrolling.addView(form,new android.widget.ScrollView.LayoutParams(-1,-2));scrolling.setFocusableInTouchMode(true);

        LinearLayout header=new LinearLayout(context);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title=label("筛选与排序",22,true,context.getColor(R.color.text_primary));
        header.addView(title,new LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1));
        Button cancel=button("取消");
        cancel.setOnClickListener(v->{if(listener!=null)listener.onCancel();});
        header.addView(cancel);

        form.addView(section("照片类型",10));
        LinearLayout filters=row();
        filterButtons[0]=choice(filters,"全部",SavedViewState.FILTER_ALL,true);
        filterButtons[1]=choice(filters,"LIVE",SavedViewState.FILTER_MOTION,true);
        filterButtons[2]=choice(filters,"普通",SavedViewState.FILTER_STILL,true);
        form.addView(filters);

        form.addView(section("排序方式",14));
        LinearLayout sorts=row();
        sortButtons[0]=choice(sorts,"最近保存",SavedViewState.SORT_SAVED,false);
        sortButtons[1]=choice(sorts,"拍摄时间",SavedViewState.SORT_CAPTURED,false);
        form.addView(sorts);

        Button apply=button("应用");
        LayoutParams applyLp=new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(48));
        apply.setOnClickListener(v->{
            if(listener==null||actionSubmitted)return;
            actionSubmitted=true;
            apply.setEnabled(false);
            listener.onApply(filter,sort);
        });
        LinearLayout footer=new LinearLayout(context);footer.setPadding(0,dp(12),0,0);footer.addView(apply,applyLp);
        addView(new ChromeSheetLayout(context,header,scrolling,footer).wrapContentForm(),new LayoutParams(-1,-2));

        recover=button("找回历史保存");
        recover.setTextColor(context.getColor(R.color.text_secondary));
        LayoutParams recoverLp=new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(40));
        recoverLp.topMargin=dp(12);
        recover.setOnClickListener(v->{
            if(listener==null||actionSubmitted)return;
            actionSubmitted=true;
            recover.setEnabled(false);
            listener.onRecoverHistoricalSavedPhotos();
        });
        form.addView(recover,recoverLp);
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
        Button button=new Button(getContext(),null,0);button.setText(value);button.setTextSize(12);button.setAllCaps(false);button.setStateListAnimator(null);button.setMinWidth(0);button.setMinimumWidth(0);button.setPadding(dp(12),dp(8),dp(12),dp(8));
        button.setTextColor(getContext().getColor(R.color.text_primary));button.setBackgroundResource(R.drawable.bg_glass_chip);
        button.setMinHeight(dp(38));button.setMinimumHeight(dp(38));return button;
    }
    private int dp(int value) {return Math.round(value*getResources().getDisplayMetrics().density);}
}
