package app.nikkisync.mobile.ui;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Size;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import app.nikkisync.mobile.R;
import app.nikkisync.mobile.storage.EditedVariantStore;
import app.nikkisync.mobile.storage.SavedPhotoGroups;
import app.nikkisync.mobile.storage.SavedPhotoStore;
import app.nikkisync.mobile.storage.SavedPhotoHealthStore;

import java.text.DateFormat;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class SavedPhotoAdapter extends RecyclerView.Adapter<RecyclerView.ViewHolder> {
    public interface Listener {
        void onOriginalClick(SavedPhotoStore.Record record);
        void onEditedClick(EditedVariantStore.Variant variant);
    }

    private static final int TYPE_HEADER = 0;
    private static final int TYPE_MEDIA = 1;

    private final Activity activity;
    private final Listener listener;
    private final List<Row> rows = new ArrayList<>();
    private final ExecutorService thumbnails = Executors.newFixedThreadPool(2);
    private final Handler main = new Handler(Looper.getMainLooper());
    private Map<String, SavedPhotoHealthStore.Entry> health = Map.of();

    public SavedPhotoAdapter(Activity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
    }

    public void setHealth(Map<String, SavedPhotoHealthStore.Entry> entries) {
        health = Map.copyOf(entries);
        notifyDataSetChanged();
    }

    public void setGroups(List<SavedPhotoGroups.Group> groups) {
        rows.clear();
        for (SavedPhotoGroups.Group group : groups) {
            rows.add(Row.header(group));
            for (SavedPhotoGroups.Member member : group.members()) rows.add(Row.media(group, member));
        }
        notifyDataSetChanged();
    }

    public boolean isHeader(int position) {
        return position >= 0 && position < rows.size() && rows.get(position).member == null;
    }

    public void shutdown() {
        thumbnails.shutdownNow();
    }

    @Override public int getItemCount() { return rows.size(); }

    @Override public int getItemViewType(int position) {
        return isHeader(position) ? TYPE_HEADER : TYPE_MEDIA;
    }

    @NonNull @Override public RecyclerView.ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        if (viewType == TYPE_HEADER) return new HeaderHolder(new HeaderView(activity));
        return new MediaHolder(new Cell(activity));
    }

    @Override public void onBindViewHolder(@NonNull RecyclerView.ViewHolder holder, int position) {
        Row row = rows.get(position);
        if (holder instanceof HeaderHolder header) {
            header.view.bind(row.group);
            return;
        }

        MediaHolder media = (MediaHolder) holder;
        media.cell.bind(row.member);
        media.cell.setOnClickListener(v -> {
            if (row.member.kind() == SavedPhotoGroups.MemberKind.ORIGINAL) {
                listener.onOriginalClick(row.member.original());
            } else {
                listener.onEditedClick(row.member.edited());
            }
        });
    }

    private static final class Row {
        final SavedPhotoGroups.Group group;
        final SavedPhotoGroups.Member member;

        Row(SavedPhotoGroups.Group group, SavedPhotoGroups.Member member) {
            this.group = group;
            this.member = member;
        }

        static Row header(SavedPhotoGroups.Group group) { return new Row(group, null); }
        static Row media(SavedPhotoGroups.Group group, SavedPhotoGroups.Member member) { return new Row(group, member); }
    }

    final class HeaderHolder extends RecyclerView.ViewHolder {
        final HeaderView view;
        HeaderHolder(HeaderView view) { super(view); this.view = view; }
    }

    final class MediaHolder extends RecyclerView.ViewHolder {
        final Cell cell;
        MediaHolder(Cell cell) { super(cell); this.cell = cell; }
    }

    final class HeaderView extends LinearLayout {
        final TextView title;
        final TextView count;

        HeaderView(Activity context) {
            super(context);
            setGravity(Gravity.CENTER_VERTICAL);
            setPadding(dp(10), dp(10), dp(10), dp(8));

            title = new TextView(context);
            title.setTextSize(15);
            title.setTextColor(context.getColor(R.color.text_primary));
            title.setTypeface(Typeface.DEFAULT_BOLD);
            addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

            count = new TextView(context);
            count.setTextSize(11);
            count.setTextColor(context.getColor(R.color.text_secondary));
            addView(count);
        }

        void bind(SavedPhotoGroups.Group group) {
            String label = groupDate(group);
            if (group.gameVersion() != null && !group.gameVersion().isBlank()) {
                label += " · " + group.gameVersion() + "版本";
            }
            title.setText(label);
            count.setText(group.members().size() + "张");
        }
    }

    final class Cell extends FrameLayout {
        final ImageView image;
        final TextView state;
        final TextView date;

        Cell(Activity context) {
            super(context);
            int gap = dp(3);
            setPadding(gap, gap, gap, gap);
            setMinimumHeight(dp(142));

            image = new ImageView(context);
            image.setScaleType(ImageView.ScaleType.CENTER_CROP);
            image.setBackgroundResource(R.drawable.bg_gallery_photo);
            image.setClipToOutline(true);
            addView(image, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(132)));

            state = chip("");
            FrameLayout.LayoutParams stateLp = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    Gravity.TOP | Gravity.START
            );
            stateLp.setMargins(dp(8), dp(8), 0, 0);
            addView(state, stateLp);

            date = chip("");
            date.setTextSize(9);
            FrameLayout.LayoutParams dateLp = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    Gravity.BOTTOM | Gravity.START
            );
            dateLp.setMargins(dp(8), 0, 0, dp(8));
            addView(date, dateLp);
        }

        void bind(SavedPhotoGroups.Member member) {
            if (member.kind() == SavedPhotoGroups.MemberKind.ORIGINAL) {
                SavedPhotoStore.Record record = member.original();
                String badge = record.hasMotion()
                        ? "LIVE"
                        : record.rotationDegrees() == 0 ? "原图" : "旋转 " + record.rotationDegrees() + "°";
                SavedPhotoHealthStore.Entry entry = health.get(record.uri());
                if (entry != null && entry.isMissing()) badge = "文件缺失";
                else if (record.hasMotion()) {
                    if (entry != null && entry.state() == SavedPhotoHealthStore.State.MOTION_MISSING) badge = "LIVE 不完整";
                    else if (entry != null && entry.state() == SavedPhotoHealthStore.State.MOTION_UNVERIFIED) badge = "LIVE 待核验";
                }
                state.setText(badge);
                date.setText(DateFormat.getDateInstance(DateFormat.SHORT).format(new Date(record.savedAt())));
            } else {
                state.setText("修图");
                date.setText(DateFormat.getDateInstance(DateFormat.SHORT).format(new Date(member.edited().linkedAt())));
            }

            image.setImageDrawable(null);
            image.setBackgroundResource(R.drawable.bg_gallery_photo);
            String expected = member.uri();
            image.setTag(expected);
            Uri uri = Uri.parse(expected);
            thumbnails.execute(() -> {
                try {
                    Bitmap bitmap = activity.getContentResolver().loadThumbnail(uri, new Size(420, 420), null);
                    main.post(() -> {
                        if (expected.equals(image.getTag())) image.setImageBitmap(bitmap);
                    });
                } catch (Exception ignored) {
                    main.post(() -> {
                        if (expected.equals(image.getTag())) {
                            image.setImageDrawable(null);
                            image.setBackgroundResource(R.drawable.bg_gallery_photo);
                        }
                    });
                }
            });
        }

        private TextView chip(String value) {
            TextView view = new TextView(activity);
            view.setText(value);
            view.setTextSize(10);
            view.setTypeface(Typeface.DEFAULT_BOLD);
            view.setTextColor(activity.getColor(R.color.text_primary));
            view.setPadding(dp(7), dp(4), dp(7), dp(4));
            view.setBackgroundResource(R.drawable.bg_glass_chip);
            return view;
        }
    }

    private String groupDate(SavedPhotoGroups.Group group) {
        if (group.capturedAt() != null && !group.capturedAt().isBlank()) {
            try {
                return DateFormat.getDateInstance(DateFormat.MEDIUM)
                        .format(Date.from(Instant.parse(group.capturedAt())));
            } catch (Exception ignored) {}
        }
        if (group.activityAt() > 0) {
            return DateFormat.getDateInstance(DateFormat.MEDIUM).format(new Date(group.activityAt()));
        }
        return "日期未知";
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
}