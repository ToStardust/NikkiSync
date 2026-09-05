package app.nikkisync.mobile.storage;

import android.content.Context;
import android.content.SharedPreferences;

public final class SharedPreferencesRotationBackend implements RotationStore.Backend {
    private static final String PREFS_NAME = "nikkisync.presentation";
    private final SharedPreferences preferences;

    public SharedPreferencesRotationBackend(Context context) {
        preferences = context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    @Override public int getInt(String key, int fallback) {
        return preferences.getInt(key, fallback);
    }

    @Override public void putInt(String key, int value) {
        preferences.edit().putInt(key, value).apply();
    }

    @Override public void remove(String key) {
        preferences.edit().remove(key).apply();
    }
}
