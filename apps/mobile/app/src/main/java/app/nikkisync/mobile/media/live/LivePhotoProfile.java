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
    public String guidance() {
        return switch(this) {
            case STANDARD -> "标准单文件 Motion Photo；相册是否识别取决于相册应用及版本，不能由封装校验推断播放通过。";
            case XIAOMI -> "标准单文件加小米兼容字段；历史成功只覆盖当时单台设备，当前机型仍需检查动态、声音及重新打开后的播放。";
            case OPLUS -> "Oplus 单文件实验格式；OPPO、一加、realme 的系统、地区和相册需分别测试，不能相互继承兼容结论。";
            case VIVO_LEGACY_PAIR -> "旧式双文件实验格式，会同时保存封面与视频。请保留两者；若相册不识别，可尝试新单文件候选，不能仅按 Android 版本自动判断。";
            case VIVO_SINGLE_XMP -> "新单文件实验候选；适用边界尚未实机验证。旧双文件不识别时可手动尝试，本配置不代表所有新 vivo / iQOO 已支持。";
            case SAMSUNG_SEF -> "三星旧式 SEF 实验格式；尚未覆盖所有现代格式变体，不能保证新系统相册识别。";
            case HUAWEI_LEGACY -> "华为旧式尾标实验格式，仅用于 Android 兼容环境的手动测试；不是原生鸿蒙相册方案。";
        };
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
