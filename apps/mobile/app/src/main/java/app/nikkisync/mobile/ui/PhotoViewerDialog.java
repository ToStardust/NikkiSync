package app.nikkisync.mobile.ui;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import app.nikkisync.mobile.media.ImageLoader;
import app.nikkisync.mobile.model.Models.AssetDetail;
import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.net.NikkiSyncClient;
import app.nikkisync.mobile.storage.RotationStore;
import app.nikkisync.mobile.storage.SharedPreferencesRotationBackend;

import org.json.JSONObject;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

public final class PhotoViewerDialog extends Dialog {
    public interface Callbacks {
        void onSave(AssetSummary asset);
        void onEditMetadata(AssetSummary asset, AssetDetail detail, Consumer<AssetDetail> onUpdated);
        default void onRotationChanged(AssetSummary asset, int degrees) {}
    }

    private final Activity activity;
    private final ViewerSession session;
    private final ImageLoader images;
    private final NikkiSyncClient client;
    private final Callbacks callbacks;
    private final RotationStore rotationStore;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService detailExecutor = Executors.newSingleThreadExecutor();
    private final Map<String, AssetDetail> detailCache = new ConcurrentHashMap<>();
    private final ViewerInteractionState interactionState = new ViewerInteractionState();

    private ZoomableImageView image;
    private LinearLayout topChrome;
    private LinearLayout bottomChrome;
    private TextView title;
    private TextView position;
    private TextView liveBadge;
    private TextView rotationBadge;
    private Button restoreRotation;
    private Dialog activeInfoSheet;

    public PhotoViewerDialog(
            Activity activity,
            ViewerSession session,
            ImageLoader images,
            NikkiSyncClient client,
            Callbacks callbacks
    ) {
        super(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        this.activity = activity;
        this.session = session;
        this.images = images;
        this.client = client;
        this.callbacks = callbacks;
        this.rotationStore = new RotationStore(new SharedPreferencesRotationBackend(activity));
        buildUi();
        setOnDismissListener(ignored -> {
            if (activeInfoSheet != null && activeInfoSheet.isShowing()) activeInfoSheet.dismiss();
            detailExecutor.shutdownNow();
        });
    }

    public void showViewer() {
        show();
        Window window = getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.BLACK));
            window.setStatusBarColor(Color.BLACK);
            window.setNavigationBarColor(Color.BLACK);
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        }
        renderCurrent();
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(activity);
        root.setBackgroundColor(Color.BLACK);

        image = new ZoomableImageView(activity, interactionState);
        image.setBackgroundColor(Color.BLACK);
        image.setContentDescription("照片预览");
        image.setGestureListener(new ZoomableImageView.GestureListener() {
            @Override public void onSingleTap() {
                interactionState.toggleChrome();
                applyChromeVisibility();
            }

            @Override public void onSwipeLeft() {
                if (session.moveNext()) renderCurrent();
            }

            @Override public void onSwipeRight() {
                if (session.movePrevious()) renderCurrent();
            }
        });
        root.addView(image, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        topChrome = new LinearLayout(activity);
        topChrome.setGravity(Gravity.CENTER_VERTICAL);
        topChrome.setPadding(dp(12), dp(12), dp(12), dp(10));
        topChrome.setBackgroundColor(0x88000000);

        Button close = chromeButton("关闭");
        close.setOnClickListener(v -> dismiss());
        topChrome.addView(close);

        LinearLayout heading = new LinearLayout(activity);
        heading.setOrientation(LinearLayout.VERTICAL);
        heading.setGravity(Gravity.CENTER);
        title = label("", 14, true, Color.WHITE);
        position = label("", 11, false, 0xCCFFFFFF);
        heading.addView(title);
        heading.addView(position);
        topChrome.addView(heading, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        rotationBadge = label("", 10, true, Color.WHITE);
        rotationBadge.setPadding(dp(8), dp(4), dp(8), dp(4));
        rotationBadge.setBackground(roundRect(0xB8333333, 12));
        LinearLayout.LayoutParams rotationBadgeLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        rotationBadgeLp.setMargins(0, 0, dp(6), 0);
        topChrome.addView(rotationBadge, rotationBadgeLp);

        liveBadge = label("LIVE", 10, true, Color.WHITE);
        liveBadge.setPadding(dp(8), dp(4), dp(8), dp(4));
        liveBadge.setBackground(roundRect(0xB8333333, 12));
        topChrome.addView(liveBadge);

        FrameLayout.LayoutParams topLp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP
        );
        root.addView(topChrome, topLp);

        bottomChrome = new LinearLayout(activity);
        bottomChrome.setGravity(Gravity.CENTER);
        bottomChrome.setPadding(dp(16), dp(12), dp(16), dp(18));
        bottomChrome.setBackgroundColor(0x88000000);

        Button save = chromeButton("保存");
        save.setOnClickListener(v -> saveCurrent());
        Button info = chromeButton("信息");
        info.setOnClickListener(v -> showInfoSheet(session.current()));
        Button rotate = chromeButton("旋转 ↻");
        rotate.setOnClickListener(v -> rotateCurrentClockwise());
        restoreRotation = chromeButton("还原");
        restoreRotation.setOnClickListener(v -> restoreCurrentRotation());

        LinearLayout.LayoutParams actionLp = new LinearLayout.LayoutParams(0, dp(48), 1);
        actionLp.setMargins(dp(4), 0, dp(4), 0);
        bottomChrome.addView(save, actionLp);
        bottomChrome.addView(info, actionLp);
        bottomChrome.addView(rotate, actionLp);
        bottomChrome.addView(restoreRotation, actionLp);

        FrameLayout.LayoutParams bottomLp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM
        );
        root.addView(bottomChrome, bottomLp);

        setContentView(root);
    }

    private void renderCurrent() {
        AssetSummary asset = session.current();
        int degrees = rotationStore.get(asset.assetId());
        image.resetZoom();
        image.setQuarterRotationDegrees(degrees);
        images.loadPreview(client, asset, image);
        title.setText(asset.gameVersion() == null ? "版本未知" : asset.gameVersion() + " 版本");
        position.setText((session.position() + 1) + " / " + session.size());
        liveBadge.setVisibility(asset.hasMotion() ? View.VISIBLE : View.GONE);
        applyRotationControls(asset, degrees);
        applyChromeVisibility();
    }

    private void rotateCurrentClockwise() {
        AssetSummary asset = session.current();
        int next = RotationDegrees.nextClockwise(rotationStore.get(asset.assetId()));
        rotationStore.set(asset.assetId(), next);
        image.setQuarterRotationDegrees(next);
        applyRotationControls(asset, next);
        callbacks.onRotationChanged(asset, next);
    }

    private void restoreCurrentRotation() {
        AssetSummary asset = session.current();
        rotationStore.set(asset.assetId(), 0);
        image.setQuarterRotationDegrees(0);
        applyRotationControls(asset, 0);
        callbacks.onRotationChanged(asset, 0);
    }

    private void applyRotationControls(AssetSummary asset, int degrees) {
        boolean rotated = degrees != 0;
        rotationBadge.setText(rotated ? degrees + "°" : "");
        rotationBadge.setVisibility(rotated ? View.VISIBLE : View.GONE);
        restoreRotation.setVisibility(rotated ? View.VISIBLE : View.GONE);
        if (rotated && asset.hasMotion()) {
            rotationBadge.setContentDescription("旋转 " + degrees + " 度，LIVE 仅预览");
        } else {
            rotationBadge.setContentDescription(rotated ? "旋转 " + degrees + " 度" : null);
        }
    }

    private void saveCurrent() {
        AssetSummary asset = session.current();
        int degrees = rotationStore.get(asset.assetId());
        RotationSavePolicy.Mode mode = RotationSavePolicy.select(degrees, asset.hasMotion());
        if (mode == RotationSavePolicy.Mode.ROTATED_LIVE_UNSUPPORTED) {
            Toast.makeText(activity,
                    "旋转后的 LIVE 照片暂不支持保存；请还原为 0° 后保存原始 LIVE。",
                    Toast.LENGTH_LONG).show();
            return;
        }
        callbacks.onSave(asset);
    }

    private void applyChromeVisibility() {
        int visibility = interactionState.isChromeVisible() ? View.VISIBLE : View.GONE;
        topChrome.setVisibility(visibility);
        bottomChrome.setVisibility(visibility);
    }

    private void showInfoSheet(AssetSummary asset) {
        if (activeInfoSheet != null && activeInfoSheet.isShowing()) activeInfoSheet.dismiss();

        Dialog sheet = new Dialog(activity);
        activeInfoSheet = sheet;
        LinearLayout panel = new LinearLayout(activity);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(20), dp(16), dp(20), dp(24));
        panel.setBackground(roundRect(0xFAF7F5F2, 24));

        TextView heading = label("照片信息", 19, true, 0xFF1F1C1A);
        panel.addView(heading);

        TextView summary = label(assetFallbackSummary(asset), 13, false, 0xFF45403D);
        summary.setPadding(0, dp(12), 0, dp(16));
        panel.addView(summary);

        TextView editableHeading = label("NikkiSync 可编辑参数", 14, true, 0xFF1F1C1A);
        panel.addView(editableHeading);
        TextView editable = label("正在读取照片参数…", 12, false, 0xFF6C6560);
        editable.setPadding(0, dp(6), 0, dp(8));
        panel.addView(editable);

        Button edit = sheetButton("编辑参数");
        edit.setEnabled(false);
        panel.addView(edit, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)));

        Button technicalToggle = sheetButton("技术详情");
        technicalToggle.setEnabled(false);
        LinearLayout.LayoutParams toggleLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44));
        toggleLp.setMargins(0, dp(8), 0, 0);
        panel.addView(technicalToggle, toggleLp);

        TextView technical = label("", 11, false, 0xFF68605B);
        technical.setTextIsSelectable(true);
        technical.setVisibility(View.GONE);
        technical.setPadding(0, dp(10), 0, 0);
        panel.addView(technical);

        ScrollView scroll = new ScrollView(activity);
        scroll.addView(panel, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        sheet.setContentView(scroll);
        sheet.setOnDismissListener(ignored -> {
            if (activeInfoSheet == sheet) activeInfoSheet = null;
        });
        sheet.show();
        Window window = sheet.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.setDimAmount(0.42f);
            window.addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            window.setGravity(Gravity.BOTTOM);
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        }

        bindDetailToSheet(asset, sheet, summary, editable, edit, technicalToggle, technical);
    }

    private void bindDetailToSheet(
            AssetSummary asset,
            Dialog sheet,
            TextView summary,
            TextView editable,
            Button edit,
            Button technicalToggle,
            TextView technical
    ) {
        AssetDetail cached = detailCache.get(asset.assetId());
        if (cached != null) {
            renderDetail(asset, cached, sheet, summary, editable, edit, technicalToggle, technical);
            return;
        }

        detailExecutor.execute(() -> {
            try {
                AssetDetail detail = client.asset(asset.assetId());
                detailCache.put(asset.assetId(), detail);
                main.post(() -> {
                    if (!sheet.isShowing()) return;
                    if (!session.current().assetId().equals(asset.assetId())) return;
                    renderDetail(asset, detail, sheet, summary, editable, edit, technicalToggle, technical);
                });
            } catch (Exception error) {
                main.post(() -> {
                    if (!sheet.isShowing()) return;
                    editable.setText("照片参数读取失败");
                    summary.setText(assetFallbackSummary(asset) + "\n照片参数读取失败");
                });
            }
        });
    }

    private void renderDetail(
            AssetSummary asset,
            AssetDetail detail,
            Dialog sheet,
            TextView summary,
            TextView editable,
            Button edit,
            Button technicalToggle,
            TextView technical
    ) {
        MetadataPresentation presentation = MetadataPresentation.fromMetadataJson(
                detail.metadataJson(), asset.width(), asset.height(), asset.capturedAt()
        );
        summary.setText(presentation.summary());
        editable.setText(editableCameraSummary(detail));
        technical.setText(presentation.technicalDetails());
        technicalToggle.setEnabled(true);
        technicalToggle.setOnClickListener(v -> {
            boolean show = technical.getVisibility() != View.VISIBLE;
            technical.setVisibility(show ? View.VISIBLE : View.GONE);
            technicalToggle.setText(show ? "隐藏技术详情" : "技术详情");
        });
        edit.setEnabled(true);
        edit.setOnClickListener(v -> callbacks.onEditMetadata(asset, detail, updated -> {
            detailCache.put(asset.assetId(), updated);
            if (!sheet.isShowing()) return;
            if (!session.current().assetId().equals(asset.assetId())) return;
            renderDetail(asset, updated, sheet, summary, editable, edit, technicalToggle, technical);
        }));
    }

    private String editableCameraSummary(AssetDetail detail) {
        if (detail.metadataJson() == null) return "暂无用户可编辑参数";
        try {
            JSONObject metadata = new JSONObject(detail.metadataJson());
            JSONObject camera = metadata.optJSONObject("camera");
            if (camera == null || camera.length() == 0) return "暂无用户可编辑参数";
            StringBuilder out = new StringBuilder();
            appendEditable(out, camera, "focalLength", "焦距");
            appendEditable(out, camera, "exposure", "曝光");
            appendEditable(out, camera, "brightness", "亮度");
            appendEditable(out, camera, "contrast", "对比度");
            appendEditable(out, camera, "saturation", "饱和度");
            appendEditable(out, camera, "vibrance", "鲜艳度");
            appendEditable(out, camera, "highlights", "高光");
            appendEditable(out, camera, "shadows", "阴影");
            return out.length() == 0 ? "暂无用户可编辑参数" : out.toString();
        } catch (Exception error) {
            return "可编辑参数读取失败";
        }
    }

    private static void appendEditable(StringBuilder out, JSONObject object, String key, String label) {
        if (!object.has(key) || object.isNull(key)) return;
        if (out.length() > 0) out.append("\n");
        out.append(label).append("：").append(object.opt(key));
    }

    private String assetFallbackSummary(AssetSummary asset) {
        StringBuilder out = new StringBuilder();
        if (asset.width() != null && asset.height() != null) {
            out.append("分辨率：").append(asset.width()).append(" × ").append(asset.height());
        }
        if (asset.capturedAt() != null && !asset.capturedAt().isBlank()) {
            if (out.length() > 0) out.append("\n");
            out.append("拍摄时间：").append(asset.capturedAt());
        }
        return out.length() == 0 ? "正在读取照片信息…" : out.toString();
    }

    private Button chromeButton(String value) {
        Button button = new Button(activity);
        button.setText(value);
        button.setTextSize(12);
        button.setAllCaps(false);
        button.setTextColor(Color.WHITE);
        button.setBackground(roundRect(0x883F3F3F, 18));
        button.setMinHeight(dp(38));
        button.setMinimumHeight(dp(38));
        return button;
    }

    private Button sheetButton(String value) {
        Button button = new Button(activity);
        button.setText(value);
        button.setTextSize(12);
        button.setAllCaps(false);
        button.setTextColor(0xFF25211F);
        button.setBackground(roundRect(0xFFE8E2DD, 16));
        return button;
    }

    private TextView label(String value, int sp, boolean bold, int color) {
        TextView view = new TextView(activity);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }

    private GradientDrawable roundRect(int color, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
}