package app.nikkisync.mobile.storage;

import app.nikkisync.mobile.ui.RotationDegrees;

public final class RotationStore {
    public interface Backend {
        int getInt(String key, int fallback);
        void putInt(String key, int value);
        void remove(String key);
    }

    private final Backend backend;

    public RotationStore(Backend backend) {
        if (backend == null) throw new IllegalArgumentException("backend is required");
        this.backend = backend;
    }

    public int get(String assetId) {
        return RotationDegrees.sanitize(backend.getInt(assetId, 0));
    }

    public void set(String assetId, int degrees) {
        if (!RotationDegrees.isValid(degrees)) {
            throw new IllegalArgumentException("rotation must be 0, 90, 180, or 270 degrees");
        }
        if (degrees == 0) backend.remove(assetId);
        else backend.putInt(assetId, degrees);
    }
}
