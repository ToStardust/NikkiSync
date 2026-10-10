package app.nikkisync.mobile.inspiration;

import android.content.Context;
import android.graphics.Typeface;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import app.nikkisync.mobile.R;
import app.nikkisync.mobile.ui.GalleryUxStyle;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/** Three input groups, rendered inside the existing native GPU liquid-glass sheet. */
public final class InspirationEditorForm extends LinearLayout {
    private final EditText code;
    private final LinearLayout categoryChoices;
    private final LinkedHashSet<String> available=new LinkedHashSet<>(), selected=new LinkedHashSet<>();
    private final List<Button> typeButtons=new ArrayList<>(), statusButtons=new ArrayList<>();
    private String codeType, status;
    private Runnable addCategory=()->{};

    public InspirationEditorForm(Context context,String initialCode,String initialType,String initialStatus,List<String> categories) {
        super(context);setOrientation(VERTICAL);setPadding(0,dp(8),0,dp(8));
        codeType=initialType;status=initialStatus;selected.addAll(categories);available.addAll(categories);
        LinearLayout codes=section("填入染色码 / 搭配码");
        LinearLayout types=new LinearLayout(context);codes.addView(types);
        for(String type:List.of("outfit","dye")) {
            Button choice=button(type.equals("outfit")?"搭配码":"染色码");choice.setTag(type);typeButtons.add(choice);
            types.addView(choice,weighted());choice.setOnClickListener(v->{codeType=type;updateChoices(typeButtons,codeType);});
        }
        updateChoices(typeButtons,codeType);
        code=new EditText(context);code.setText(initialCode);code.setHint("粘贴完整染色码或搭配码");
        code.setTextSize(14);code.setTextColor(context.getColor(R.color.text_primary));code.setHintTextColor(context.getColor(R.color.text_secondary));
        code.setMinLines(2);code.setMaxLines(4);code.setPadding(dp(12),dp(12),dp(12),dp(12));
        code.setBackground(GalleryUxStyle.glassButton(context));
        code.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(20000)});
        LayoutParams codeLp=new LayoutParams(-1,-2);codeLp.topMargin=dp(8);codes.addView(code,codeLp);

        LinearLayout categoriesSection=section("选择分类");categoryChoices=new LinearLayout(context);categoryChoices.setOrientation(VERTICAL);
        categoriesSection.addView(categoryChoices);
        Button create=button("＋ 新增分类");create.setOnClickListener(v->addCategory.run());categoriesSection.addView(create,new LayoutParams(-1,dp(42)));
        renderCategories();

        LinearLayout statuses=section("选择状态");
        List<String> options=new ArrayList<>(List.of("self","want","reproduced"));
        if(!options.contains(initialStatus))options.add(initialStatus); // Keep legacy tried/archived records editable.
        LinearLayout row=null;
        for(int i=0;i<options.size();i++) {
            if(i%2==0){row=new LinearLayout(context);statuses.addView(row);}
            String value=options.get(i);Button choice=button(statusLabel(value));choice.setTag(value);statusButtons.add(choice);
            row.addView(choice,weighted());choice.setOnClickListener(v->{status=value;updateChoices(statusButtons,status);});
        }
        updateChoices(statusButtons,status);
    }
    public String rawCode(){return code.getText().toString();}
    public String codeType(){return codeType;}
    public String status(){return status;}
    public List<String> categories(){return List.copyOf(selected);}
    public void onAddCategory(Runnable action){addCategory=action;}
    public void availableCategories(List<String> names){available.addAll(names);renderCategories();}
    public void addCategory(String name){available.add(name);selected.add(name);renderCategories();}
    private void renderCategories() {
        categoryChoices.removeAllViews();
        if(available.isEmpty()){TextView empty=label("暂未分类",13,false);empty.setTextColor(getContext().getColor(R.color.text_secondary));categoryChoices.addView(empty);}
        LinearLayout row=null;int i=0;
        for(String name:available) {
            if(i++%2==0){row=new LinearLayout(getContext());categoryChoices.addView(row);}
            Button choice=button(name);choice.setSelected(selected.contains(name));styleChoice(choice);
            choice.setOnClickListener(v->{if(!selected.remove(name))selected.add(name);choice.setSelected(selected.contains(name));styleChoice(choice);});
            row.addView(choice,weighted());
        }
    }
    private LinearLayout section(String title) {
        LinearLayout section=new LinearLayout(getContext());section.setOrientation(VERTICAL);section.setPadding(dp(12),dp(12),dp(12),dp(12));
        section.setBackgroundResource(R.drawable.bg_glass_card);TextView heading=label(title,15,true);heading.setPadding(0,0,0,dp(8));section.addView(heading);
        LayoutParams lp=new LayoutParams(-1,-2);lp.bottomMargin=dp(10);addView(section,lp);return section;
    }
    private void updateChoices(List<Button> buttons,String value){for(Button button:buttons){button.setSelected(value.equals(button.getTag()));styleChoice(button);}}
    private void styleChoice(Button button){button.setBackgroundResource(button.isSelected()?R.drawable.bg_selected_glass:R.drawable.bg_glass_chip);}
    private TextView label(String value,int size,boolean bold){TextView text=new TextView(getContext());text.setText(value);text.setTextSize(size);text.setTextColor(getContext().getColor(R.color.text_primary));if(bold)text.setTypeface(Typeface.DEFAULT_BOLD);return text;}
    private Button button(String value){Button button=new Button(getContext());button.setText(value);button.setAllCaps(false);button.setTextSize(13);button.setTextColor(getContext().getColor(R.color.text_primary));button.setBackground(GalleryUxStyle.glassButton(getContext()));return button;}
    private LayoutParams weighted(){LayoutParams lp=new LayoutParams(0,dp(44),1);lp.setMargins(0,0,dp(5),dp(6));return lp;}
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private static String statusLabel(String value){return switch(value){case "self"->"自搭";case "want"->"想尝试";case "reproduced"->"已复刻";case "tried"->"试过了";case "archived"->"已归档";default->"想尝试";};}
}
