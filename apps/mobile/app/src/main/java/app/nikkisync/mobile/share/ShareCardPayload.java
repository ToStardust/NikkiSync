package app.nikkisync.mobile.share;

import java.util.List;

public record ShareCardPayload(
        String assetId,
        String capturedAt,
        String gameVersion,
        List<Item> outfitItems,
        List<Item> cameraItems,
        List<Item> effectItems,
        app.nikkisync.mobile.storage.ExportWatermarkStore.Branding branding
) {
    public ShareCardPayload(String id,String date,String version,List<Item> outfit,List<Item> camera,List<Item> effects){
        this(id,date,version,outfit,camera,effects,new app.nikkisync.mobile.storage.ExportWatermarkStore.Branding("大喵相机","MomoCamera"));
    }
    public ShareCardPayload withBranding(app.nikkisync.mobile.storage.ExportWatermarkStore.Branding value){return new ShareCardPayload(assetId,capturedAt,gameVersion,outfitItems,cameraItems,effectItems,value);}
    public ShareCardPayload {
        outfitItems = List.copyOf(outfitItems == null ? List.of() : outfitItems);
        cameraItems = List.copyOf(cameraItems == null ? List.of() : cameraItems);
        effectItems = List.copyOf(effectItems == null ? List.of() : effectItems);
    }

    public record Item(String label, String value, String clothingId) {
        public Item(String label, String value) { this(label, value, ""); }
        public Item {
            label = label == null ? "" : label.trim();
            value = value == null ? "" : value.trim();
            clothingId = clothingId == null ? "" : clothingId.trim();
        }
    }
}
