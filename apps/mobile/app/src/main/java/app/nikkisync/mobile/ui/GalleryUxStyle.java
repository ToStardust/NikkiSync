package app.nikkisync.mobile.ui;

import android.content.Context;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;

import app.nikkisync.mobile.R;

/**
 * Shared styling helpers for the M2.3.2 gallery liquid-glass refresh.
 * Keeps GalleryAdapter focused on binding data while visual constants stay centralized.
 */
public final class GalleryUxStyle {
    private GalleryUxStyle() {}

    public static Drawable glassCard(Context context) {
        return context.getDrawable(R.drawable.bg_glass_card);
    }

    public static Drawable glassChip(Context context) {
        return context.getDrawable(R.drawable.bg_glass_chip);
    }

    public static Drawable selectedOverlay(Context context) {
        return context.getDrawable(R.drawable.bg_selected_glass);
    }

    public static GradientDrawable fallbackRound(int color, float radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        return drawable;
    }
}
