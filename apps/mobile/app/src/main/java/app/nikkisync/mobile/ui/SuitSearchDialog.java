package app.nikkisync.mobile.ui;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Typeface;
import android.os.Handler;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import app.nikkisync.mobile.R;
import app.nikkisync.mobile.media.ImageLoader;
import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.model.Models.ClothingSearchResponse;
import app.nikkisync.mobile.model.Models.ClothingSearchResult;
import app.nikkisync.mobile.model.Models.SuitSearchResponse;
import app.nikkisync.mobile.model.Models.SuitSearchResult;
import app.nikkisync.mobile.net.NikkiSyncClient;

import java.util.List;
import java.util.concurrent.ExecutorService;

public final class SuitSearchDialog {
    private static final int MODE_ALL = 0;
    private static final int MODE_SUIT = 1;
    private static final int MODE_CLOTHING = 2;

    public interface Listener {
        void onPhotoClick(AssetSummary asset);
    }

    private SuitSearchDialog() {}

    public static void show(
            Activity activity,
            NikkiSyncClient client,
            ImageLoader images,
            ExecutorService io,
            Handler main,
            Listener listener
    ) {
        Dialog dialog = new Dialog(activity);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(activity.getColor(R.color.app_background));
        root.setPadding(dp(activity, 14), dp(activity, 10), dp(activity, 14), dp(activity, 18));

        LinearLayout header = new LinearLayout(activity);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = label(activity, "搜索照片", 22, true, activity.getColor(R.color.text_primary));
        header.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button close = button(activity, "完成");
        close.setOnClickListener(v -> dialog.dismiss());
        header.addView(close);
        root.addView(header);

        TextView description = label(
                activity,
                "按套装或散件查找照片，直接查看它们在图库中的使用记录。",
                12,
                false,
                activity.getColor(R.color.text_secondary)
        );
        description.setPadding(dp(activity, 2), dp(activity, 6), dp(activity, 2), dp(activity, 10));
        root.addView(description);

        LinearLayout searchRow = new LinearLayout(activity);
        searchRow.setGravity(Gravity.CENTER_VERTICAL);
        searchRow.setPadding(dp(activity, 10), dp(activity, 4), dp(activity, 4), dp(activity, 4));
        searchRow.setBackgroundResource(R.drawable.bg_glass_card);

        EditText query = new EditText(activity);
        query.setSingleLine(true);
        query.setHint("套装或散件名称");
        query.setTextSize(15);
        query.setTextColor(activity.getColor(R.color.text_primary));
        query.setHintTextColor(activity.getColor(R.color.text_secondary));
        query.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        searchRow.addView(query, new LinearLayout.LayoutParams(0, dp(activity, 48), 1));

        Button search = button(activity, "搜索");
        searchRow.addView(search);
        root.addView(searchRow);

        LinearLayout modeRow = new LinearLayout(activity);
        modeRow.setGravity(Gravity.CENTER_VERTICAL);
        modeRow.setPadding(0, dp(activity, 8), 0, 0);
        Button allMode = button(activity, "全部");
        Button suitMode = button(activity, "套装");
        Button clothingMode = button(activity, "散件");
        modeRow.addView(allMode, new LinearLayout.LayoutParams(0, dp(activity, 38), 1));
        LinearLayout.LayoutParams suitModeLp = new LinearLayout.LayoutParams(0, dp(activity, 38), 1);
        suitModeLp.setMargins(dp(activity, 6), 0, dp(activity, 6), 0);
        modeRow.addView(suitMode, suitModeLp);
        modeRow.addView(clothingMode, new LinearLayout.LayoutParams(0, dp(activity, 38), 1));
        root.addView(modeRow);

        int[] searchMode = new int[]{MODE_ALL};
        styleModeButtons(modeRow, allMode);

        TextView recentLabel = label(activity, "最近搜索", 11, true, activity.getColor(R.color.text_secondary));
        recentLabel.setPadding(dp(activity, 2), dp(activity, 8), dp(activity, 2), dp(activity, 4));
        root.addView(recentLabel);

        HorizontalScrollView recentScroll = new HorizontalScrollView(activity);
        recentScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout recentRow = new LinearLayout(activity);
        recentRow.setOrientation(LinearLayout.HORIZONTAL);
        recentRow.setPadding(0, 0, dp(activity, 8), dp(activity, 4));
        recentScroll.addView(recentRow, new HorizontalScrollView.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        root.addView(recentScroll);

        TextView status = label(activity, "输入套装或散件名称开始搜索", 12, false, activity.getColor(R.color.text_secondary));
        status.setPadding(dp(activity, 4), dp(activity, 10), dp(activity, 4), dp(activity, 8));
        root.addView(status);

        ScrollView scroll = new ScrollView(activity);
        LinearLayout results = new LinearLayout(activity);
        results.setOrientation(LinearLayout.VERTICAL);
        results.setPadding(0, 0, 0, dp(activity, 24));
        scroll.addView(results, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        Runnable runSearch = () -> {
            String value = query.getText().toString().trim();
            if (value.isEmpty()) {
                status.setText(searchMode[0] == MODE_SUIT
                        ? "请输入套装名称"
                        : searchMode[0] == MODE_CLOTHING ? "请输入散件名称" : "请输入套装或散件名称");
                return;
            }
            int requestedMode = searchMode[0];
            search.setEnabled(false);
            status.setText("正在搜索“" + value + "”…");
            results.removeAllViews();
            io.execute(() -> {
                try {
                    SuitSearchResponse suitResponse = requestedMode == MODE_CLOTHING ? null : client.searchSuits(value);
                    ClothingSearchResponse clothingResponse = requestedMode == MODE_SUIT ? null : client.searchClothing(value);
                    main.post(() -> {
                        search.setEnabled(true);
                        SuitSearchHistory.record(activity, value);
                        renderRecentSearches(activity, recentLabel, recentScroll, recentRow, query, search);
                        renderSearchResults(
                                activity, client, images, suitResponse, clothingResponse,
                                requestedMode, results, status, listener
                        );
                    });
                } catch (Exception error) {
                    main.post(() -> {
                        search.setEnabled(true);
                        status.setText("搜索失败：" + message(error));
                    });
                }
            });
        };

        allMode.setOnClickListener(v -> {
            searchMode[0] = MODE_ALL;
            query.setHint("套装或散件名称");
            styleModeButtons(modeRow, allMode);
            if (!query.getText().toString().trim().isEmpty()) runSearch.run();
            else status.setText("输入套装或散件名称开始搜索");
        });
        suitMode.setOnClickListener(v -> {
            searchMode[0] = MODE_SUIT;
            query.setHint("套装名称");
            styleModeButtons(modeRow, suitMode);
            if (!query.getText().toString().trim().isEmpty()) runSearch.run();
            else status.setText("输入套装名称开始搜索");
        });
        clothingMode.setOnClickListener(v -> {
            searchMode[0] = MODE_CLOTHING;
            query.setHint("散件名称");
            styleModeButtons(modeRow, clothingMode);
            if (!query.getText().toString().trim().isEmpty()) runSearch.run();
            else status.setText("输入散件名称开始搜索");
        });

        search.setOnClickListener(v -> runSearch.run());
        query.setOnEditorActionListener((v, actionId, event) -> {
            runSearch.run();
            return true;
        });
        renderRecentSearches(activity, recentLabel, recentScroll, recentRow, query, search);

        dialog.setContentView(root);
        dialog.show();
        if (dialog.getWindow() != null) {
            dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
        }
        query.requestFocus();
    }

    private static void render(
            Activity activity,
            NikkiSyncClient client,
            ImageLoader images,
            SuitSearchResponse response,
            LinearLayout results,
            TextView status,
            Listener listener,
            Dialog dialog
    ) {
        results.removeAllViews();
        if (response.items().isEmpty()) {
            status.setText("没有找到包含该套装信息的照片");
            TextView empty = label(
                    activity,
                    "当前照片需要已经解析出套装归属。旧照片在字典重新丰富后也会进入搜索结果。",
                    13,
                    false,
                    activity.getColor(R.color.text_secondary)
            );
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(dp(activity, 24), dp(activity, 36), dp(activity, 24), dp(activity, 36));
            results.addView(empty);
            return;
        }

        int totalPhotos = 0;
        for (SuitSearchResult item : response.items()) totalPhotos += item.photoCount();
        status.setText("找到 " + response.items().size() + " 个套装结果 · " + totalPhotos + " 张照片");

        for (SuitSearchResult item : response.items()) {
            LinearLayout card = new LinearLayout(activity);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(activity, 14), dp(activity, 13), dp(activity, 14), dp(activity, 14));
            card.setBackgroundResource(R.drawable.bg_glass_card);
            LinearLayout.LayoutParams cardLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
            );
            cardLp.setMargins(0, 0, 0, dp(activity, 12));

            TextView name = label(activity, item.suitName(), 18, true, activity.getColor(R.color.text_primary));
            card.addView(name);

            String coverage = item.totalPartCount() == null
                    ? "已发现 " + item.observedPartCount() + " 个部件"
                    : "已发现 " + item.observedPartCount() + " / " + item.totalPartCount() + " 个部件";
            TextView summary = label(
                    activity,
                    coverage + " · " + item.photoCount() + " 张照片",
                    12,
                    false,
                    activity.getColor(R.color.text_secondary)
            );
            summary.setPadding(0, dp(activity, 3), 0, dp(activity, 5));
            card.addView(summary);

            if (item.totalPartCount() != null && item.totalPartCount() > 0) {
                int totalParts = item.totalPartCount();
                int observedParts = Math.max(0, Math.min(item.observedPartCount(), totalParts));
                int percentage = Math.round(observedParts * 100f / totalParts);

                TextView coverageLabel = label(
                        activity,
                        "图库覆盖 " + percentage + "%",
                        11,
                        true,
                        activity.getColor(R.color.text_secondary)
                );
                coverageLabel.setPadding(0, 0, 0, dp(activity, 4));
                card.addView(coverageLabel);

                LinearLayout coverageTrack = new LinearLayout(activity);
                coverageTrack.setOrientation(LinearLayout.HORIZONTAL);
                coverageTrack.setBackgroundResource(R.drawable.bg_suit_coverage_track);

                if (observedParts > 0) {
                    android.view.View fill = new android.view.View(activity);
                    fill.setBackgroundResource(R.drawable.bg_suit_coverage_fill);
                    coverageTrack.addView(fill, new LinearLayout.LayoutParams(0, dp(activity, 6), observedParts));
                }
                int remainingParts = totalParts - observedParts;
                if (remainingParts > 0) {
                    coverageTrack.addView(new android.view.View(activity), new LinearLayout.LayoutParams(0, dp(activity, 6), remainingParts));
                }

                LinearLayout.LayoutParams coverageLp = new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        dp(activity, 6)
                );
                coverageLp.setMargins(0, 0, 0, dp(activity, 10));
                card.addView(coverageTrack, coverageLp);
            }

            card.addView(SuitSearchGrid.create(
                    activity,
                    client,
                    images,
                    item,
                    listener::onPhotoClick
            ));

            results.addView(card, cardLp);
        }
    }

    private static void renderRecentSearches(
            Activity activity,
            TextView recentLabel,
            HorizontalScrollView recentScroll,
            LinearLayout recentRow,
            EditText query,
            Button search
    ) {
        List<String> recent = SuitSearchHistory.load(activity);
        boolean visible = !recent.isEmpty();
        recentLabel.setVisibility(visible ? android.view.View.VISIBLE : android.view.View.GONE);
        recentScroll.setVisibility(visible ? android.view.View.VISIBLE : android.view.View.GONE);
        recentRow.removeAllViews();
        for (String value : recent) {
            Button chip = button(activity, value);
            chip.setTextSize(11);
            chip.setOnClickListener(v -> {
                query.setText(value);
                query.setSelection(value.length());
                search.performClick();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    dp(activity, 36)
            );
            lp.rightMargin = dp(activity, 6);
            recentRow.addView(chip, lp);
        }
    }

    private static TextView label(Activity activity, String value, int sp, boolean bold, int color) {
        TextView view = new TextView(activity);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }

    private static Button button(Activity activity, String value) {
        Button button = new Button(activity);
        button.setText(value);
        button.setTextSize(12);
        button.setAllCaps(false);
        button.setTextColor(activity.getColor(R.color.text_primary));
        button.setBackgroundResource(R.drawable.bg_glass_chip);
        button.setMinHeight(dp(activity, 38));
        button.setMinimumHeight(dp(activity, 38));
        return button;
    }

    private static int dp(Activity activity, int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }

    private static String message(Throwable error) {
        return error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
    }
}
