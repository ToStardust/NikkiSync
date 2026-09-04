package app.nikkisync.mobile.ui;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import app.nikkisync.mobile.R;
import app.nikkisync.mobile.media.ImageLoader;
import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.net.NikkiSyncClient;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Supplier;

public final class GalleryAdapter extends RecyclerView.Adapter<RecyclerView.ViewHolder> {
    public interface Listener {
        void onPhotoClick(AssetSummary asset);
        boolean onPhotoLongClick(AssetSummary asset);
    }

    private static final int TYPE_HEADER = 0;
    private static final int TYPE_PHOTO = 1;

    private final Context context;
    private final ImageLoader images;
    private final Supplier<NikkiSyncClient> client;
    private final Listener listener;
    private final List<Row> rows = new ArrayList<>();
    private final List<AssetSummary> items = new ArrayList<>();
    private final Set<String> selected = new HashSet<>();

    public GalleryAdapter(Context context, ImageLoader images, Supplier<NikkiSyncClient> client, Listener listener) {
        this.context = context;
        this.images = images;
        this.client = client;
        this.listener = listener;
    }

    public void setItems(List<AssetSummary> next) {
        items.clear();
        items.addAll(next);
        rows.clear();
        for (GameVersionGroups.Group group : GameVersionGroups.group(next)) {
            rows.add(Row.header(group));
            for (AssetSummary asset : group.items()) rows.add(Row.photo(asset));
        }
        Set<String> available = new HashSet<>();
        for (AssetSummary item : next) available.add(item.assetId());
        selected.retainAll(available);
        notifyDataSetChanged();
    }

    public boolean isHeader(int position) {
        return position >= 0 && position < rows.size() && rows.get(position).group != null;
    }

    public int selectedCount() { return selected.size(); }
    public boolean hasSelection() { return !selected.isEmpty(); }

    public boolean toggle(AssetSummary asset) {
        if (!selected.add(asset.assetId())) selected.remove(asset.assetId());
        notifyDataSetChanged();
        return selected.contains(asset.assetId());
    }

    public List<AssetSummary> selectedItems() {
        List<AssetSummary> result = new ArrayList<>();
        for (AssetSummary item : items) if (selected.contains(item.assetId())) result.add(item);
        return result;
    }

    public void clearSelection() {
        selected.clear();
        notifyDataSetChanged();
    }

    @Override public int getItemCount() { return rows.size(); }

    @Override public int getItemViewType(int position) {
        return isHeader(position) ? TYPE_HEADER : TYPE_PHOTO;
    }

    @NonNull @Override public RecyclerView.ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        if (viewType == TYPE_HEADER) return new HeaderHolder(new HeaderView(context));
        return new PhotoHolder(new Cell(context));
    }

    @Override public void onBindViewHolder(@NonNull RecyclerView.ViewHolder holder, int position) {
        Row row = rows.get(position);
        if (holder instanceof HeaderHolder header) {
            header.view.bind(row.group);
            return;
        }
        PhotoHolder photo = (PhotoHolder) holder;
        AssetSummary asset = row.asset;
        photo.cell.bind(asset, selected.contains(asset.assetId()));
        NikkiSyncClient current = client.get();
        if (current != null) images.load(current, asset, photo.cell.image);
        photo.cell.setOnClickListener(v -> listener.onPhotoClick(asset));
        photo.cell.setOnLongClickListener(v -> listener.onPhotoLongClick(asset));
    }

    private static final class Row {
        final GameVersionGroups.Group group;
        final AssetSummary asset;

        private Row(GameVersionGroups.Group group, AssetSummary asset) {
            this.group = group;
            this.asset = asset;
        }

        static Row header(GameVersionGroups.Group group) { return new Row(group, null); }
        static Row photo(AssetSummary asset) { return new Row(null, asset); }
    }

    private static final class HeaderHolder extends RecyclerView.ViewHolder {
        final HeaderView view;
        HeaderHolder(HeaderView view) { super(view); this.view = view; }
    }

    private static final class PhotoHolder extends RecyclerView.ViewHolder {
        final Cell cell;
        PhotoHolder(Cell cell) { super(cell); this.cell = cell; }
    }

    private final class HeaderView extends LinearLayout {
        private final TextView title;
        private final TextView count;
        private final TextView provenance;

        HeaderView(Context context) {
            super(context);
            setOrientation(VERTICAL);
            setPadding(dp(4), dp(18), dp(4), dp(9));

            LinearLayout top = new LinearLayout(context);
            top.setGravity(Gravity.CENTER_VERTICAL);
            title = label(17, true, context.getColor(R.color.text_primary));
            count = label(12, true, context.getColor(R.color.text_secondary));
            top.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            top.addView(count);
            addView(top, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

            provenance = label(11, false, context.getColor(R.color.text_secondary));
            provenance.setPadding(0, dp(2), 0, 0);
            addView(provenance, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }

        void bind(GameVersionGroups.Group group) {
            title.setText(group.version() == null ? "版本未知" : group.version() + " 版本");
            count.setText(group.items().size() + " 张");
            provenance.setText(group.inferred() ? "自动推测" : "");
            provenance.setVisibility(group.inferred() ? VISIBLE : GONE);
        }

        private TextView label(int sp, boolean bold, int color) {
            TextView view = new TextView(context);
            view.setTextSize(sp);
            view.setTextColor(color);
            if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
            return view;
        }
    }

    private final class Cell extends FrameLayout {
        final ImageView image;
        final TextView live;
        final TextView check;

        Cell(Context context) {
            super(context);
            int gap = dp(2);
            setPadding(gap, gap, gap, gap);
            setMinimumHeight(dp(136));
            image = new ImageView(context);
            image.setScaleType(ImageView.ScaleType.CENTER_CROP);
            image.setBackgroundColor(Color.rgb(232, 228, 224));
            addView(image, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(132)));

            live = badge("LIVE");
            FrameLayout.LayoutParams lpLive = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.START);
            lpLive.setMargins(dp(8), dp(8), 0, 0);
            addView(live, lpLive);

            check = badge("✓");
            check.setTextSize(15);
            check.setGravity(Gravity.CENTER);
            FrameLayout.LayoutParams lpCheck = new FrameLayout.LayoutParams(dp(30), dp(30), Gravity.TOP | Gravity.END);
            lpCheck.setMargins(0, dp(8), dp(8), 0);
            addView(check, lpCheck);
        }

        void bind(AssetSummary asset, boolean isSelected) {
            live.setVisibility(asset.hasMotion() ? VISIBLE : GONE);
            check.setVisibility(isSelected ? VISIBLE : GONE);
            setAlpha(isSelected ? 0.72f : 1f);
        }

        private TextView badge(String text) {
            TextView view = new TextView(context);
            view.setText(text);
            view.setTextColor(Color.WHITE);
            view.setTextSize(10);
            view.setTypeface(Typeface.DEFAULT_BOLD);
            view.setPadding(dp(7), dp(3), dp(7), dp(3));
            GradientDrawable background = new GradientDrawable();
            background.setColor(0xB8000000);
            background.setCornerRadius(dp(10));
            view.setBackground(background);
            return view;
        }
    }

    private int dp(int value) { return Math.round(value * context.getResources().getDisplayMetrics().density); }
}
