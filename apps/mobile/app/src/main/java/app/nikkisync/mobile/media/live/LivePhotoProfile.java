package app.nikkisync.mobile.media.live;

import java.util.Locale;

/** Container candidates, NOT a table of certified device models. SDK-only routes are not faked. */
public enum LivePhotoProfile {
    STANDARD("google_motion_v1", "标准 Motion Photo / Pixel", false, false),
    XIAOMI("xiaomi_compat", "小米 / Redmi / POCO 兼容", false, false),
    OPLUS("oplus_olive", "OPPO / 一加 / realme（实验）", true, false),
    VIVO_LEGACY_PAIR("vivo_legacy_pair", "vivo / iQOO 旧双文件（实验）", true, true),
    VIVO_SINGLE_XMP("vivo_single_xmp", "vivo / iQOO 新单文件（实验）", true, false),
    SAMSUNG_SEF("samsung_sef_legacy", "三星 SEF（实验）", true, false),
    HUAWEI_LEGACY("huawei_legacy_tail", "华为旧式尾标（实验，手动选择）", true, false);

    public final String id, label;
    public final boolean experimental, paired;
    LivePhotoProfile(String id,String label,boolean experimental,boolean paired) {
        this.id=id;this.label=label;this.experimental=experimental;this.paired=paired;
    }
    public static LivePhotoProfile fromId(String id) {
        for (LivePhotoProfile p : values()) if (p.id.equals(id)) return p;
        throw new IllegalArgumentException("未知 Live 封装配置：" + id);
    }
    public static LivePhotoProfile defaultFor(String manufacturer,String brand) {
        String v=((manufacturer==null?"":manufacturer)+" "+(brand==null?"":brand)).toLowerCase(Locale.ROOT);
        // Honor's official SDK and Huawei native HarmonyOS are separate deliverables.
        if(v.contains("honor") || v.contains("huawei")) return STANDARD;
        if(v.contains("xiaomi") || v.contains("redmi") || v.contains("poco")) return XIAOMI;
        if(v.contains("oppo") || v.contains("oneplus") || v.contains("realme")) return OPLUS;
        if(v.contains("vivo") || v.contains("iqoo")) return VIVO_LEGACY_PAIR;
        if(v.contains("samsung")) return SAMSUNG_SEF;
        return STANDARD;
    }
}