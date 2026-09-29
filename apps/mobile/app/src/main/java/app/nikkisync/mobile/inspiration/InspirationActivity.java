package app.nikkisync.mobile.inspiration;

import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import app.nikkisync.mobile.R;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Offline-first Outfit Inspiration notebook; no PC connection or game access is required. */
public final class InspirationActivity extends ComponentActivity {
    private static final String[] TYPE_LABELS = {"待识别", "搭配码", "染色码"};
    private static final String[] TYPES = {"unknown", "outfit", "dye"};
    private static final String[] STATUS_LABELS = {"想尝试", "试过了", "已复刻", "已归档"};
    private static final String[] STATUSES = {"want", "tried", "reproduced", "archived"};
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ArrayList<Uri> pendingImages = new ArrayList<>();
    private ActivityResultLauncher<String> pickImages;
    private InspirationStore store;
    private InspirationImageStore imageStore;
    private LinearLayout results;
    private EditText search, categoryFilter;
    private Spinner statusFilter;
    private AlertDialog activeEditor;
    private TextView pendingImageLabel;
    private int pendingImageLimit;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        pickImages = registerForActivityResult(new ActivityResultContracts.GetMultipleContents(), uris -> {
            if (activeEditor == null || !activeEditor.isShowing()) return;
            for (Uri uri : uris) if (uri != null && "content".equals(uri.getScheme())
                    && !pendingImages.contains(uri) && pendingImages.size() < pendingImageLimit)
                pendingImages.add(uri);
            updatePendingImageLabel();
        });
        store = new InspirationStore(this);
        imageStore = new InspirationImageStore(this);
        buildScreen();
        refresh();
        InspirationShareImport.Incoming incoming = InspirationShareImport.from(getIntent());
        if (!incoming.sourceText().isBlank() || !incoming.imageUris().isEmpty())
            main.post(() -> { if (!isFinishing() && !isDestroyed()) showEditor(null, incoming); });
    }

    @Override protected void onDestroy() {
        if (activeEditor != null) activeEditor.dismiss();
        io.execute(store::close);
        io.shutdown();
        super.onDestroy();
    }

    private void buildScreen() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(getColor(R.color.app_background));
        LinearLayout root = column(); root.setPadding(dp(16), dp(18), dp(16), dp(40));
        scroll.addView(root);
        setContentView(scroll);

        TextView title = text("穿搭灵感库", 26, true); root.addView(title);
        TextView subtitle = text("收藏搭配码、染色码和参考图。离线也能查看与复制。", 13, false);
        subtitle.setTextColor(getColor(R.color.text_secondary)); subtitle.setPadding(0, dp(5), 0, dp(15)); root.addView(subtitle);
        Button add = button("＋ 记录新的灵感"); add.setOnClickListener(v -> showEditor(null, null)); root.addView(add, rowParams());

        search = field("搜索标题、分享码、来源或标签", "");
        root.addView(search, rowParams());
        categoryFilter = field("筛选自定义分类（可留空）", "");
        root.addView(categoryFilter, rowParams());
        statusFilter = spinner(new String[] {"全部状态", "想尝试", "试过了", "已复刻", "已归档"}, 0);
        root.addView(statusFilter, rowParams());
        Button filter = button("搜索 / 刷新"); filter.setOnClickListener(v -> refresh()); root.addView(filter, rowParams());
        results = column(); root.addView(results);
    }

    private void refresh() {
        if (results == null) return;
        String query = search.getText().toString(), category = categoryFilter.getText().toString().trim();
        int selected = statusFilter.getSelectedItemPosition();
        String status = selected <= 0 ? null : STATUSES[selected - 1];
        io.execute(() -> {
            try {
                List<InspirationStore.Entry> entries = store.search(query, status, category);
                main.post(() -> { if (!isFinishing() && !isDestroyed()) render(entries); });
            } catch (Exception error) { showError(error); }
        });
    }

    private void render(List<InspirationStore.Entry> entries) {
        results.removeAllViews();
        if (entries.isEmpty()) {
            TextView empty = text("还没有符合条件的灵感。\n看到喜欢的搭配时，可以粘贴分享码，或从其他 App 分享到这里。", 14, false);
            empty.setTextColor(getColor(R.color.text_secondary)); empty.setPadding(dp(8), dp(30), dp(8), dp(20));
            results.addView(empty); return;
        }
        for (InspirationStore.Entry entry : entries) {
            LinearLayout card = column(); card.setPadding(dp(14), dp(12), dp(14), dp(12));
            card.setBackgroundResource(R.drawable.bg_glass_card);
            card.addView(text(entry.title(), 17, true));
            String code = entry.code().rawCode().isBlank() ? "尚未填写分享码" : entry.code().rawCode();
            TextView info = text(statusLabel(entry.status()) + " · " + typeLabel(entry.code().type())
                    + "\n" + code + (entry.categories().isEmpty() ? "" : "\n分类：" + String.join("、", entry.categories()))
                    + (entry.tags().isEmpty() ? "" : "\n标签：" + String.join("、", entry.tags()))
                    + (entry.images().isEmpty() ? "" : "\n参考图：" + entry.images().size() + " 张"), 13, false);
            info.setTextColor(getColor(R.color.text_secondary)); info.setPadding(0, dp(6), 0, dp(8)); card.addView(info);
            LinearLayout actions = new LinearLayout(this);
            Button copy = button("复制码"); copy.setEnabled(!entry.code().rawCode().isBlank());
            copy.setOnClickListener(v -> copyCode(entry.code().rawCode())); actions.addView(copy, weighted());
            Button edit = button("查看 / 编辑"); edit.setOnClickListener(v -> showEditor(entry, null));
            actions.addView(edit, weighted()); card.addView(actions);
            if (!entry.images().isEmpty()) {
                Button viewImages = button("查看参考图"); viewImages.setOnClickListener(v -> showImages(entry));
                card.addView(viewImages, rowParams());
            }
            LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(-1, -2);
            cardParams.topMargin = dp(10); results.addView(card, cardParams);
        }
    }

    private void showEditor(InspirationStore.Entry existing, InspirationShareImport.Incoming incoming) {
        pendingImages.clear();
        if (incoming != null) pendingImages.addAll(incoming.imageUris());
        pendingImageLimit = Math.max(0, 5 - (existing == null ? 0 : existing.images().size()));
        if (pendingImages.size() > pendingImageLimit) pendingImages.subList(pendingImageLimit, pendingImages.size()).clear();

        ScrollView scroll = new ScrollView(this); LinearLayout form = column();
        form.setPadding(dp(18), dp(8), dp(18), dp(8)); scroll.addView(form);
        EditText title = field("标题", existing == null ? "" : existing.title()); form.addView(title);
        EditText code = field("分享码（没有时可先留空）", existing == null ? incoming == null ? "" : incoming.codeSuggestion() : existing.code().rawCode()); form.addView(code);
        Spinner type = spinner(TYPE_LABELS, indexOf(TYPES, existing == null ? "unknown" : existing.code().type())); form.addView(type);
        EditText source = field("来源原文", existing == null ? incoming == null ? "" : incoming.sourceText() : existing.code().sourceText());
        source.setMinLines(2); form.addView(source);
        EditText link = field("来源链接（可选）", existing == null ? incoming == null || incoming.sourceUrl() == null ? "" : incoming.sourceUrl()
                : existing.code().sourceUrl() == null ? "" : existing.code().sourceUrl()); form.addView(link);
        if (existing != null) {
            source.setEnabled(false); link.setEnabled(false);
            TextView preserved = text("来源原文与链接会保留原样；修改标题、备注或解析结果不会覆盖它们。", 12, false);
            preserved.setTextColor(getColor(R.color.text_secondary)); form.addView(preserved);
        }
        EditText tags = field("标签，用逗号分隔", existing == null ? "" : String.join("，", existing.tags())); form.addView(tags);
        EditText categories = field("自定义分类，用逗号分隔", existing == null ? "" : String.join("，", existing.categories())); form.addView(categories);
        EditText notes = field("自己的备注", existing == null ? "" : existing.notes()); notes.setMinLines(2); form.addView(notes);
        Spinner status = spinner(STATUS_LABELS, indexOf(STATUSES, existing == null ? "want" : existing.status())); form.addView(status);
        pendingImageLabel = text("", 12, false); updatePendingImageLabel(); form.addView(pendingImageLabel);
        Button pick = button("添加参考图片（最多 5 张）");
        pick.setEnabled(pendingImageLimit > 0); pick.setOnClickListener(v -> pickImages.launch("image/*")); form.addView(pick, rowParams());
        if (existing != null) {
            Button delete = button("删除这条灵感");
            delete.setOnClickListener(v -> new AlertDialog.Builder(this).setTitle("删除这条灵感？")
                    .setMessage("只移除 NikkiSync 的本地收藏，不会删除来源图片或系统相册文件。")
                    .setNegativeButton("取消", null).setPositiveButton("删除", (d, which) -> {
                        activeEditor.dismiss();
                        io.execute(() -> {
                            store.delete(existing.id(), System.currentTimeMillis());
                            for (InspirationStore.Image image : existing.images())
                                try { imageStore.deleteLocal(image.localName()); }
                                catch (IOException error) { android.util.Log.w("NikkiSyncInspiration", "Private image cleanup pending", error); }
                            main.post(this::refresh);
                        });
                    }).show());
            form.addView(delete, rowParams());
        }
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle(existing == null ? "记录穿搭灵感" : "编辑穿搭灵感")
                .setView(scroll).setNegativeButton("取消", null).setPositiveButton("保存", null).create();
        activeEditor = dialog;
        dialog.setOnDismissListener(d -> { if (activeEditor == dialog) { activeEditor = null; pendingImages.clear(); pendingImageLabel = null; } });
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String titleText = title.getText().toString(), codeText = code.getText().toString();
            String sourceText = source.getText().toString(), linkText = link.getText().toString();
            String noteText = notes.getText().toString();
            List<String> tagList = splitNames(tags.getText().toString()), categoryList = splitNames(categories.getText().toString());
            String typeValue = TYPES[type.getSelectedItemPosition()], statusValue = STATUSES[status.getSelectedItemPosition()];
            ArrayList<Uri> images = new ArrayList<>(pendingImages);
            Button save = dialog.getButton(AlertDialog.BUTTON_POSITIVE); save.setEnabled(false);
            io.execute(() -> {
                try {
                    InspirationStore.Entry entry;
                    long now = System.currentTimeMillis();
                    if (existing == null) entry = store.create(new InspirationStore.Draft(titleText, codeText, typeValue,
                            sourceText, linkText, noteText, tagList, categoryList, statusValue), now);
                    else {
                        store.updateUserFields(existing.id(), titleText, noteText, tagList, categoryList, statusValue, now);
                        if (!codeText.equals(existing.code().rawCode()) || !typeValue.equals(existing.code().type()))
                            store.updateCode(existing.id(), codeText, typeValue, now + 1);
                        entry = store.get(existing.id());
                    }
                    int failedImages = 0;
                    for (Uri uri : images) {
                        InspirationImageStore.Saved copied = null;
                        try {
                            copied = imageStore.copyUri(getContentResolver(), uri);
                            store.attachImage(entry.id(), copied.localName(), copied.mimeType(), copied.bytes(), now);
                        } catch (Exception imageError) {
                            failedImages++;
                            if (copied != null) try { imageStore.deleteLocal(copied.localName()); } catch (IOException ignored) {}
                        }
                    }
                    int failures = failedImages;
                    main.post(() -> {
                        if (!isFinishing() && !isDestroyed()) {
                            dialog.dismiss(); refresh();
                            toast(failures == 0 ? "灵感已保存在手机" : "文字已保存，" + failures + " 张参考图未能复制");
                        }
                    });
                } catch (Exception error) {
                    main.post(() -> { if (dialog.isShowing()) save.setEnabled(true); showError(error); });
                }
            });
        }));
        dialog.show();
    }

    private void showImages(InspirationStore.Entry entry) {
        ScrollView scroll = new ScrollView(this); LinearLayout holder = column();
        holder.setPadding(dp(12), dp(12), dp(12), dp(12)); scroll.addView(holder);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle(entry.title() + " · 参考图")
                .setView(scroll).setPositiveButton("完成", null).create(); dialog.show();
        io.execute(() -> {
            for (InspirationStore.Image image : entry.images()) {
                try {
                    String path = imageStore.resolve(image.localName()).getAbsolutePath();
                    BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                    BitmapFactory.decodeFile(path, bounds);
                    BitmapFactory.Options options = new BitmapFactory.Options();
                    options.inSampleSize = Math.max(1, Math.max(bounds.outWidth, bounds.outHeight) / 900);
                    Bitmap bitmap = BitmapFactory.decodeFile(path, options);
                    main.post(() -> {
                        if (!dialog.isShowing() || bitmap == null) return;
                        ImageView view = new ImageView(this); view.setImageBitmap(bitmap);
                        view.setAdjustViewBounds(true); view.setScaleType(ImageView.ScaleType.FIT_CENTER);
                        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.bottomMargin = dp(10);
                        holder.addView(view, params);
                    });
                } catch (Exception ignored) { /* Missing private copy remains a visible record, never an invented image. */ }
            }
        });
    }

    private void updatePendingImageLabel() {
        if (pendingImageLabel != null) pendingImageLabel.setText("待添加参考图：" + pendingImages.size() + " 张");
    }
    private void copyCode(String value) {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (clipboard == null || value.isBlank()) return;
        clipboard.setPrimaryClip(ClipData.newPlainText("暖暖分享码", value)); toast("分享码已复制");
    }
    private void showError(Exception error) {
        main.post(() -> { if (!isFinishing() && !isDestroyed()) toast("保存失败：" + error.getMessage()); });
    }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    private LinearLayout column() { LinearLayout view = new LinearLayout(this); view.setOrientation(LinearLayout.VERTICAL); return view; }
    private TextView text(String value, int sp, boolean bold) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(sp); view.setTextColor(getColor(R.color.text_primary));
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD); return view;
    }
    private EditText field(String hint, String value) {
        EditText view = new EditText(this); view.setHint(hint); view.setText(value); view.setTextSize(14);
        view.setSingleLine(false); view.setMaxLines(5); return view;
    }
    private Button button(String label) {
        Button view = new Button(this); view.setText(label); view.setAllCaps(false); view.setTextSize(13);
        view.setTextColor(getColor(R.color.text_primary));
        GradientDrawable background = new GradientDrawable(); background.setColor(0xE8FFFFFF); background.setCornerRadius(dp(16));
        background.setStroke(dp(1), 0x1A000000); view.setBackground(background); return view;
    }
    private Spinner spinner(String[] labels, int selected) {
        Spinner spinner = new Spinner(this); ArrayAdapter<String> adapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item, labels); spinner.setAdapter(adapter); spinner.setSelection(selected); return spinner;
    }
    private LinearLayout.LayoutParams rowParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.bottomMargin = dp(9); return params;
    }
    private LinearLayout.LayoutParams weighted() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(42), 1); params.rightMargin = dp(5); return params;
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private static int indexOf(String[] values, String value) {
        for (int i = 0; i < values.length; i++) if (values[i].equals(value)) return i;
        return 0;
    }
    private static String statusLabel(String value) { return STATUS_LABELS[indexOf(STATUSES, value)]; }
    private static String typeLabel(String value) { return TYPE_LABELS[indexOf(TYPES, value)]; }
    private static List<String> splitNames(String raw) {
        if (raw == null || raw.isBlank()) return List.of();
        return Arrays.stream(raw.split("[,，]")) .map(String::trim).filter(value -> !value.isEmpty()).distinct().toList();
    }
}
