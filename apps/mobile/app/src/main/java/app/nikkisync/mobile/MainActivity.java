package app.nikkisync.mobile;

import android.Manifest;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.util.Size;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
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

import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts;
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
import app.nikkisync.mobile.model.Models.ProfileClothingStat;
import app.nikkisync.mobile.model.Models.ProfileStatsResponse;
import app.nikkisync.mobile.model.Models.ProfileSuitStat;
import app.nikkisync.mobile.net.NikkiSyncClient;
import app.nikkisync.mobile.net.NsdDiscovery;
import app.nikkisync.mobile.net.RealtimeWebSocket;
import app.nikkisync.mobile.protocol.PairingUri;
import app.nikkisync.mobile.security.DeviceIdentity;
import app.nikkisync.mobile.storage.EditedMediaAccess;
import app.nikkisync.mobile.storage.EditedVariantStore;
import app.nikkisync.mobile.storage.SavedPhotoCollection;
import app.nikkisync.mobile.storage.SavedPhotoHealthStore;
import app.nikkisync.mobile.storage.SavedPhotoGroups;
import app.nikkisync.mobile.storage.SavedMetadataSnapshotStore;
import app.nikkisync.mobile.storage.SavedPhotoStore;
import app.nikkisync.mobile.storage.SavedPhotoRecovery;
import app.nikkisync.mobile.storage.SavedPhotoVerifier;
import app.nikkisync.mobile.storage.SavedViewState;
import app.nikkisync.mobile.storage.ServerStore;
import app.nikkisync.mobile.share.ShareCardExporter;
import app.nikkisync.mobile.share.ShareCardPayload;
import app.nikkisync.mobile.share.ShareCardPayloadBuilder;
import app.nikkisync.mobile.ui.ClothingSearchGrid;
import app.nikkisync.mobile.ui.GalleryAdapter;
import app.nikkisync.mobile.ui.SavedPhotoAdapter;
import app.nikkisync.mobile.ui.SavedMetadataText;
import app.nikkisync.mobile.ui.SuitSearchDialog;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MainActivity extends ComponentActivity implements NsdDiscovery.Listener {
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
    private SavedPhotoStore savedPhotoStore;
    private SavedPhotoHealthStore savedPhotoHealthStore;
    private EditedVariantStore editedVariantStore;
    private SavedMetadataSnapshotStore savedMetadataSnapshotStore;
    private DeviceIdentity identity;
    private NsdDiscovery discovery;
    private NikkiSyncClient client;
    private RealtimeWebSocket realtime;
    private PairedServer pairedServer;
    private ProfileStatsResponse profileStats;
    private boolean profileStatsLoading;
    private SavedPhotoStore.Record pendingEditedLinkSource;
    private final ActivityResultLauncher<PickVisualMediaRequest> editedPhotoPicker =
            registerForActivityResult(new ActivityResultContracts.PickMultipleVisualMedia(MediaStore.getPickImagesMaxLimit()), this::handleEditedPhotoSelection);

    private TextView titleLabel;
    private TextView status;
    private TextView countLabel;
    private TextView selectionLabel;
    private TextView tabPlaceholder;
    private TextView galleryEmpty;
    private TextView savedEmpty;
    private TextView savedSummary;
    private LinearLayout myContent;
    private Button pairButton;
    private Button searchButton;
    private Button saveButton;
    private Button galleryTabButton;
    private Button savedTabButton;
    private Button myTabButton;
    private Button savedAllButton;
    private Button savedLiveButton;
    private Button savedPhotoButton;
    private Button savedSortButton;
    private Button savedRecoverButton;
    private ProgressBar progress;
    private GalleryAdapter adapter;
    private SavedPhotoAdapter savedAdapter;
    private LinearLayout galleryMeta;
    private LinearLayout savedControls;
    private LinearLayout selectionBar;
    private RecyclerView galleryList;
    private RecyclerView savedList;
    private ScrollView myScroll;
    private int activeTab = TAB_GALLERY;
    private int savedFilter = SavedViewState.FILTER_ALL;
    private int savedSort = SavedViewState.SORT_SAVED;
    private final List<AssetSummary> assets = new ArrayList<>();
    private final Map<String, SavedPhotoHealthStore.Entry> savedHealth = new LinkedHashMap<>();

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        imageLoader = new ImageLoader(this);
        serverStore = new ServerStore(this);
        savedPhotoStore = new SavedPhotoStore(this);
        savedPhotoHealthStore = new SavedPhotoHealthStore(this);
        editedVariantStore = new EditedVariantStore(this);
        savedMetadataSnapshotStore = new SavedMetadataSnapshotStore(this);
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
        if (imageLoader != null) imageLoader.shutdown();
        if (savedAdapter != null) savedAdapter.shutdown();
        io.shutdownNow();
        if (editedVariantStore != null) editedVariantStore.close();
        if (savedMetadataSnapshotStore != null) savedMetadataSnapshotStore.close();
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

        savedControls = new LinearLayout(this);
        savedControls.setOrientation(LinearLayout.VERTICAL);
        savedControls.setPadding(dp(2), dp(8), dp(2), dp(8));
        savedControls.setVisibility(View.GONE);

        savedSummary = text("0 条保存记录", 12, false, getColor(R.color.text_secondary));
        savedSummary.setPadding(dp(2), 0, dp(2), dp(5));
        savedControls.addView(savedSummary);

        LinearLayout savedFilterRow = new LinearLayout(this);
        savedFilterRow.setGravity(Gravity.CENTER_VERTICAL);
        savedAllButton = button("全部");
        savedLiveButton = button("LIVE");
        savedPhotoButton = button("普通");
        savedFilterRow.addView(savedAllButton, new LinearLayout.LayoutParams(0, dp(38), 1));
        LinearLayout.LayoutParams savedMiddleLp = new LinearLayout.LayoutParams(0, dp(38), 1);
        savedMiddleLp.setMargins(dp(6), 0, dp(6), 0);
        savedFilterRow.addView(savedLiveButton, savedMiddleLp);
        savedFilterRow.addView(savedPhotoButton, new LinearLayout.LayoutParams(0, dp(38), 1));
        savedControls.addView(savedFilterRow);

        savedSortButton = button("最近保存");
        LinearLayout.LayoutParams savedSortLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(38)
        );
        savedSortLp.topMargin = dp(6);
        savedControls.addView(savedSortButton, savedSortLp);

        savedRecoverButton = button("找回历史保存");
        LinearLayout.LayoutParams recoverLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(38)
        );
        recoverLp.topMargin = dp(6);
        savedControls.addView(savedRecoverButton, recoverLp);

        savedAllButton.setOnClickListener(v -> {
            savedFilter = SavedViewState.FILTER_ALL;
            styleSavedControls();
            refreshSavedPhotos();
        });
        savedLiveButton.setOnClickListener(v -> {
            savedFilter = SavedViewState.FILTER_MOTION;
            styleSavedControls();
            refreshSavedPhotos();
        });
        savedPhotoButton.setOnClickListener(v -> {
            savedFilter = SavedViewState.FILTER_STILL;
            styleSavedControls();
            refreshSavedPhotos();
        });
        savedSortButton.setOnClickListener(v -> {
            savedSort = savedSort == SavedViewState.SORT_SAVED
                    ? SavedViewState.SORT_CAPTURED
                    : SavedViewState.SORT_SAVED;
            savedSortButton.setText(savedSort == SavedViewState.SORT_SAVED ? "最近保存" : "拍摄时间");
            refreshSavedPhotos();
        });
        savedRecoverButton.setOnClickListener(v -> recoverHistoricalSavedPhotos());
        styleSavedControls();
        root.addView(savedControls);

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

        savedList = new RecyclerView(this);
        savedList.setVerticalScrollBarEnabled(false);
        savedList.setClipToPadding(false);
        savedList.setPadding(0, 0, 0, dp(12));
        GridLayoutManager savedLayout = new GridLayoutManager(this, 3);
        savedList.setLayoutManager(savedLayout);
        savedAdapter = new SavedPhotoAdapter(this, new SavedPhotoAdapter.Listener() {
            @Override public void onOriginalClick(SavedPhotoStore.Record record) {
                showSavedPhotoDetails(record);
            }

            @Override public void onEditedClick(EditedVariantStore.Variant variant) {
                showEditedPhotoDetails(variant);
            }
        });
        savedLayout.setSpanSizeLookup(new GridLayoutManager.SpanSizeLookup() {
            @Override public int getSpanSize(int position) { return savedAdapter.isHeader(position) ? 3 : 1; }
        });
        savedList.setAdapter(savedAdapter);
        savedList.setVisibility(View.GONE);
        content.addView(savedList, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        myScroll = new ScrollView(this);
        myScroll.setFillViewport(true);
        myScroll.setVisibility(View.GONE);
        myContent = new LinearLayout(this);
        myContent.setOrientation(LinearLayout.VERTICAL);
        myContent.setPadding(0, dp(8), 0, dp(24));
        myScroll.addView(myContent, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        content.addView(myScroll, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        galleryEmpty = text("", 14, false, getColor(R.color.text_secondary));
        galleryEmpty.setGravity(Gravity.CENTER); galleryEmpty.setPadding(dp(28), dp(28), dp(28), dp(28)); galleryEmpty.setVisibility(View.GONE);
        content.addView(galleryEmpty, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        savedEmpty = text("还没有保存记录。\n从图库选择照片并保存原图后，会出现在这里。", 14, false, getColor(R.color.text_secondary));
        savedEmpty.setGravity(Gravity.CENTER);
        savedEmpty.setPadding(dp(28), dp(28), dp(28), dp(28));
        savedEmpty.setVisibility(View.GONE);
        content.addView(savedEmpty, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

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
        boolean saved = tab == TAB_SAVED;
        boolean my = tab == TAB_MY;

        galleryList.setVisibility(gallery ? View.VISIBLE : View.GONE);
        savedList.setVisibility(saved ? View.VISIBLE : View.GONE);
        myScroll.setVisibility(my ? View.VISIBLE : View.GONE);
        galleryMeta.setVisibility(gallery ? View.VISIBLE : View.GONE);
        updateSavedControlsVisibility(saved);
        searchButton.setVisibility(gallery ? View.VISIBLE : View.GONE);
        tabPlaceholder.setVisibility(View.GONE);
        pairButton.setVisibility(gallery ? View.VISIBLE : View.GONE);

        if (gallery) {
            titleLabel.setText("暖暖相册");
            tabPlaceholder.setText("");
        } else if (saved) {
            titleLabel.setText("已保存");
            refreshSavedPhotos();
        } else {
            titleLabel.setText("我的");
            refreshMyPage();
        }

        styleTab(galleryTabButton, gallery);
        styleTab(savedTabButton, saved);
        styleTab(myTabButton, my);
        updateSelection();
        updateGalleryEmptyState();
        updateSavedEmptyState();
    }

    private void styleTab(Button button, boolean selected) {
        button.setTypeface(selected ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        button.setAlpha(selected ? 1f : 0.62f);
        button.setBackground(selected ? getDrawable(R.drawable.bg_glass_chip) : null);
    }

    private void styleSavedControls() {
        styleTab(savedAllButton, savedFilter == SavedViewState.FILTER_ALL);
        styleTab(savedLiveButton, savedFilter == SavedViewState.FILTER_MOTION);
        styleTab(savedPhotoButton, savedFilter == SavedViewState.FILTER_STILL);
    }

    private void updateSavedControlsVisibility(boolean show) {
        savedControls.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    private void refreshMyPage() {
        if (myContent == null) return;
        myContent.removeAllViews();

        Map<String, Integer> uidCounts = new LinkedHashMap<>();
        Map<String, Integer> versionCounts = new LinkedHashMap<>();
        int unknownVersionCount = 0;
        int liveCount = 0;
        int metadataCount = 0;

        for (AssetSummary asset : assets) {
            if (asset.hasMotion()) liveCount++;
            if (asset.hasMetadata()) metadataCount++;

            if (asset.gameVersion() == null || asset.gameVersion().isBlank()) {
                unknownVersionCount++;
            } else {
                versionCounts.put(asset.gameVersion(), versionCounts.getOrDefault(asset.gameVersion(), 0) + 1);
            }

            if (asset.uid() != null && !asset.uid().isBlank()) {
                uidCounts.put(asset.uid(), uidCounts.getOrDefault(asset.uid(), 0) + 1);
            }
        }

        if (uidCounts.isEmpty()) {
            addMyCard("玩家 UID", "尚未从当前图库照片中解析到 UID");
        } else if (uidCounts.size() == 1) {
            Map.Entry<String, Integer> entry = uidCounts.entrySet().iterator().next();
            addMyActionCard(
                    "玩家 UID",
                    entry.getKey() + "\n来自 " + entry.getValue() + " 张照片",
                    "复制 UID",
                    () -> copyText("Nikki UID", entry.getKey())
            );
        } else {
            StringBuilder body = new StringBuilder("发现 " + uidCounts.size() + " 个 UID，当前图库可能包含多个账号");
            StringBuilder copy = new StringBuilder();
            int shown = 0;
            for (Map.Entry<String, Integer> entry : uidCounts.entrySet()) {
                if (copy.length() > 0) copy.append("\n");
                copy.append(entry.getKey());
                if (shown < 4) body.append("\n").append(entry.getKey()).append(" · ").append(entry.getValue()).append(" 张");
                shown++;
            }
            if (uidCounts.size() > 4) body.append("\n另有 ").append(uidCounts.size() - 4).append(" 个 UID");
            addMyActionCard("玩家 UID", body.toString(), "复制全部 UID", () -> copyText("Nikki UIDs", copy.toString()));
        }

        List<SavedPhotoStore.Record> savedRecords = savedPhotoStore == null ? List.of() : savedPhotoStore.load();
        Map<String, SavedPhotoHealthStore.Entry> health = savedPhotoHealthStore == null
                ? Map.of()
                : savedPhotoHealthStore.load();
        int missingSaved = 0;
        for (SavedPhotoStore.Record record : savedRecords) {
            SavedPhotoHealthStore.Entry entry = health.get(record.uri());
            if (entry != null && entry.isMissing()) missingSaved++;
        }

        int livePercent = assets.isEmpty() ? 0 : Math.round(liveCount * 100f / assets.size());
        int metadataPercent = assets.isEmpty() ? 0 : Math.round(metadataCount * 100f / assets.size());
        String stats = "图库照片：" + assets.size()
                + "\nLIVE：" + liveCount + " · " + livePercent + "%"
                + "\n已解析参数：" + metadataCount + " · " + metadataPercent + "%"
                + "\n已保存记录：" + savedRecords.size()
                + (missingSaved == 0 ? "" : "\n文件缺失：" + missingSaved);
        addMyCard("图库概况", stats);

        List<Map.Entry<String, Integer>> versionRows = new ArrayList<>(versionCounts.entrySet());
        versionRows.sort((left, right) -> {
            int count = Integer.compare(right.getValue(), left.getValue());
            return count != 0 ? count : left.getKey().compareTo(right.getKey());
        });
        StringBuilder versionBody = new StringBuilder();
        for (Map.Entry<String, Integer> entry : versionRows) {
            if (versionBody.length() > 0) versionBody.append("\n");
            versionBody.append(entry.getKey()).append(" · ").append(entry.getValue()).append(" 张");
        }
        if (unknownVersionCount > 0) {
            if (versionBody.length() > 0) versionBody.append("\n");
            versionBody.append("版本未知 · ").append(unknownVersionCount).append(" 张");
        }
        addMyCard("版本分布", versionBody.length() == 0 ? "当前没有可统计的版本信息" : versionBody.toString());

        String device = pairedServer == null
                ? "尚未配对电脑"
                : "已配对：" + pairedServer.serverName() + "\n图库 revision：" + pairedServer.lastRevision();
        addMyCard("同步与设备", device);

        renderRemoteProfileStats();

        addMyCard(
                "数据说明",
                "UID、版本与图库统计来自 NikkiSync 已解析的本地同步数据；常用穿搭与字典状态由已配对 PC 本地汇总。发现多个 UID 时不会自动猜测主账号。"
        );

        loadRemoteProfileStats();
    }

    private void renderRemoteProfileStats() {
        if (client == null) {
            addMyCard("常用穿搭", "连接已配对电脑后显示常用套装与散件。");
            addMyCard("数据源状态", pairedServer == null ? "尚未配对电脑" : "电脑当前不可达");
            return;
        }

        ProfileStatsResponse stats = profileStats;
        if (stats == null) {
            addMyCard("常用穿搭", "正在从电脑汇总本地穿搭数据…");
            addMyCard("数据源状态", "正在读取服装字典与图库汇总状态…");
            return;
        }

        if (stats.topSuits().isEmpty()) {
            addMyCard("常用套装", "当前没有可统计的套装数据");
        } else {
            List<String> labels = new ArrayList<>();
            List<Runnable> actions = new ArrayList<>();
            int rank = 1;
            for (ProfileSuitStat item : stats.topSuits()) {
                labels.add(rank++ + ". " + item.suitName() + " · " + item.photoCount() + " 张");
                actions.add(() -> openProfileSearch(item.suitName(), false));
            }
            addMyLinkCard("常用套装", labels, actions);
        }

        if (stats.topClothing().isEmpty()) {
            addMyCard("常用散件", "当前没有可统计的散件数据");
        } else {
            List<String> labels = new ArrayList<>();
            List<Runnable> actions = new ArrayList<>();
            int rank = 1;
            for (ProfileClothingStat item : stats.topClothing()) {
                String name = item.name() == null || item.name().isBlank() ? item.clothingId() : item.name();
                String label = rank++ + ". " + name;
                if (item.category() != null && !item.category().isBlank()) {
                    label += " · " + ClothingSearchGrid.categoryLabel(item.category());
                }
                label += " · " + item.photoCount() + " 张";
                labels.add(label);
                String query = name;
                actions.add(() -> openProfileSearch(query, true));
            }
            addMyLinkCard("常用散件", labels, actions);
        }

        if (stats.dictionary() == null) {
            addMyCard("数据源状态", "当前 PC 没有活动服装字典。照片基础参数仍可使用，但服装名称、套装归属和缩略图可能不完整。");
        } else {
            String source = "Provider：" + stats.dictionary().provider()
                    + "\n版本：" + stats.dictionary().providerVersion()
                    + (stats.dictionary().gameVersion() == null ? "" : "\n游戏版本：" + stats.dictionary().gameVersion())
                    + "\n服装条目：" + stats.dictionary().clothingEntries()
                    + (stats.dictionary().fetchedAt() == null ? "" : "\n更新时间：" + stats.dictionary().fetchedAt())
                    + "\n汇总 revision：" + stats.libraryRevision();
            addMyCard("数据源状态", source);
        }
    }

    private void loadRemoteProfileStats() {
        NikkiSyncClient current = client;
        if (current == null || profileStatsLoading) return;

        long expectedRevision = pairedServer == null ? 0 : pairedServer.lastRevision();
        if (profileStats != null && (expectedRevision <= 0 || profileStats.libraryRevision() == expectedRevision)) return;

        profileStatsLoading = true;
        io.execute(() -> {
            try {
                ProfileStatsResponse next = current.profileStats();
                main.post(() -> {
                    profileStats = next;
                    profileStatsLoading = false;
                    if (activeTab == TAB_MY) refreshMyPage();
                });
            } catch (Exception ignored) {
                main.post(() -> profileStatsLoading = false);
            }
        });
    }

    private void openProfileSearch(String query, boolean clothing) {
        NikkiSyncClient current = client;
        if (current == null) {
            toast("请先连接电脑");
            return;
        }
        switchTab(TAB_GALLERY);
        if (clothing) {
            SuitSearchDialog.showClothing(this, current, imageLoader, io, main, this::showViewer, query);
        } else {
            SuitSearchDialog.showSuit(this, current, imageLoader, io, main, this::showViewer, query);
        }
    }

    private void addMyLinkCard(String title, List<String> labels, List<Runnable> actions) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(13), dp(14), dp(13));
        card.setBackgroundResource(R.drawable.bg_glass_card);
        card.addView(text(title, 16, true, getColor(R.color.text_primary)));

        int count = Math.min(labels.size(), actions.size());
        for (int index = 0; index < count; index++) {
            Button row = button(labels.get(index));
            row.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
            row.setOnClickListener(v -> actions.get((Integer) v.getTag()).run());
            row.setTag(index);
            LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    dp(42)
            );
            rowLp.topMargin = dp(6);
            card.addView(row, rowLp);
        }

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        lp.setMargins(0, 0, 0, dp(10));
        myContent.addView(card, lp);
    }

    private void addMyActionCard(String title, String body, String action, Runnable onClick) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(13), dp(14), dp(13));
        card.setBackgroundResource(R.drawable.bg_glass_card);

        card.addView(text(title, 16, true, getColor(R.color.text_primary)));
        TextView content = text(body, 13, false, getColor(R.color.text_secondary));
        content.setPadding(0, dp(5), 0, 0);
        card.addView(content);

        Button actionButton = button(action);
        LinearLayout.LayoutParams actionLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(40)
        );
        actionLp.topMargin = dp(9);
        actionButton.setOnClickListener(v -> onClick.run());
        card.addView(actionButton, actionLp);

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        lp.setMargins(0, 0, 0, dp(10));
        myContent.addView(card, lp);
    }

    private void copyText(String label, String value) {
        android.content.ClipboardManager clipboard =
                (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (clipboard == null) {
            toast("系统剪贴板不可用");
            return;
        }
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText(label, value));
        toast("已复制");
    }

    private void addMyCard(String title, String body) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(13), dp(14), dp(13));
        card.setBackgroundResource(R.drawable.bg_glass_card);

        card.addView(text(title, 16, true, getColor(R.color.text_primary)));
        TextView content = text(body, 13, false, getColor(R.color.text_secondary));
        content.setPadding(0, dp(5), 0, 0);
        card.addView(content);

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        lp.setMargins(0, 0, 0, dp(10));
        myContent.addView(card, lp);
    }

    private void updateGalleryEmptyState() {
        if (galleryEmpty == null) return;
        boolean show = activeTab == TAB_GALLERY && assets.isEmpty();
        galleryEmpty.setVisibility(show ? View.VISIBLE : View.GONE);
        if (show) galleryEmpty.setText(pairedServer == null ? "配对电脑后，这里会显示暖暖照片。" : "当前还没有同步到照片。");
    }

    private void refreshSavedPhotos() {
        if (savedAdapter == null || savedPhotoStore == null || editedVariantStore == null) return;

        List<SavedPhotoStore.Record> records = savedPhotoStore.load();
        List<EditedVariantStore.Variant> edits = editedVariantStore.loadAll();
        List<SavedPhotoGroups.Group> groups = SavedPhotoGroups.select(records, edits, savedFilter, savedSort);
        savedAdapter.setGroups(groups);

        savedHealth.clear();
        savedHealth.putAll(savedPhotoHealthStore.load());
        updateSavedSummary(records, edits);
        updateSavedEmptyState();

        long newestCheck = 0L;
        for (SavedPhotoHealthStore.Entry entry : savedHealth.values()) {
            newestCheck = Math.max(newestCheck, entry.lastCheckedAt());
        }

        List<String> uris = new ArrayList<>();
        for (SavedPhotoStore.Record record : records) uris.add(record.uri());
        for (EditedVariantStore.Variant edit : edits) uris.add(edit.uri());
        if (uris.isEmpty() || System.currentTimeMillis() - newestCheck < 30_000L) return;

        io.execute(() -> {
            Map<String, SavedPhotoHealthStore.Entry> checked =
                    SavedPhotoVerifier.verifyUris(this, savedPhotoHealthStore, uris);
            main.post(() -> {
                savedHealth.clear();
                savedHealth.putAll(checked);
                updateSavedSummary(records, edits);
            });
        });
    }

    private void recoverHistoricalSavedPhotos() {
        NikkiSyncClient current = client;
        if (current == null) {
            toast("请先连接电脑，再找回历史保存");
            return;
        }
        if (assets.isEmpty()) {
            toast("当前图库还没有可用于匹配的照片");
            return;
        }

        savedRecoverButton.setEnabled(false);
        savedSummary.setText("正在查找历史保存…");
        List<AssetSummary> snapshot = new ArrayList<>(assets);

        io.execute(() -> {
            try {
                SavedPhotoRecovery.Result result =
                        SavedPhotoRecovery.recover(this, current, snapshot, savedPhotoStore);
                main.post(() -> {
                    savedRecoverButton.setEnabled(true);
                    refreshSavedPhotos();
                    String message = result.recovered() > 0
                            ? "已找回 " + result.recovered() + " 条历史保存记录"
                            : "没有发现可高置信关联的历史保存";
                    if (result.skippedAmbiguous() > 0) {
                        message += "，跳过 " + result.skippedAmbiguous() + " 条歧义匹配";
                    }
                    message += "。旧版 VIVO LIVE 因文件名不含来源信息，暂不自动关联。";
                    toast(message);
                });
            } catch (Exception error) {
                main.post(() -> {
                    savedRecoverButton.setEnabled(true);
                    refreshSavedPhotos();
                    toast("历史保存找回失败：" + message(error));
                });
            }
        });
    }

    private void updateSavedSummary(
            List<SavedPhotoStore.Record> allRecords,
            List<EditedVariantStore.Variant> edits
    ) {
        if (savedSummary == null) return;
        int missing = 0;
        for (SavedPhotoStore.Record record : allRecords) {
            SavedPhotoHealthStore.Entry entry = savedHealth.get(record.uri());
            if (entry != null && entry.isMissing()) missing++;
        }
        for (EditedVariantStore.Variant edit : edits) {
            SavedPhotoHealthStore.Entry entry = savedHealth.get(edit.uri());
            if (entry != null && entry.isMissing()) missing++;
        }

        String summary = allRecords.size() + " 条保存记录";
        if (!edits.isEmpty()) summary += " · " + edits.size() + " 张修图";
        if (savedFilter == SavedViewState.FILTER_MOTION) summary += " · LIVE";
        else if (savedFilter == SavedViewState.FILTER_STILL) summary += " · 普通照片";
        if (missing > 0) summary += " · " + missing + " 条文件缺失";
        savedSummary.setText(summary);
    }

    private void updateSavedEmptyState() {
        if (savedEmpty == null || savedAdapter == null) return;
        savedEmpty.setVisibility(activeTab == TAB_SAVED && savedAdapter.getItemCount() == 0 ? View.VISIBLE : View.GONE);
    }

    private void showSavedPhotoDetails(SavedPhotoStore.Record record) {
        Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(getColor(R.color.app_background));

        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(14), dp(12), dp(14), dp(24));
        scroll.addView(body);

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.addView(text(record.hasMotion() ? "已保存 LIVE" : "已保存照片", 20, true, getColor(R.color.text_primary)),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button close = button("完成");
        close.setOnClickListener(v -> dialog.dismiss());
        header.addView(close);
        body.addView(header);

        ImageView preview = new ImageView(this);
        preview.setScaleType(ImageView.ScaleType.CENTER_CROP);
        preview.setBackgroundResource(R.drawable.bg_gallery_photo);
        preview.setClipToOutline(true);
        int previewSize = Math.max(dp(240), getResources().getDisplayMetrics().widthPixels - dp(28));
        LinearLayout.LayoutParams previewLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, previewSize);
        previewLp.topMargin = dp(10);
        body.addView(preview, previewLp);

        io.execute(() -> {
            try {
                android.graphics.Bitmap bitmap = getContentResolver().loadThumbnail(record.mediaUri(), new Size(1200, 1200), null);
                main.post(() -> preview.setImageBitmap(bitmap));
            } catch (Exception ignored) {
                main.post(() -> preview.setImageDrawable(null));
            }
        });

        LinearLayout info = new LinearLayout(this);
        info.setOrientation(LinearLayout.VERTICAL);
        info.setPadding(dp(14), dp(14), dp(14), dp(14));
        info.setBackgroundResource(R.drawable.bg_glass_card);
        LinearLayout.LayoutParams infoLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        infoLp.topMargin = dp(10);
        body.addView(info, infoLp);

        SavedPhotoHealthStore.Entry healthEntry = savedHealth.get(record.uri());
        boolean missing = healthEntry != null && healthEntry.isMissing();
        String savedAt = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(new Date(record.savedAt()));
        String detail = "状态：" + (missing ? "文件不存在" : "可访问")
                + "\n保存时间：" + savedAt
                + "\n格式：" + (record.format() == null ? (record.hasMotion() ? "LIVE" : "原图") : record.format())
                + (record.rotationDegrees() == 0 ? "" : "\n保存旋转：" + record.rotationDegrees() + "°")
                + (record.gameVersion() == null ? "" : "\n游戏版本：" + record.gameVersion())
                + (record.capturedAt() == null ? "" : "\n拍摄时间：" + record.capturedAt())
                + "\n来源 Asset：" + record.assetId();
        info.addView(text(detail, 13, false, getColor(R.color.text_secondary)));

        Button openSystem = button(missing ? "系统相册文件已不存在" : "在系统相册打开");
        openSystem.setEnabled(!missing);
        LinearLayout.LayoutParams buttonLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        buttonLp.topMargin = dp(10);
        openSystem.setOnClickListener(v -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(record.mediaUri(), "image/*");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(intent);
            } catch (Exception error) {
                toast("系统相册无法打开这张照片");
            }
        });
        info.addView(openSystem, buttonLp);

        Button linkEdit = button("关联修图");
        LinearLayout.LayoutParams linkEditLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        linkEditLp.topMargin = dp(6);
        linkEdit.setOnClickListener(v -> {
            dialog.dismiss();
            startEditedPhotoLink(record);
        });
        info.addView(linkEdit, linkEditLp);

        AssetSummary source = findAsset(record.assetId());
        if (source != null) {
            Button sourceButton = button("查看源照片");
            LinearLayout.LayoutParams sourceLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            sourceLp.topMargin = dp(6);
            sourceButton.setOnClickListener(v -> showViewer(source));
            info.addView(sourceButton, sourceLp);
        }

        Button removeRecord = button("仅移除 NikkiSync 记录");
        LinearLayout.LayoutParams removeLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        removeLp.topMargin = dp(6);
        removeRecord.setOnClickListener(v -> new AlertDialog.Builder(this)
                .setTitle("移除保存记录？")
                .setMessage("只会从 NikkiSync 的“已保存”中移除记录，不会删除系统相册里的照片。")
                .setNegativeButton("取消", null)
                .setPositiveButton("移除", (d, which) -> {
                    savedPhotoStore.removeUri(record.uri());
                    savedPhotoHealthStore.remove(record.uri());
                    savedHealth.remove(record.uri());
                    dialog.dismiss();
                    refreshSavedPhotos();
                })
                .show());
        info.addView(removeRecord, removeLp);

        dialog.setContentView(scroll);
        dialog.show();
        if (dialog.getWindow() != null) {
            dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
        }
    }

    private void showEditedPhotoDetails(EditedVariantStore.Variant variant) {
        Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(getColor(R.color.app_background));

        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(14), dp(12), dp(14), dp(24));
        scroll.addView(body);

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.addView(text("修图版", 20, true, getColor(R.color.text_primary)),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button close = button("完成");
        close.setOnClickListener(v -> dialog.dismiss());
        header.addView(close);
        body.addView(header);

        ImageView preview = new ImageView(this);
        preview.setScaleType(ImageView.ScaleType.CENTER_CROP);
        preview.setBackgroundResource(R.drawable.bg_gallery_photo);
        preview.setClipToOutline(true);
        int previewSize = Math.max(dp(240), getResources().getDisplayMetrics().widthPixels - dp(28));
        LinearLayout.LayoutParams previewLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                previewSize
        );
        previewLp.topMargin = dp(10);
        body.addView(preview, previewLp);

        io.execute(() -> {
            try {
                android.graphics.Bitmap bitmap = getContentResolver().loadThumbnail(
                        Uri.parse(variant.uri()), new Size(1200, 1200), null);
                main.post(() -> preview.setImageBitmap(bitmap));
            } catch (Exception ignored) {
                main.post(() -> preview.setImageDrawable(null));
            }
        });

        LinearLayout info = new LinearLayout(this);
        info.setOrientation(LinearLayout.VERTICAL);
        info.setPadding(dp(14), dp(14), dp(14), dp(14));
        info.setBackgroundResource(R.drawable.bg_glass_card);
        LinearLayout.LayoutParams infoLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        infoLp.topMargin = dp(10);
        body.addView(info, infoLp);

        SavedPhotoHealthStore.Entry healthEntry = savedHealth.get(variant.uri());
        boolean missing = healthEntry != null && healthEntry.isMissing();
        String linkedAt = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
                .format(new Date(variant.linkedAt()));
        String detail = "状态：" + (missing ? "文件不可访问" : "可访问")
                + "\n关联时间：" + linkedAt
                + (variant.displayName() == null ? "" : "\n文件：" + variant.displayName())
                + (variant.mimeType() == null ? "" : "\n类型：" + variant.mimeType())
                + "\n来源 Asset：" + variant.assetId();
        info.addView(text(detail, 13, false, getColor(R.color.text_secondary)));

        TextView params = text("正在读取关联照片参数…", 13, false, getColor(R.color.text_secondary));
        params.setPadding(0, dp(12), 0, dp(8));
        info.addView(params);

        SavedMetadataSnapshotStore.Snapshot cached =
                savedMetadataSnapshotStore == null ? null : savedMetadataSnapshotStore.get(variant.assetId());
        if (cached != null) params.setText(savedMetadataDetail(cached.metadataJson()));
        else params.setText("暂无离线参数快照。连接已配对电脑后会自动读取。");

        AssetSummary currentSource = findAsset(variant.assetId());
        NikkiSyncClient currentClient = client;
        if (currentClient != null) {
            io.execute(() -> {
                try {
                    AssetDetail online = currentClient.asset(variant.assetId());
                    String capturedAt = currentSource != null
                            ? currentSource.capturedAt()
                            : cached == null ? null : cached.capturedAt();
                    String gameVersion = currentSource != null
                            ? currentSource.gameVersion()
                            : cached == null ? null : cached.gameVersion();
                    cacheMetadataSnapshot(variant.assetId(), capturedAt, gameVersion, online);
                    main.post(() -> params.setText(savedMetadataDetail(online.metadataJson())));
                } catch (Exception error) {
                    if (cached == null) {
                        main.post(() -> params.setText("参数读取失败：" + message(error)));
                    }
                }
            });
        }

        SavedPhotoStore.Record original = findOriginalSavedRecord(variant.assetId());
        Button originalButton = button(original == null ? "原始保存图记录不存在" : "查看原始保存图");
        originalButton.setEnabled(original != null);
        LinearLayout.LayoutParams originalLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        originalLp.topMargin = dp(8);
        originalButton.setOnClickListener(v -> {
            if (original == null) return;
            dialog.dismiss();
            showSavedPhotoDetails(original);
        });
        info.addView(originalButton, originalLp);

        AssetSummary source = findAsset(variant.assetId());
        if (source != null) {
            Button sourceButton = button("查看源照片");
            LinearLayout.LayoutParams sourceLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
            );
            sourceLp.topMargin = dp(6);
            sourceButton.setOnClickListener(v -> {
                dialog.dismiss();
                showViewer(source);
            });
            info.addView(sourceButton, sourceLp);
        }

        Button unlink = button("解除关联");
        LinearLayout.LayoutParams unlinkLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        unlinkLp.topMargin = dp(8);
        unlink.setOnClickListener(v -> new AlertDialog.Builder(this)
                .setTitle("解除修图关联？")
                .setMessage("只会移除 NikkiSync 内的关联，不会删除或修改系统相册里的图片。")
                .setNegativeButton("取消", null)
                .setPositiveButton("解除关联", (d, which) -> {
                    String uri = variant.uri();
                    boolean removed = editedVariantStore.unlink(variant.variantId());
                    if (!removed) {
                        toast("关联记录已不存在");
                        return;
                    }
                    savedPhotoHealthStore.remove(uri);
                    savedHealth.remove(uri);
                    if (editedVariantStore.findByUri(uri) == null && !isOriginalSavedUri(uri)) {
                        try {
                            getContentResolver().releasePersistableUriPermission(
                                    Uri.parse(uri),
                                    Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        } catch (Exception ignored) {}
                    }
                    dialog.dismiss();
                    refreshSavedPhotos();
                    toast("已解除关联，系统相册中的图片未删除");
                })
                .show());
        info.addView(unlink, unlinkLp);

        dialog.setContentView(scroll);
        dialog.show();
        if (dialog.getWindow() != null) {
            dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
        }
    }

    private SavedPhotoStore.Record findOriginalSavedRecord(String assetId) {
        SavedPhotoStore.Record fallback = null;
        for (SavedPhotoStore.Record record : savedPhotoStore.load()) {
            if (!record.assetId().equals(assetId)) continue;
            if (fallback == null) fallback = record;
            SavedPhotoHealthStore.Entry health = savedHealth.get(record.uri());
            if (health == null || !health.isMissing()) return record;
        }
        return fallback;
    }

    private boolean isOriginalSavedUri(String uri) {
        for (SavedPhotoStore.Record record : savedPhotoStore.load()) {
            if (record.uri().equals(uri)) return true;
        }
        return false;
    }

    private String savedMetadataDetail(String metadataJson) {
        StringBuilder out = new StringBuilder(SavedMetadataText.summary(metadataJson));
        List<String> clothes = SavedMetadataText.clothingLines(metadataJson);
        if (!clothes.isEmpty()) {
            out.append("\n\n穿搭明细");
            for (String clothing : clothes) out.append("\n· ").append(clothing);
        }
        return out.toString();
    }

    private void cacheMetadataSnapshot(
            String assetId,
            String capturedAt,
            String gameVersion,
            AssetDetail detail
    ) {
        if (savedMetadataSnapshotStore == null || detail == null
                || detail.metadataJson() == null || detail.metadataJson().isBlank()) return;
        SavedMetadataSnapshotStore.Snapshot previous = savedMetadataSnapshotStore.get(assetId);
        String finalCapturedAt = capturedAt != null && !capturedAt.isBlank()
                ? capturedAt
                : previous == null ? null : previous.capturedAt();
        String finalGameVersion = gameVersion != null && !gameVersion.isBlank()
                ? gameVersion
                : previous == null ? null : previous.gameVersion();
        savedMetadataSnapshotStore.put(new SavedMetadataSnapshotStore.Snapshot(
                assetId,
                detail.metadataJson(),
                finalCapturedAt,
                finalGameVersion,
                System.currentTimeMillis()
        ));
    }

    private AssetSummary findAsset(String assetId) {
        for (AssetSummary asset : assets) if (asset.assetId().equals(assetId)) return asset;
        return null;
    }

    private void handleIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        String raw = intent.getDataString();
        if (raw != null && raw.startsWith("nikki-sync://pair?")) beginPair(raw);
    }

    private void startEditedPhotoLink(SavedPhotoStore.Record original) {
        pendingEditedLinkSource = original;
        editedPhotoPicker.launch(new PickVisualMediaRequest.Builder()
                .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE)
                .build());
    }

    private void handleEditedPhotoSelection(List<Uri> uris) {
        SavedPhotoStore.Record source = pendingEditedLinkSource;
        pendingEditedLinkSource = null;
        if (source == null || uris == null || uris.isEmpty()) return;

        List<Uri> selected = new ArrayList<>(uris);
        io.execute(() -> {
            int added = 0;
            int duplicates = 0;
            int conflicts = 0;
            int limitedAccess = 0;
            long baseTime = System.currentTimeMillis();

            for (int index = 0; index < selected.size(); index++) {
                Uri uri = selected.get(index);
                if (uri == null) continue;
                try {
                    EditedMediaAccess.Info media = EditedMediaAccess.describeAndPersist(this, uri);
                    if (!media.persistGranted()) limitedAccess++;
                    EditedVariantStore.LinkResult result = editedVariantStore.link(
                            source.assetId(),
                            source.uri(),
                            media.uri(),
                            baseTime + index,
                            media.displayName(),
                            media.mimeType()
                    );
                    if (result.status() == EditedVariantStore.LinkStatus.ADDED) added++;
                    else if (result.status() == EditedVariantStore.LinkStatus.DUPLICATE) duplicates++;
                    else conflicts++;
                } catch (Exception ignored) {
                    conflicts++;
                }
            }

            NikkiSyncClient current = client;
            if (current != null) {
                try {
                    AssetDetail detail = current.asset(source.assetId());
                    cacheMetadataSnapshot(source.assetId(), source.capturedAt(), source.gameVersion(), detail);
                } catch (Exception ignored) {}
            }

            int finalAdded = added;
            int finalDuplicates = duplicates;
            int finalConflicts = conflicts;
            int finalLimitedAccess = limitedAccess;
            main.post(() -> {
                refreshSavedPhotos();
                StringBuilder result = new StringBuilder();
                if (finalAdded > 0) result.append("已关联 ").append(finalAdded).append(" 张修图");
                if (finalDuplicates > 0) {
                    if (result.length() > 0) result.append("，");
                    result.append("跳过 ").append(finalDuplicates).append(" 张重复图片");
                }
                if (finalConflicts > 0) {
                    if (result.length() > 0) result.append("，");
                    result.append(finalConflicts).append(" 张已关联到其他照片");
                }
                if (finalLimitedAccess > 0) {
                    if (result.length() > 0) result.append("。");
                    result.append("部分图片的长期访问权限由系统相册提供方决定");
                }
                if (result.length() == 0) result.append("没有新增关联");
                toast(result.toString());
            });
        });
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
                    Uri savedUri;
                    String savedFormat;
                    int savedRotation = 0;

                    if (asset.hasMotion()) {
                        String manufacturer = ((android.os.Build.MANUFACTURER == null ? "" : android.os.Build.MANUFACTURER) + " " +
                                (android.os.Build.BRAND == null ? "" : android.os.Build.BRAND)).toLowerCase(java.util.Locale.ROOT);
                        if (manufacturer.contains("vivo") || manufacturer.contains("iqoo")) {
                            savedUri = vivoLivePhotoSaver.save(this, current, asset);
                            savedFormat = "OriginOS LIVE";
                        } else if (manufacturer.contains("huawei") || manufacturer.contains("honor")) {
                            savedUri = huaweiMovingPhotoSaver.save(this, current, asset);
                            savedFormat = "Huawei 动态照片";
                        } else if (manufacturer.contains("oppo") || manufacturer.contains("oneplus") || manufacturer.contains("realme")) {
                            savedUri = oppoLivePhotoSaver.save(this, current, asset);
                            savedFormat = "ColorOS O-Live";
                        } else if (manufacturer.contains("samsung")) {
                            savedUri = samsungMotionPhotoSaver.save(this, current, asset);
                            savedFormat = "Samsung Motion Photo";
                        } else {
                            savedUri = motionPhotoSaver.save(this, current, asset);
                            savedFormat = "Android Motion Photo";
                        }
                    } else {
                        savedRotation = rotationByAssetId.getOrDefault(asset.assetId(), 0);
                        savedUri = originalSaver.save(this, current, asset, savedRotation);
                        savedFormat = savedRotation == 0 ? "原始照片" : "原始照片 · EXIF 旋转";
                    }

                    savedPhotoStore.record(asset, savedUri, savedRotation, savedFormat);
                    try {
                        AssetDetail savedDetail = current.asset(asset.assetId());
                        cacheMetadataSnapshot(asset.assetId(), asset.capturedAt(), asset.gameVersion(), savedDetail);
                    } catch (Exception ignored) {
                        // Saving the user's media succeeds independently from metadata-cache refresh.
                    }
                    success++;
                } catch (Exception ignored) {
                    failure++;
                }
            }
            int saved = success, failed = failure; boolean motion = hadMotion;
            main.post(() -> {
                setBusy(false); saveButton.setEnabled(true);
                for (AssetSummary item : selected) rotationByAssetId.remove(item.assetId());
                adapter.clearSelection(); updateSelection();
                refreshSavedPhotos();
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

        Button shareCard = button("生成分享图");
        shareCard.setEnabled(false);
        LinearLayout.LayoutParams shareLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        shareLp.topMargin = dp(8);
        infoSheet.addView(shareCard, shareLp);

        AssetDetail[] detailHolder = new AssetDetail[1];
        io.execute(() -> {
            try {
                AssetDetail detail = client.asset(asset.assetId());
                cacheMetadataSnapshot(asset.assetId(), asset.capturedAt(), asset.gameVersion(), detail);
                detailHolder[0] = detail;
                main.post(() -> {
                    params.setText(metadataSummary(detail));
                    renderClothingSection(asset, detail, clothingSection);
                    edit.setEnabled(true);
                    shareCard.setEnabled(true);
                });
            } catch (Exception error) {
                main.post(() -> params.setText("参数读取失败：" + message(error)));
            }
        });

        edit.setOnClickListener(v -> {
            if (detailHolder[0] != null) showMetadataEditor(asset, detailHolder[0], params, detailHolder);
        });

        shareCard.setOnClickListener(v -> {
            AssetDetail detail = detailHolder[0];
            NikkiSyncClient current = client;
            if (detail == null || current == null) {
                toast("照片参数尚未准备好");
                return;
            }
            shareCard.setEnabled(false);
            shareCard.setText("正在生成分享图…");
            io.execute(() -> {
                try {
                    ShareCardPayload payload = ShareCardPayloadBuilder.build(
                            asset.assetId(),
                            asset.capturedAt(),
                            asset.gameVersion(),
                            detail.metadataJson()
                    );
                    ShareCardExporter.export(this, current, asset, payload);
                    main.post(() -> {
                        shareCard.setEnabled(true);
                        shareCard.setText("生成分享图");
                        toast("分享图已保存到系统相册");
                    });
                } catch (Exception error) {
                    main.post(() -> {
                        shareCard.setEnabled(true);
                        shareCard.setText("生成分享图");
                        toast("分享图生成失败：" + message(error));
                    });
                }
            });
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
        return SavedMetadataText.summary(detail == null ? null : detail.metadataJson());
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
