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
import app.nikkisync.mobile.ui.SuitSearchDialog;

import org.json.JSONArray;
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
    private static final int TAB_GALLERY = 0;
    private static final int TAB_SAVED = 1;
    private static final int TAB_MY = 2;

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
    private final Map<String, Integer> rotationByAssetId = new LinkedHashMap<>();

    private ServerStore serverStore;
    private DeviceIdentity identity;
    private NsdDiscovery discovery;
    private NikkiSyncClient client;
    private RealtimeWebSocket realtime;
    private PairedServer pairedServer;

    private TextView titleLabel;
    private TextView status;
    private TextView countLabel;
    private TextView selectionLabel;
    private TextView tabPlaceholder;
    private TextView galleryEmpty;
    private Button pairButton;
    private Button searchButton;
    private Button saveButton;
    private Button galleryTabButton;
    private Button savedTabButton;
    private Button myTabButton;
    private ProgressBar progress;
    private GalleryAdapter adapter;
    private LinearLayout galleryMeta;
    private LinearLayout selectionBar;
    private RecyclerView galleryList;
    private int activeTab = TAB_GALLERY;
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
        updateGalleryEmptyState();
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
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(14), dp(12), dp(10), dp(12));
        header.setBackgroundResource(R.drawable.bg_glass_card);

        LinearLayout titleBox = new LinearLayout(this);
        titleBox.setOrientation(LinearLayout.VERTICAL);
        titleLabel = text("暖暖相册", 25, true, getColor(R.color.text_primary));
        status = text("准备中…", 12, false, getColor(R.color.text_secondary));
        titleBox.addView(titleLabel);
        titleBox.addView(status);
        header.addView(titleBox, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        pairButton = button("配对");
        pairButton.setOnClickListener(v -> startPairScanner());
        header.addView(pairButton);
        root.addView(header);

        searchButton = button("搜索套装或散件");
        searchButton.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        searchButton.setTextColor(getColor(R.color.text_secondary));
        searchButton.setBackgroundResource(R.drawable.bg_glass_card);
        searchButton.setMinHeight(dp(48));
        searchButton.setMinimumHeight(dp(48));
        searchButton.setOnClickListener(v -> {
            NikkiSyncClient current = client;
            if (current == null) {
                toast("请先连接电脑");
                return;
            }
            SuitSearchDialog.show(this, current, imageLoader, io, main, this::showViewer);
        });
        LinearLayout.LayoutParams searchLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        searchLp.setMargins(0, dp(10), 0, 0);
        root.addView(searchButton, searchLp);

        galleryMeta = new LinearLayout(this);
        galleryMeta.setGravity(Gravity.CENTER_VERTICAL);
        galleryMeta.setPadding(dp(4), dp(10), dp(4), dp(8));
        countLabel = text("已同步 0 张", 13, true, getColor(R.color.text_primary));
        galleryMeta.addView(countLabel, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button refresh = button("刷新");
        refresh.setOnClickListener(v -> loadLibrary("正在刷新图库…"));
        galleryMeta.addView(refresh);
        root.addView(galleryMeta);

        FrameLayout content = new FrameLayout(this);
        galleryList = new RecyclerView(this);
        galleryList.setVerticalScrollBarEnabled(false); galleryList.setClipToPadding(false); galleryList.setPadding(0, 0, 0, dp(12));
        GridLayoutManager layout = new GridLayoutManager(this, 3);
        galleryList.setLayoutManager(layout);
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
        galleryList.setAdapter(adapter);
        content.addView(galleryList, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        galleryEmpty = text("", 14, false, getColor(R.color.text_secondary));
        galleryEmpty.setGravity(Gravity.CENTER); galleryEmpty.setPadding(dp(28), dp(28), dp(28), dp(28)); galleryEmpty.setVisibility(View.GONE);
        content.addView(galleryEmpty, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        tabPlaceholder = text("", 14, false, getColor(R.color.text_secondary));
        tabPlaceholder.setGravity(Gravity.CENTER); tabPlaceholder.setVisibility(View.GONE); tabPlaceholder.setPadding(dp(28), dp(28), dp(28), dp(28));
        content.addView(tabPlaceholder, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        progress = new ProgressBar(this); progress.setVisibility(View.GONE);
        FrameLayout.LayoutParams progressLp = new FrameLayout.LayoutParams(dp(38), dp(38), Gravity.CENTER); content.addView(progress, progressLp);
        root.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        selectionBar = new LinearLayout(this); selectionBar.setGravity(Gravity.CENTER_VERTICAL); selectionBar.setPadding(dp(12), dp(8), dp(8), dp(8));
        selectionBar.setBackgroundResource(R.drawable.bg_glass_card);
        selectionLabel = text("", 13, true, getColor(R.color.text_primary));
        selectionBar.addView(selectionLabel, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        saveButton = button("保存原图"); saveButton.setOnClickListener(v -> saveSelected()); selectionBar.addView(saveButton);
        selectionBar.setTag("selectionBar"); selectionBar.setVisibility(View.GONE);
        root.addView(selectionBar);

        LinearLayout bottomNav = new LinearLayout(this);
        bottomNav.setGravity(Gravity.CENTER);
        bottomNav.setPadding(dp(6), dp(6), dp(6), dp(6));
        bottomNav.setBackgroundResource(R.drawable.bg_glass_card);
        galleryTabButton = bottomTab("图库", TAB_GALLERY);
        savedTabButton = bottomTab("已保存", TAB_SAVED);
        myTabButton = bottomTab("我的", TAB_MY);
        bottomNav.addView(galleryTabButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        bottomNav.addView(savedTabButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        bottomNav.addView(myTabButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        root.addView(bottomNav);

        setContentView(root);
        switchTab(TAB_GALLERY);
    }

    private Button bottomTab(String label, int tab) {
        Button button = new Button(this); button.setText(label); button.setAllCaps(false); button.setTextSize(13);
        button.setTextColor(getColor(R.color.text_primary)); button.setBackgroundColor(Color.TRANSPARENT);
        button.setOnClickListener(v -> switchTab(tab)); return button;
    }

    private void switchTab(int tab) {
        activeTab = tab;
        boolean gallery = tab == TAB_GALLERY;
        galleryList.setVisibility(gallery ? View.VISIBLE : View.GONE);
        galleryMeta.setVisibility(gallery ? View.VISIBLE : View.GONE);
        searchButton.setVisibility(gallery ? View.VISIBLE : View.GONE);
        tabPlaceholder.setVisibility(gallery ? View.GONE : View.VISIBLE);
        pairButton.setVisibility(gallery ? View.VISIBLE : View.GONE);

        if (tab == TAB_GALLERY) {
            titleLabel.setText("暖暖相册");
            tabPlaceholder.setText("");
        } else if (tab == TAB_SAVED) {
            titleLabel.setText("已保存");
            tabPlaceholder.setText("已保存照片会在这里以保存后的原图展示。\n\n后续会补充二次修改后的图片重新与原 NikkiSync 照片建立信息关联的能力，同时保留来源关系，不覆盖原图。");
        } else {
            titleLabel.setText("我的");
            tabPlaceholder.setText("这里将显示玩家 UID、同步状态、设备与照片概况。\n\n套装与散件检索已经移动到暖暖相册顶部，搜索使用 NikkiSync 已解析的穿搭信息，不上传照片内容。");
        }
        styleTab(galleryTabButton, tab == TAB_GALLERY);
        styleTab(savedTabButton, tab == TAB_SAVED);
        styleTab(myTabButton, tab == TAB_MY);
        updateSelection();
        updateGalleryEmptyState();
    }

    private void styleTab(Button button, boolean selected) {
        button.setTypeface(selected ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        button.setAlpha(selected ? 1f : 0.62f);
        button.setBackground(selected ? getDrawable(R.drawable.bg_glass_chip) : null);
    }

    private void updateGalleryEmptyState() {
        if (galleryEmpty == null) return;
        boolean show = activeTab == TAB_GALLERY && assets.isEmpty();
        galleryEmpty.setVisibility(show ? View.VISIBLE : View.GONE);
        if (show) galleryEmpty.setText(pairedServer == null ? "配对电脑后，这里会显示暖暖照片。" : "当前还没有同步到照片。");
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
                main.post(() -> { updatePairButton(); setBusy(false); updateGalleryEmptyState(); connect(server, "配对成功 · 正在读取图库…"); });
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
                    assets.clear(); assets.addAll(next); adapter.setItems(next); countLabel.setText("已同步 " + next.size() + " 张");
                    setBusy(false); setStatus("已连接 · 实时同步中"); updateSelection(); updateGalleryEmptyState();
                });
            } catch (Exception error) {
                main.post(() -> { setBusy(false); setStatus("读取失败 · 等待电脑上线"); updateGalleryEmptyState(); });
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
                    } else {
                        int rotationDegrees = rotationByAssetId.getOrDefault(asset.assetId(), 0);
                        originalSaver.save(this, current, asset, rotationDegrees);
                    }
                    success++;
                }
                catch (Exception ignored) { failure++; }
            }
            int saved = success, failed = failure; boolean motion = hadMotion;
            main.post(() -> {
                setBusy(false); saveButton.setEnabled(true);
                for (AssetSummary item : selected) rotationByAssetId.remove(item.assetId());
                adapter.clearSelection(); updateSelection();
                String result = "已保存 " + saved + " 张原图" + (failed > 0 ? "，失败 " + failed + " 张" : "");
                if (motion) result += "。LIVE 项目已按当前手机厂商格式封装";
                toast(result); setStatus("已连接 · 实时同步中");
            });
        });
    }

    private void showViewer(AssetSummary asset) {
        Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(getColor(R.color.app_background));

        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(14), dp(12), dp(14), dp(24));
        scroll.addView(body, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout viewerHeader = new LinearLayout(this);
        viewerHeader.setGravity(Gravity.CENTER_VERTICAL);
        viewerHeader.setPadding(dp(4), 0, dp(2), dp(10));
        TextView viewerTitle = text(asset.hasMotion() ? "LIVE 照片" : "照片详情", 20, true, getColor(R.color.text_primary));
        viewerHeader.addView(viewerTitle, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button close = button("完成");
        close.setOnClickListener(v -> dialog.dismiss());
        viewerHeader.addView(close);
        body.addView(viewerHeader);

        ImageView image = new ImageView(this);
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        image.setBackgroundResource(R.drawable.bg_gallery_photo);
        image.setClipToOutline(true);
        int previewSize = Math.max(dp(240), getResources().getDisplayMetrics().widthPixels - dp(28));
        body.addView(image, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, previewSize));
        imageLoader.load(client, asset, image);

        int[] rotationHolder = new int[]{rotationByAssetId.getOrDefault(asset.assetId(), 0)};
        image.setRotation(rotationHolder[0]);
        if (!asset.hasMotion()) {
            LinearLayout rotationControls = new LinearLayout(this);
            rotationControls.setGravity(Gravity.CENTER_VERTICAL);
            rotationControls.setPadding(0, dp(10), 0, dp(8));
            Button rotateLeft = button("左转 90°");
            Button rotateRight = button("右转 90°");
            TextView rotationLabel = text(rotationLabel(rotationHolder[0]), 12, true, getColor(R.color.text_secondary));
            rotationLabel.setGravity(Gravity.CENTER);
            rotateLeft.setOnClickListener(v -> {
                rotationHolder[0] = normalizeRotation(rotationHolder[0] - 90);
                rememberRotation(asset.assetId(), rotationHolder[0]);
                image.setRotation(rotationHolder[0]);
                rotationLabel.setText(rotationLabel(rotationHolder[0]));
            });
            rotateRight.setOnClickListener(v -> {
                rotationHolder[0] = normalizeRotation(rotationHolder[0] + 90);
                rememberRotation(asset.assetId(), rotationHolder[0]);
                image.setRotation(rotationHolder[0]);
                rotationLabel.setText(rotationLabel(rotationHolder[0]));
            });
            rotationControls.addView(rotateLeft);
            rotationControls.addView(rotationLabel, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            rotationControls.addView(rotateRight);
            body.addView(rotationControls);
        } else {
            TextView rotationNote = text("LIVE 照片暂不单独旋转：后续需同时处理静态图与视频", 11, false, getColor(R.color.text_secondary));
            rotationNote.setPadding(dp(4), dp(10), dp(4), dp(8));
            body.addView(rotationNote);
        }

        LinearLayout infoSheet = new LinearLayout(this);
        infoSheet.setOrientation(LinearLayout.VERTICAL);
        infoSheet.setPadding(dp(14), dp(14), dp(14), dp(14));
        infoSheet.setBackgroundResource(R.drawable.bg_glass_card);
        LinearLayout.LayoutParams sheetLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sheetLp.topMargin = dp(4);
        body.addView(infoSheet, sheetLp);

        String description = (asset.hasMotion() ? "LIVE · " : "") + (asset.width() == null ? "" : asset.width() + " × " + asset.height()) +
                (asset.capturedAt() == null ? "" : "\n" + asset.capturedAt());
        TextView info = text(description, 13, false, getColor(R.color.text_secondary));
        info.setPadding(dp(2), 0, dp(2), dp(10));
        infoSheet.addView(info);

        TextView params = text("正在读取照片参数…", 13, false, getColor(R.color.text_secondary));
        params.setPadding(dp(2), dp(4), dp(2), dp(10));
        infoSheet.addView(params);

        LinearLayout clothingSection = new LinearLayout(this);
        clothingSection.setOrientation(LinearLayout.VERTICAL);
        clothingSection.setVisibility(View.GONE);
        clothingSection.setPadding(0, dp(6), 0, dp(8));
        infoSheet.addView(clothingSection);

        Button edit = button("编辑照片参数");
        edit.setEnabled(false);
        infoSheet.addView(edit);

        AssetDetail[] detailHolder = new AssetDetail[1];
        io.execute(() -> {
            try {
                AssetDetail detail = client.asset(asset.assetId());
                detailHolder[0] = detail;
                main.post(() -> {
                    params.setText(metadataSummary(detail));
                    renderClothingSection(asset, detail, clothingSection);
                    edit.setEnabled(true);
                });
            } catch (Exception error) {
                main.post(() -> params.setText("参数读取失败：" + message(error)));
            }
        });

        edit.setOnClickListener(v -> {
            if (detailHolder[0] != null) showMetadataEditor(asset, detailHolder[0], params, detailHolder);
        });

        Button select = button("选择保存原图");
        LinearLayout.LayoutParams selectLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        selectLp.topMargin = dp(8);
        select.setOnClickListener(v -> {
            adapter.toggle(asset);
            updateSelection();
            dialog.dismiss();
        });
        infoSheet.addView(select, selectLp);

        dialog.setContentView(scroll);
        dialog.show();
        if (dialog.getWindow() != null) {
            dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
        }
    }

    private void rememberRotation(String assetId, int rotationDegrees) {
        if (rotationDegrees == 0) rotationByAssetId.remove(assetId);
        else rotationByAssetId.put(assetId, rotationDegrees);
    }

    private static int normalizeRotation(int rotationDegrees) {
        return ((rotationDegrees % 360) + 360) % 360;
    }

    private static String rotationLabel(int rotationDegrees) {
        return rotationDegrees == 0 ? "原方向" : "旋转 " + rotationDegrees + "°";
    }

    private void renderClothingSection(AssetSummary asset, AssetDetail detail, LinearLayout section) {
        section.removeAllViews(); section.setVisibility(View.GONE);
        if (detail.metadataJson() == null || client == null) return;
        try {
            JSONObject metadata = new JSONObject(detail.metadataJson());
            JSONObject dressing = metadata.optJSONObject("dressing");
            JSONArray clothes = dressing == null ? null : dressing.optJSONArray("clothes");
            if (clothes == null || clothes.length() == 0) return;
            JSONObject raw = metadata.optJSONObject("raw");
            JSONObject dictionary = raw == null ? null : raw.optJSONObject("dictionary");
            String cacheVersion = dictionary == null ? "" : dictionary.optString("providerVersion", "");

            int displayCount = 0;
            for (int i = 0; i < clothes.length(); i++) {
                JSONObject clothing = clothes.optJSONObject(i);
                if (clothing != null && clothing.has("id") && !clothing.isNull("id")) displayCount++;
            }
            if (displayCount == 0) return;

            TextView heading = text("穿搭 · " + displayCount + " 件", 16, true, getColor(R.color.text_primary));
            heading.setPadding(dp(4), dp(6), dp(4), dp(8)); section.addView(heading);

            for (int i = 0; i < clothes.length(); i++) {
                JSONObject clothing = clothes.optJSONObject(i);
                if (clothing == null || !clothing.has("id") || clothing.isNull("id")) continue;
                String id = String.valueOf(clothing.opt("id")).trim();
                if (id.isEmpty()) continue;
                String name = clothing.optString("name", "").trim();
                if (name.isEmpty()) name = "服装 " + id;
                String category = clothing.optString("category", "").trim();
                String categoryLabel = clothingCategoryLabel(category);

                LinearLayout row = new LinearLayout(this); row.setGravity(Gravity.CENTER_VERTICAL); row.setPadding(dp(10), dp(8), dp(10), dp(8));
                row.setBackground(roundRect(0xFFF7F5F3, 14));
                LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                rowLp.setMargins(0, 0, 0, dp(7));

                ImageView icon = new ImageView(this); icon.setScaleType(ImageView.ScaleType.FIT_CENTER); icon.setBackground(roundRect(0xFFECE8E4, 10));
                row.addView(icon, new LinearLayout.LayoutParams(dp(64), dp(64)));
                imageLoader.loadClothingThumbnail(client, asset.assetId(), id, cacheVersion, icon);

                LinearLayout labels = new LinearLayout(this); labels.setOrientation(LinearLayout.VERTICAL); labels.setPadding(dp(10), 0, 0, 0);
                TextView nameView = text(name, 14, true, getColor(R.color.text_primary)); labels.addView(nameView);
                String subline = categoryLabel + " · ID " + id;
                TextView categoryView = text(subline, 11, false, getColor(R.color.text_secondary)); categoryView.setPadding(0, dp(3), 0, 0); labels.addView(categoryView);
                row.addView(labels, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
                section.addView(row, rowLp);
            }
            section.setVisibility(View.VISIBLE);
        } catch (Exception ignored) {
            section.removeAllViews(); section.setVisibility(View.GONE);
        }
    }

    private static String clothingCategoryLabel(String category) {
        return switch (category) {
            case "hair" -> "发型";
            case "dresses" -> "连衣裙";
            case "outerwear" -> "外套";
            case "tops" -> "上衣";
            case "bottoms" -> "下装";
            case "socks" -> "袜子";
            case "shoes" -> "鞋子";
            case "hairAccessories" -> "发饰";
            case "headwear" -> "帽子";
            case "earrings" -> "耳饰";
            case "neckwear" -> "颈饰";
            case "bracelets" -> "腕饰";
            case "chokers" -> "项圈";
            case "gloves" -> "手套";
            case "faceDecorations" -> "面饰";
            case "chestAccessories" -> "胸饰";
            case "pendants" -> "挂饰";
            case "backpieces" -> "背饰";
            case "rings" -> "戒指";
            case "armDecorations" -> "臂饰";
            case "handhelds" -> "手持物";
            case "bodyPaint" -> "肤绘";
            case "fullMakeup" -> "全妆";
            case "baseMakeup" -> "底妆";
            case "eyebrows" -> "眉妆";
            case "eyelashes" -> "睫毛";
            case "contacts" -> "美瞳";
            case "lips" -> "唇妆";
            case "skinTones" -> "肤色";
            default -> category.isEmpty() ? "未知部位" : category;
        };
    }

    private String metadataSummary(AssetDetail detail) {
        if (detail.metadataJson() == null) return "暖暖原生参数：未检测到\nNikkiSync 参数：暂无";
        try {
            JSONObject metadata = new JSONObject(detail.metadataJson());
            JSONObject raw = metadata.optJSONObject("raw"); JSONObject camera = metadata.optJSONObject("camera");
            JSONObject filter = metadata.optJSONObject("filter"); JSONObject lighting = metadata.optJSONObject("lighting");
            JSONObject dressing = metadata.optJSONObject("dressing");
            JSONArray clothes = dressing == null ? null : dressing.optJSONArray("clothes");
            JSONObject resolver = raw == null ? null : raw.optJSONObject("resolver");
            boolean nativeDetected = raw != null && raw.optString("nativeParamToken", "").length() == 44;
            StringBuilder out = new StringBuilder();
            out.append(nativeDetected ? "暖暖原生参数：已读取" : "暖暖原生参数：未检测到");
            boolean hasCanonical = camera != null && camera.length() > 0;
            if (hasCanonical) {
                appendParam(out, camera, "focalLength", "焦距"); appendParam(out, camera, "exposure", "曝光");
                appendParam(out, camera, "brightness", "亮度"); appendParam(out, camera, "contrast", "对比度");
                appendParam(out, camera, "saturation", "饱和度"); appendParam(out, camera, "vibrance", "鲜艳度");
                appendParam(out, camera, "highlights", "高光"); appendParam(out, camera, "shadows", "阴影");
            }
            if (filter != null && filter.length() > 0) {
                hasCanonical = true; appendMetadataIdStrength(out, filter, "滤镜");
            }
            if (lighting != null && lighting.length() > 0) {
                hasCanonical = true; appendMetadataIdStrength(out, lighting, "光照");
            }
            if (clothes != null && clothes.length() > 0) {
                hasCanonical = true; out.append("\n穿搭：").append(clothes.length()).append(" 件");
            }
            if (hasCanonical) return out.toString();

            String resolverStatus = resolver == null ? "" : resolver.optString("status", "");
            if ("resolved".equals(resolverStatus)) return out.append("\nNikkiSync 参数：已解析").toString();
            if ("failed".equals(resolverStatus)) {
                String reason = resolver.optString("error", "解析失败").replace('\n', ' ').replace('\r', ' ').trim();
                if (reason.length() > 80) reason = reason.substring(0, 80);
                return out.append("\nNikkiSync 参数：解析失败").append(reason.isEmpty() ? "" : "（" + reason + "）").toString();
            }
            return out.append(nativeDetected ? "\nNikkiSync 参数：解析中" : "\nNikkiSync 参数：暂无").toString();
        } catch (Exception error) { return "参数数据损坏：" + message(error); }
    }

    private static void appendMetadataIdStrength(StringBuilder out, JSONObject object, String label) {
        String id = object.optString("id", "").trim();
        String strength = object.has("strength") && !object.isNull("strength") ? String.valueOf(object.opt("strength")) : "";
        if (id.isEmpty() && strength.isEmpty()) return;
        out.append("\n").append(label).append("：");
        if (!id.isEmpty()) out.append(id);
        if (!strength.isEmpty()) out.append(id.isEmpty() ? "" : " · ").append("强度 ").append(strength);
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
        if (selectionBar == null || adapter == null) return;
        int count = adapter.selectedCount();
        selectionBar.setVisibility(activeTab == TAB_GALLERY && count > 0 ? View.VISIBLE : View.GONE);
        selectionLabel.setText("已选择 " + count + " 张"); saveButton.setText("保存原图");
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
    private void updatePairButton() { pairButton.setText(pairedServer == null ? "配对" : "电脑"); }
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
