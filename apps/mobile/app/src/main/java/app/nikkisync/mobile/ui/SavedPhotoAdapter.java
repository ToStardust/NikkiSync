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
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import app.nikkisync.mobile.R;
import app.nikkisync.mobile.storage.SavedPhotoStore;

import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class SavedPhotoAdapter extends RecyclerView.Adapter<SavedPhotoAdapter.Holder> {
    public interface Listener {
        void onClick(SavedPhotoStore.Record record);
    }

    private final Activity activity;
    private final Listener listener;
    private final List<SavedPhotoStore.Record> items = new ArrayList<>();
    private final ExecutorService thumbnails = Executors.newFixedThreadPool(2);
    private final Handler main = new Handler(Looper.getMainLooper());

    public SavedPhotoAdapter(Activity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
    }

    public void setItems(List<SavedPhotoStore.Record> next) {
        items.clear();
        items.addAll(next);
        notifyDataSetChanged();
    }

    public void shutdown() {
        thumbnails.shutdownNow();
    }

    @Override public int getItemCount() { return items.size(); }

    @NonNull @Override public Holder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        return new Holder(new Cell(activity));
    }

    @Override public void onBindViewHolder(@NonNull Holder holder, int position) {
        SavedPhotoStore.Record record = items.get(position);
        holder.cell.bind(record);
        holder.cell.setOnClickListener(v -> listener.onClick(record));
    }

    final class Holder extends RecyclerView.ViewHolder {
        final Cell cell;
        Holder(Cell cell) { super(cell); this.cell = cell; }
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

        void bind(SavedPhotoStore.Record record) {
            String badge = record.hasMotion() ? "LIVE" : record.rotationDegrees() == 0 ? "原图" : "旋转 " + record.rotationDegrees() + "°";
            state.setText(badge);
            date.setText(DateFormat.getDateInstance(DateFormat.SHORT).format(new Date(record.savedAt())));

            image.setImageDrawable(null);
            image.setBackgroundResource(R.drawable.bg_gallery_photo);
            String expected = record.uri();
            image.setTag(expected);
            Uri uri = record.mediaUri();
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

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
}
