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
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import app.nikkisync.mobile.R;
import app.nikkisync.mobile.media.ImageLoader;
import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.model.Models.SuitSearchPart;
import app.nikkisync.mobile.model.Models.SuitSearchPhoto;
import app.nikkisync.mobile.model.Models.SuitSearchResponse;
import app.nikkisync.mobile.model.Models.SuitSearchResult;
import app.nikkisync.mobile.net.NikkiSyncClient;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;

public final class SuitSearchDialog {
    public interface Listener {
        void onPhotoClick(AssetSummary asset);
    }

    private static final int MAX_PHOTOS_PER_SUIT = 40;

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
                "按套装查找照片，并显示每张照片里出现的该套装部件。",
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
        query.setHint("套装名称");
        query.setTextSize(15);
        query.setTextColor(activity.getColor(R.color.text_primary));
        query.setHintTextColor(activity.getColor(R.color.text_secondary));
        query.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        searchRow.addView(query, new LinearLayout.LayoutParams(0, dp(activity, 48), 1));

        Button search = button(activity, "搜索");
        searchRow.addView(search);
        root.addView(searchRow);

        TextView status = label(activity, "输入套装名称开始搜索", 12, false, activity.getColor(R.color.text_secondary));
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
                status.setText("请输入套装名称");
                return;
            }
            search.setEnabled(false);
            status.setText("正在搜索“" + value + "”…");
            results.removeAllViews();
            io.execute(() -> {
                try {
                    SuitSearchResponse response = client.searchSuits(value);
                    main.post(() -> {
                        search.setEnabled(true);
                        render(activity, client, images, response, results, status, listener, dialog);
                    });
                } catch (Exception error) {
                    main.post(() -> {
                        search.setEnabled(true);
                        status.setText("搜索失败：" + message(error));
                    });
                }
            });
        };

        search.setOnClickListener(v -> runSearch.run());
        query.setOnEditorActionListener((v, actionId, event) -> {
            runSearch.run();
            return true;
        });

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
            summary.setPadding(0, dp(activity, 3), 0, dp(activity, 9));
            card.addView(summary);

            card.addView(SuitSearchGrid.create(
                    activity,
                    client,
                    images,
                    item,
                    asset -> {
                        dialog.dismiss();
                        listener.onPhotoClick(asset);
                    }
            ));

            results.addView(card, cardLp);
        }
    }

    private static LinearLayout photoRow(
            Activity activity,
            NikkiSyncClient client,
            ImageLoader images,
            SuitSearchPhoto photo,
            Listener listener,
            Dialog dialog
    ) {
        LinearLayout row = new LinearLayout(activity);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(activity, 7), dp(activity, 7), dp(activity, 7), dp(activity, 7));
        row.setBackgroundResource(R.drawable.bg_glass_chip);

        LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        rowLp.setMargins(0, 0, 0, dp(activity, 7));
        row.setLayoutParams(rowLp);

        ImageView image = new ImageView(activity);
        image.setScaleType(ImageView.ScaleType.CENTER_CROP);
        image.setBackgroundResource(R.drawable.bg_gallery_photo);
        image.setClipToOutline(true);
        row.addView(image, new LinearLayout.LayoutParams(dp(activity, 88), dp(activity, 88)));
        images.load(client, photo.asset(), image);

        LinearLayout labels = new LinearLayout(activity);
        labels.setOrientation(LinearLayout.VERTICAL);
        labels.setPadding(dp(activity, 10), 0, dp(activity, 2), 0);

        TextView parts = label(
                activity,
                matchedPartText(photo.matchedParts()),
                13,
                true,
                activity.getColor(R.color.text_primary)
        );
        labels.addView(parts);

        String capturedAt = photo.asset().capturedAt();
        TextView detail = label(
                activity,
                capturedAt == null || capturedAt.isBlank() ? "点击查看照片详情" : capturedAt,
                11,
                false,
                activity.getColor(R.color.text_secondary)
        );
        detail.setPadding(0, dp(activity, 4), 0, 0);
        labels.addView(detail);

        row.addView(labels, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        row.setOnClickListener(v -> {
            dialog.dismiss();
            listener.onPhotoClick(photo.asset());
        });
        return row;
    }

    private static String matchedPartText(List<SuitSearchPart> parts) {
        List<String> labels = new ArrayList<>();
        for (SuitSearchPart part : parts) {
            String value = categoryLabel(part.category());
            if (value == null || value.isBlank()) value = part.name();
            if (value == null || value.isBlank()) value = "部件 " + part.clothingId();
            if (!labels.contains(value)) labels.add(value);
        }
        if (labels.isEmpty()) return "命中套装部件";
        String joined = labels.size() <= 3
                ? String.join(" · ", labels)
                : String.join(" · ", labels.subList(0, 3)) + " +" + (labels.size() - 3);
        return "命中：" + joined;
    }

    private static String categoryLabel(String category) {
        if (category == null) return "";
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
            default -> category;
        };
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
