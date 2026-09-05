package app.nikkisync.mobile.ui;

import app.nikkisync.mobile.model.Models.AssetSummary;

import java.util.List;

public final class ViewerSession {
    private final List<AssetSummary> items;
    private int index;

    private ViewerSession(List<AssetSummary> items, int index) {
        this.items = List.copyOf(items);
        this.index = index;
    }

    public static ViewerSession fromGallery(List<AssetSummary> gallery, String selectedAssetId) {
        for (GameVersionGroups.Group group : GameVersionGroups.group(gallery)) {
            List<AssetSummary> groupItems = group.items();
            for (int i = 0; i < groupItems.size(); i++) {
                if (groupItems.get(i).assetId().equals(selectedAssetId)) return new ViewerSession(groupItems, i);
            }
        }
        throw new IllegalArgumentException("Selected asset is not present in the gallery");
    }

    public List<AssetSummary> items() { return items; }
    public AssetSummary current() { return items.get(index); }
    public int position() { return index; }
    public int size() { return items.size(); }
    public boolean hasPrevious() { return index > 0; }
    public boolean hasNext() { return index + 1 < items.size(); }

    public boolean movePrevious() {
        if (!hasPrevious()) return false;
        index--;
        return true;
    }

    public boolean moveNext() {
        if (!hasNext()) return false;
        index++;
        return true;
    }
}
