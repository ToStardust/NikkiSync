package app.nikkisync.mobile.ui;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

import app.nikkisync.mobile.media.ImageLoader;
import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.net.NikkiSyncClient;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Supplier;

public final class GalleryAdapter extends BaseAdapter {
    private final Context context;
    private final ImageLoader images;
    private final Supplier<NikkiSyncClient> client;
    private final List<AssetSummary> items = new ArrayList<>();
    private final Set<String> selected = new HashSet<>();

    public GalleryAdapter(Context context, ImageLoader images, Supplier<NikkiSyncClient> client) {
        this.context = context; this.images = images; this.client = client;
    }

    public void setItems(List<AssetSummary> next) {
        items.clear(); items.addAll(next);
        Set<String> available = new HashSet<>();
        for (AssetSummary item : next) available.add(item.assetId());
        selected.retainAll(available);
        notifyDataSetChanged();
    }

    public AssetSummary item(int position) { return items.get(position); }
    public int selectedCount() { return selected.size(); }
    public boolean hasSelection() { return !selected.isEmpty(); }
    public boolean isSelected(AssetSummary asset) { return selected.contains(asset.assetId()); }

    public boolean toggle(AssetSummary asset) {
        if (!selected.add(asset.assetId())) selected.remove(asset.assetId());
        notifyDataSetChanged(); return selected.contains(asset.assetId());
    }

    public List<AssetSummary> selectedItems() {
        List<AssetSummary> result = new ArrayList<>();
        for (AssetSummary item : items) if (selected.contains(item.assetId())) result.add(item);
        return result;
    }

    public void clearSelection() { selected.clear(); notifyDataSetChanged(); }

    @Override public int getCount() { return items.size(); }
    @Override public AssetSummary getItem(int position) { return items.get(position); }
    @Override public long getItemId(int position) { return position; }

    @Override public View getView(int position, View convertView, ViewGroup parent) {
        return viewForAsset(items.get(position), convertView, parent);
    }

    /** Reusable cell factory for the sectioned M2.3.1 gallery without duplicating thumbnail behavior. */
    public View viewForAsset(AssetSummary asset, View convertView, ViewGroup parent) {
        Cell cell = convertView instanceof Cell ? (Cell) convertView : new Cell(context);
        cell.bind(asset, selected.contains(asset.assetId()));
        NikkiSyncClient current = client.get();
        if (current != null) images.load(current, asset, cell.image);
        return cell;
    }

    private final class Cell extends FrameLayout {
        final ImageView image;
        final TextView live;
        final TextView check;

        Cell(Context context) {
            super(context);
            int gap = dp(2);
            setPadding(gap, gap, gap, gap);
            image = new ImageView(context);
            image.setScaleType(ImageView.ScaleType.CENTER_CROP);
            image.setBackgroundColor(Color.rgb(232, 228, 224));
            addView(image, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(132)));

            live = badge("LIVE");
            FrameLayout.LayoutParams lpLive = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.START);
            lpLive.setMargins(dp(8), dp(8), 0, 0); addView(live, lpLive);

            check = badge("✓");
            check.setTextSize(15); check.setGravity(Gravity.CENTER);
            FrameLayout.LayoutParams lpCheck = new FrameLayout.LayoutParams(dp(30), dp(30), Gravity.TOP | Gravity.END);
            lpCheck.setMargins(0, dp(8), dp(8), 0); addView(check, lpCheck);
        }

        void bind(AssetSummary asset, boolean isSelected) {
            live.setVisibility(asset.hasMotion() ? VISIBLE : GONE);
            check.setVisibility(isSelected ? VISIBLE : GONE);
            setAlpha(isSelected ? 0.72f : 1f);
        }

        private TextView badge(String text) {
            TextView view = new TextView(context);
            view.setText(text); view.setTextColor(Color.WHITE); view.setTextSize(10); view.setTypeface(Typeface.DEFAULT_BOLD);
            view.setPadding(dp(7), dp(3), dp(7), dp(3));
            GradientDrawable background = new GradientDrawable();
            background.setColor(0xB8000000); background.setCornerRadius(dp(10)); view.setBackground(background);
            return view;
        }
    }

    private int dp(int value) { return Math.round(value * context.getResources().getDisplayMetrics().density); }
}
