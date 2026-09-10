package app.nikkisync.mobile;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import app.nikkisync.mobile.media.ImageLoader;
import app.nikkisync.mobile.media.HuaweiMovingPhotoSaver;
import app.nikkisync.mobile.media.MotionPhotoSaver;
import app.nikkisync.mobile.media.OppoLivePhotoSaver;
import app.nikkisync.mobile.media.OriginalSaver;
import app.nikkisync.mobile.media.SamsungMotionPhotoSaver;
import app.nikkisync.mobile.media.VivoLivePhotoSaver;
import app.nikkisync.mobile.model.Models.AssetDetail;
import app.nikkisync.mobile.model.Models.AssetPage;
import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.model.Models.Changes;
import app.nikkisync.mobile.model.Models.PairedServer;
import app.nikkisync.mobile.model.Models.PairingPayload;
import app.nikkisync.mobile.net.NikkiSyncClient;
import app.nikkisync.mobile.net.NsdDiscovery;
import app.nikkisync.mobile.net.RealtimeWebSocket;
import app.nikkisync.mobile.protocol.PairingUri;
import app.nikkisync.mobile.security.DeviceIdentity;
import app.nikkisync.mobile.storage.ServerStore;
import app.nikkisync.mobile.ui.GalleryAdapter;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MainActivity extends Activity implements NsdDiscovery.Listener {
    private static final int NEARBY_PERMISSION = 401;
    private static final int PAIR_QR_SCAN = 402;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final AtomicBoolean syncing = new AtomicBoolean(false);
    private ImageLoader imageLoader;
    private final OriginalSaver originalSaver = new OriginalSaver();
    private final MotionPhotoSaver motionPhotoSaver = new MotionPhotoSaver();
    private final OppoLivePhotoSaver oppoLivePhotoSaver = new OppoLivePhotoSaver();
    private final SamsungMotionPhotoSaver samsungMotionPhotoSaver = new SamsungMotionPhotoSaver();
    private final VivoLivePhotoSaver vivoLivePhotoSaver = new VivoLivePhotoSaver();
    private final HuaweiMovingPhotoSaver huaweiMovingPhotoSaver = new HuaweiMovingPhotoSaver();

    private ServerStore serverStore;
    private DeviceIdentity identity;
    private NsdDiscovery discovery;
    private NikkiSyncClient client;
    private RealtimeWebSocket realtime;
    private PairedServer pairedServer;

    private TextView status;
    private TextView countLabel;
    private TextView selectionLabel;
    private Button pairButton;
    private Button saveButton;
    private ProgressBar progress;
    private GalleryAdapter adapter;
    private final List<AssetSummary> assets = new ArrayList<>();

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        imageLoader = new ImageLoader(this);
        serverStore = new ServerStore(this);
        try { identity = DeviceIdentity.getOrCreate(this); }
        catch (Exception error) {
            new AlertDialog.Builder(this).setTitle("设备身份初始化失败").setMessage(error.toString()).setPositiveButton("退出", (d, w) -> finish()).show();
            return;
        }
        buildUi();
        discovery = new NsdDiscovery(this, this);
        pairedServer = serverStore.load();
        updatePairButton();
        requestNearbyAndDiscover();
        handleIntent(getIntent());
        if (pairedServer != null) connect(pairedServer, "正在连接已配对电脑…");
        else if (identity.wasRecovered()) setStatus("安全密钥已重建 · 请重新配对电脑");
        else setStatus("尚未配对 · 点击右上角配对电脑");
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent); handleIntent(intent);
    }

    @Override protected void onDestroy() {
        realtimeStop();
        if (discovery != null) discovery.stop();
        if (imageLoader != null) imageLoader.shutdown(); io.shutdownNow();
        super.onDestroy();
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(getColor(R.color.app_background));
        root.setPadding(dp(14), dp(8), dp(14), dp(10));

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL); header.setPadding(dp(2), dp(8), dp(2), dp(8));
        LinearLayout titleBox = new LinearLayout(this); titleBox.setOrientation(LinearLayout.VERTICAL);
        TextView title = text("暖暖图库", 24, true, getColor(R.color.text_primary));
        status = text("准备中…", 12, false, getColor(R.color.text_secondary));
        titleBox.addView(title); titleBox.addView(status);
        header.addView(titleBox, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        pairButton = button("配对电脑"); pairButton.setOnClickListener(v -> startPairScanner());
        header.addView(pairButton);
        root.addView(header);

        LinearLayout meta = new LinearLayout(this); meta.setGravity(Gravity.CENTER_VERTICAL); meta.setPadding(dp(2), dp(4), dp(2), dp(8));
        countLabel = text("0 张", 13, true, getColor(R.color.text_primary));
        meta.addView(countLabel, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button refresh = button("刷新"); refresh.setOnClickListener(v -> loadLibrary("正在刷新图库…")); meta.addView(refresh);
        root.addView(meta);

        FrameLayout galleryFrame = new FrameLayout(this);
        RecyclerView grid = new RecyclerView(this);
        grid.setVerticalScrollBarEnabled(false); grid.setClipToPadding(false); grid.setPadding(0, 0, 0, dp(12));
        GridLayoutManager layout = new GridLayoutManager(this, 3);
        grid.setLayoutManager(layout);
        adapter = new GalleryAdapter(this, imageLoader, () -> client, new GalleryAdapter.Listener() {
            @Override public void onPhotoClick(AssetSummary asset) {
                if (adapter.hasSelection()) { adapter.toggle(asset); updateSelection(); }
                else showViewer(asset);
            }

            @Override public boolean onPhotoLongClick(AssetSummary asset) {
                adapter.toggle(asset); updateSelection(); return true;
            }
        });
        layout.setSpanSizeLookup(new GridLayoutManager.SpanSizeLookup() {
            @Override public int getSpanSize(int position) { return adapter.isHeader(position) ? 3 : 1; }
        });
        grid.setAdapter(adapter);
        galleryFrame.addView(grid, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        progress = new ProgressBar(this); progress.setVisibility(View.GONE);
        FrameLayout.LayoutParams progressLp = new FrameLayout.LayoutParams(dp(38), dp(38), Gravity.CENTER); galleryFrame.addView(progress, progressLp);
        root.addView(galleryFrame, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        LinearLayout selection = new LinearLayout(this); selection.setGravity(Gravity.CENTER_VERTICAL); selection.setPadding(dp(12), dp(8), dp(8), dp(8));
        selection.setBackground(roundRect(0xEFFFFFFF, 18));
        selectionLabel = text("", 13, true, getColor(R.color.text_primary));
        selection.addView(selectionLabel, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        saveButton = button("保存原图"); saveButton.setOnClickListener(v -> saveSelected()); selection.addView(saveButton);
        selection.setTag("selectionBar"); selection.setVisibility(View.GONE);
        root.addView(selection);
        setContentView(root);
    }

    private void handleIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        String raw = intent.getDataString();
        if (raw != null && raw.startsWith("nikki-sync://pair?")) beginPair(raw);
    }

    private void startPairScanner() {
        startActivityForResult(new Intent(this, PairQrScannerActivity.class), PAIR_QR_SCAN);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PAIR_QR_SCAN || resultCode != RESULT_OK || data == null) return;
        String raw = data.getStringExtra(PairQrScannerActivity.EXTRA_PAIRING_URI);
        if (raw != null) beginPair(raw);
    }

    private void beginPair(String raw) {
        final PairingPayload payload;
        try { payload = PairingUri.parse(raw); }
        catch (Exception error) { toast(error.getMessage()); return; }
        setBusy(true); setStatus("正在与电脑建立一次性配对…");
        io.execute(() -> {
            try {
                PairedServer server = NikkiSyncClient.pair(payload, identity);
                serverStore.save(server); pairedServer = server;
                main.post(() -> { updatePairButton(); setBusy(false); connect(server, "配对成功 · 正在读取图库…"); });
            } catch (Exception error) {
                main.post(() -> { setBusy(false); setStatus("配对失败"); toast("配对失败：" + message(error)); });
            }
        });
    }

    private void connect(PairedServer server, String message) {
        pairedServer = server; setStatus(message); realtimeStop();
        try {
            client = new NikkiSyncClient(server, identity);
            loadLibrary(message);
            realtime = new RealtimeWebSocket(client.signedHttp(), server, new RealtimeWebSocket.Listener() {
                @Override public void onText(String json) { handleRealtime(json); }
                @Override public void onConnectionState(boolean connected) {
                    main.post(() -> { if (connected) setStatus("已连接 · 实时同步中"); else setStatus("电脑暂不可达 · 等待自动重连"); });
                }
            });
            realtime.start();
        } catch (Exception error) { setStatus("连接初始化失败"); toast(message(error)); }
    }

    private void loadLibrary(String message) {
        NikkiSyncClient current = client;
        if (current == null) { if (pairedServer == null) startPairScanner(); return; }
        setBusy(true); setStatus(message);
        io.execute(() -> {
            try {
                List<AssetSummary> next = new ArrayList<>(); String cursor = null; long revision = 0; int pages = 0;
                do {
                    AssetPage page = current.assets(cursor, 100); next.addAll(page.items()); cursor = page.nextCursor(); revision = page.libraryRevision();
                    if (++pages > 200) throw new IllegalStateException("图库分页异常");
                } while (cursor != null);
                long finalRevision = revision; serverStore.updateRevision(finalRevision);
                if (pairedServer != null) pairedServer = pairedServer.withRevision(finalRevision);
                main.post(() -> {
                    assets.clear(); assets.addAll(next); adapter.setItems(next); countLabel.setText(next.size() + " 张");
                    setBusy(false); setStatus("已连接 · 实时同步中"); updateSelection();
                });
            } catch (Exception error) {
                main.post(() -> { setBusy(false); setStatus("读取失败 · 等待电脑上线"); });
            }
        });
    }

    private void handleRealtime(String json) {
        try {
            JSONObject event = new JSONObject(json);
            long revision = event.optLong("revision", event.optLong("libraryRevision", 0));
            PairedServer server = serverStore.load();
            if (server != null && revision > server.lastRevision()) syncChanges();
        } catch (Exception ignored) {}
    }

    private void syncChanges() {
        if (!syncing.compareAndSet(false, true)) return;
        NikkiSyncClient current = client; PairedServer server = serverStore.load();
        if (current == null || server == null) { syncing.set(false); return; }
        io.execute(() -> {
            try {
                Changes changes = current.changes(server.lastRevision());
                serverStore.updateRevision(changes.libraryRevision());
                if (changes.fullResyncRequired() || !changes.items().isEmpty()) main.post(() -> loadLibrary("发现新照片 · 正在同步…"));
            } catch (Exception ignored) {
            } finally { syncing.set(false); }
        });
    }

    private void saveSelected() {
        List<AssetSummary> selected = adapter.selectedItems(); NikkiSyncClient current = client;
        if (selected.isEmpty() || current == null) return;
        setBusy(true); saveButton.setEnabled(false); setStatus("正在保存 0 / " + selected.size());
        io.execute(() -> {
            int success = 0; int failure = 0; boolean hadMotion = false;
            for (int i = 0; i < selected.size(); i++) {
                AssetSummary asset = selected.get(i); hadMotion |= asset.hasMotion();
                int index = i + 1; main.post(() -> setStatus("正在保存 " + index + " / " + selected.size()));
                try {
                    if (asset.hasMotion()) {
                        String manufacturer = ((android.os.Build.MANUFACTURER == null ? "" : android.os.Build.MANUFACTURER) + " " +
                                (android.os.Build.BRAND == null ? "" : android.os.Build.BRAND)).toLowerCase(java.util.Locale.ROOT);
                        if (manufacturer.contains("vivo") || manufacturer.contains("iqoo")) vivoLivePhotoSaver.save(this, current, asset);
                        else if (manufacturer.contains("huawei") || manufacturer.contains("honor")) huaweiMovingPhotoSaver.save(this, current, asset);
                        else if (manufacturer.contains("oppo") || manufacturer.contains("oneplus") || manufacturer.contains("realme")) oppoLivePhotoSaver.save(this, current, asset);
                        else if (manufacturer.contains("samsung")) samsungMotionPhotoSaver.save(this, current, asset);
                        else motionPhotoSaver.save(this, current, asset);
                    } else originalSaver.save(this, current, asset);
                    success++;
                }
                catch (Exception ignored) { failure++; }
            }
            int saved = success, failed = failure; boolean motion = hadMotion;
            main.post(() -> {
                setBusy(false); saveButton.setEnabled(true); adapter.clearSelection(); updateSelection();
                String result = "已保存 " + saved + " 张原图" + (failed > 0 ? "，失败 " + failed + " 张" : "");
                if (motion) result += "。LIVE 项目已按当前手机厂商格式封装";
                toast(result); setStatus("已连接 · 实时同步中");
            });
        });
    }

    private void showViewer(AssetSummary asset) {
        Dialog dialog = new Dialog(this);
        LinearLayout body = new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL); body.setPadding(dp(14), dp(14), dp(14), dp(14)); body.setBackgroundColor(Color.WHITE);
        ImageView image = new ImageView(this); image.setScaleType(ImageView.ScaleType.FIT_CENTER); image.setBackgroundColor(0xFFF0EDEA);
        body.addView(image, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(480)));
        imageLoader.load(client, asset, image);
        String description = (asset.hasMotion() ? "LIVE · " : "") + (asset.width() == null ? "" : asset.width() + " × " + asset.height()) +
                (asset.capturedAt() == null ? "" : "\n" + asset.capturedAt());
        TextView info = text(description, 13, false, getColor(R.color.text_secondary)); info.setPadding(dp(4), dp(12), dp(4), dp(10)); body.addView(info);
        TextView params = text("正在读取照片参数…", 13, false, getColor(R.color.text_secondary)); params.setPadding(dp(4), dp(4), dp(4), dp(10)); body.addView(params);
        Button edit = button("编辑照片参数"); edit.setEnabled(false); body.addView(edit);
        AssetDetail[] detailHolder = new AssetDetail[1];
        io.execute(() -> {
            try {
                AssetDetail detail = client.asset(asset.assetId()); detailHolder[0] = detail;
                main.post(() -> { params.setText(metadataSummary(detail)); edit.setEnabled(true); });
            } catch (Exception error) { main.post(() -> params.setText("参数读取失败：" + message(error))); }
        });
        edit.setOnClickListener(v -> { if (detailHolder[0] != null) showMetadataEditor(asset, detailHolder[0], params, detailHolder); });
        Button select = button("选择保存原图"); select.setOnClickListener(v -> { adapter.toggle(asset); updateSelection(); dialog.dismiss(); }); body.addView(select);
        dialog.setContentView(body); if (dialog.getWindow() != null) dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT); dialog.show();
        if (dialog.getWindow() != null) dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private String metadataSummary(AssetDetail detail) {
        if (detail.metadataJson() == null) return "暖暖原生参数：未检测到\nNikkiSync 参数：暂无";
        try {
            JSONObject metadata = new JSONObject(detail.metadataJson());
            JSONObject raw = metadata.optJSONObject("raw"); JSONObject camera = metadata.optJSONObject("camera");
            StringBuilder out = new StringBuilder();
            out.append(raw != null && raw.optString("nativeParamToken", "").length() == 44
                    ? "暖暖原生参数：已读取（待本地解码）" : "暖暖原生参数：未检测到");
            if (camera == null || camera.length() == 0) return out.append("\nNikkiSync 参数：暂无").toString();
            appendParam(out, camera, "focalLength", "焦距"); appendParam(out, camera, "exposure", "曝光");
            appendParam(out, camera, "brightness", "亮度"); appendParam(out, camera, "contrast", "对比度");
            appendParam(out, camera, "saturation", "饱和度"); appendParam(out, camera, "vibrance", "鲜艳度");
            appendParam(out, camera, "highlights", "高光"); appendParam(out, camera, "shadows", "阴影");
            return out.toString();
        } catch (Exception error) { return "参数数据损坏：" + message(error); }
    }

    private static void appendParam(StringBuilder out, JSONObject object, String key, String label) {
        if (object.has(key) && !object.isNull(key)) out.append("\n").append(label).append("：").append(object.opt(key));
    }

    private void showMetadataEditor(AssetSummary asset, AssetDetail detail, TextView params, AssetDetail[] detailHolder) {
        JSONObject camera;
        try { JSONObject metadata = detail.metadataJson() == null ? new JSONObject() : new JSONObject(detail.metadataJson()); camera = metadata.optJSONObject("camera"); }
        catch (Exception error) { toast("参数读取失败：" + message(error)); return; }
        if (camera == null) camera = new JSONObject();
        final JSONObject currentCamera = camera;
        String[][] fields = {
                {"focalLength", "焦距"}, {"exposure", "曝光"}, {"brightness", "亮度"}, {"contrast", "对比度"},
                {"saturation", "饱和度"}, {"vibrance", "鲜艳度"}, {"highlights", "高光"}, {"shadows", "阴影"}
        };
        LinearLayout form = new LinearLayout(this); form.setOrientation(LinearLayout.VERTICAL); form.setPadding(dp(18), dp(8), dp(18), dp(8));
        Map<String, EditText> inputs = new LinkedHashMap<>();
        for (String[] field : fields) {
            TextView label = text(field[1], 12, true, getColor(R.color.text_secondary)); form.addView(label);
            EditText input = new EditText(this); input.setSingleLine(true); input.setInputType(android.text.InputType.TYPE_CLASS_NUMBER | android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL | android.text.InputType.TYPE_NUMBER_FLAG_SIGNED);
            if (currentCamera.has(field[0]) && !currentCamera.isNull(field[0])) input.setText(String.valueOf(currentCamera.opt(field[0])));
            input.setHint("未设置"); form.addView(input); inputs.put(field[0], input);
        }
        ScrollView scroll = new ScrollView(this); scroll.addView(form);
        new AlertDialog.Builder(this).setTitle("编辑照片参数").setView(scroll).setNegativeButton("取消", null)
                .setPositiveButton("保存", (d, w) -> {
                    try {
                        JSONObject patchCamera = new JSONObject();
                        for (Map.Entry<String, EditText> entry : inputs.entrySet()) {
                            String value = entry.getValue().getText().toString().trim();
                            if (!value.isEmpty()) patchCamera.put(entry.getKey(), Double.parseDouble(value));
                        }
                        JSONObject patch = new JSONObject().put("camera", patchCamera);
                        params.setText("正在保存参数…");
                        io.execute(() -> {
                            try {
                                AssetDetail updated = client.updateMetadata(asset.assetId(), patch); detailHolder[0] = updated;
                                main.post(() -> { params.setText(metadataSummary(updated)); toast("照片参数已保存到 NikkiSync"); });
                            } catch (Exception error) { main.post(() -> { params.setText(metadataSummary(detailHolder[0])); toast("参数保存失败：" + message(error)); }); }
                        });
                    } catch (Exception error) { toast("请输入有效数字"); }
                }).show();
    }

    private void updateSelection() {
        View selectionBar = findViewWithTag(((ViewGroup) findViewById(android.R.id.content)).getChildAt(0), "selectionBar");
        if (selectionBar == null) return;
        int count = adapter.selectedCount(); selectionBar.setVisibility(count > 0 ? View.VISIBLE : View.GONE);
        selectionLabel.setText("已选择 " + count + " 张"); saveButton.setText("保存原图");
    }

    private View findViewWithTag(View root, Object tag) {
        if (tag.equals(root.getTag())) return root;
        if (root instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) root;
            for (int i = 0; i < group.getChildCount(); i++) {
                View found = findViewWithTag(group.getChildAt(i), tag); if (found != null) return found;
            }
        }
        return null;
    }

    private void requestNearbyAndDiscover() {
        if (checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES) == PackageManager.PERMISSION_GRANTED) discovery.start();
        else requestPermissions(new String[]{Manifest.permission.NEARBY_WIFI_DEVICES}, NEARBY_PERMISSION);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NEARBY_PERMISSION && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) discovery.start();
    }

    @Override public void onEndpoint(String serverId, String host, int port) {
        main.post(() -> {
            PairedServer current = serverStore.load();
            if (current == null || !current.serverId().equals(serverId)) return;
            if (!current.host().equals(host) || current.port() != port) {
                PairedServer updated = current.withEndpoint(host, port); serverStore.save(updated); pairedServer = updated;
                connect(updated, "已重新发现电脑 · 正在连接…");
            }
        });
    }

    @Override public void onDiscoveryState(boolean active) {}

    private void realtimeStop() { if (realtime != null) realtime.stop(); realtime = null; }
    private void setBusy(boolean busy) { progress.setVisibility(busy ? View.VISIBLE : View.GONE); }
    private void setStatus(String value) { status.setText(value); }
    private void updatePairButton() { pairButton.setText(pairedServer == null ? "配对电脑" : pairedServer.serverName()); }
    private void toast(String value) { Toast.makeText(this, value, Toast.LENGTH_LONG).show(); }
    private static String message(Throwable error) { return error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage(); }

    private TextView text(String value, int sp, boolean bold, int color) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(sp); view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD); return view;
    }

    private Button button(String value) {
        Button button = new Button(this); button.setText(value); button.setTextSize(12); button.setAllCaps(false);
        button.setTextColor(getColor(R.color.text_primary)); button.setBackground(roundRect(0xE8FFFFFF, 16));
        button.setPadding(dp(12), 0, dp(12), 0); button.setMinHeight(dp(38)); button.setMinimumHeight(dp(38));
        return button;
    }

    private GradientDrawable roundRect(int color, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable(); drawable.setColor(color); drawable.setCornerRadius(dp(radiusDp));
        drawable.setStroke(dp(1), 0x1A000000); return drawable;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
