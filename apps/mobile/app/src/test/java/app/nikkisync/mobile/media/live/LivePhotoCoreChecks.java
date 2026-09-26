package app.nikkisync.mobile.media.live;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

/** Real JVM behavior checks; synthetic containers do not imply Android decoder/device acceptance. */
public final class LivePhotoCoreChecks {
    private static int checks;
    private static final String ID = "1760000000000" + "abcdef0" + "00000000";
    private static final byte[] VIDEO = new byte[]{
        0,0,0,20,'f','t','y','p','i','s','o','m',0,0,0,0,'i','s','o','m',
        0,0,0,8,'m','o','o','v',0,0,0,12,'m','d','a','t',1,2,3,4
    };
    @FunctionalInterface private interface Checked { void run() throws Exception; }

    public static void main(String[] args) throws Exception {
        checks = 0;
        eq(270, QuarterTurn.normalize(-90), "left turn");
        eq(0, QuarterTurn.normalize(720), "full cycles");
        eq(90, QuarterTurn.normalize(-270), "negative normalization");
        rejects(() -> QuarterTurn.normalize(45), "only quarter turns");
        for (int d : new int[]{0,90,180,270}) {
            eq(d % 180 == 0 ? 320 : 180, QuarterTurn.outputWidth(320,180,d), "width " + d);
            eq(d % 180 == 0 ? 180 : 320, QuarterTurn.outputHeight(320,180,d), "height " + d);
            eq(Math.floorMod(-d,360), QuarterTurn.counterClockwise(d), "Media3 sign " + d);
        }
        eq(LivePhotoProfile.XIAOMI, LivePhotoProfile.defaultFor("Xiaomi", "POCO"), "Xiaomi baseline");
        eq(LivePhotoProfile.OPLUS, LivePhotoProfile.defaultFor("OnePlus", "oneplus"), "Oplus route");
        eq(LivePhotoProfile.VIVO_LEGACY_PAIR, LivePhotoProfile.defaultFor("vivo", "iQOO"), "legacy candidate");
        eq(LivePhotoProfile.STANDARD, LivePhotoProfile.defaultFor("HONOR", "HONOR"), "Honor is not Huawei");
        eq(LivePhotoProfile.STANDARD, LivePhotoProfile.defaultFor("HUAWEI", "HUAWEI"), "private tail is opt-in");
        eq(LivePhotoProfile.STANDARD, LivePhotoProfile.defaultFor(null, null), "unknown is unverified standard");
        rejects(() -> LivePhotoProfile.fromId("invented-sdk"), "unknown profile is rejected");

        byte[] foreign = ("<x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>"
            + "<rdf:Description xmlns:dc='http://purl.org/dc/elements/1.1/' xmlns:C='http://ns.google.com/photos/1.0/camera/' C:MotionPhoto='1' C:MicroVideoOffset='999'>"
            + "<dc:description>retain unrelated metadata</dc:description></rdf:Description></rdf:RDF></x:xmpmeta>").getBytes(StandardCharsets.UTF_8);
        byte[] newXmp = MotionXmp.create(LivePhotoProfile.XIAOMI, VIDEO.length, 500000, 0);
        byte[] input = jpeg(foreign, null);
        byte[] replaced = JpegSegments.rewrite(input, newXmp, null);
        eq(replaced.length, JpegSegments.endOffset(replaced), "no orphan APP1 marker");
        eq((long)VIDEO.length, MotionXmp.videoLength(JpegSegments.xmp(replaced)), "new offset replaces stale offset");
        ok(new String(JpegSegments.xmp(replaced), StandardCharsets.UTF_8).contains("retain unrelated metadata"), "foreign XMP preserved");
        ok(indexOf(replaced, "ICC_PROFILE".getBytes(StandardCharsets.US_ASCII)) >= 0, "ICC preserved");
        rejects(() -> JpegSegments.rewrite(new byte[]{(byte)255,(byte)216,(byte)255,(byte)225,0,30,1}, newXmp, null), "truncated segment");
        rejects(() -> JpegSegments.rewrite(jpeg("<broken".getBytes(StandardCharsets.UTF_8), null), newXmp, null), "malformed XMP not discarded");
        rejects(() -> MotionXmp.merge("<!DOCTYPE a [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><a/>".getBytes(StandardCharsets.UTF_8),newXmp), "XML external entities rejected");
        rejects(() -> JpegSegments.rewrite(jpeg(null,null),new byte[70000],null), "APP1 size bounded");
        byte[] multi = MotionContainer.mpfSegment(100);
        // MPF number-of-images value in the second IFD entry.
        ByteBuffer.wrap(multi).order(ByteOrder.LITTLE_ENDIAN).putInt(38,2);
        rejects(() -> JpegSegments.rewrite(jpeg(null,multi),newXmp,null), "multi-image MPF fail-safe");
        byte[] malicious = MotionContainer.mpfSegment(100);
        ByteBuffer.wrap(malicious).order(ByteOrder.LITTLE_ENDIAN).putInt(12,0x7fffffff);
        rejects(() -> JpegSegments.mpfPrimarySize(jpeg(null,malicious)), "MPF IFD offset bounded before reading");

        File dir = Files.createTempDirectory("livephoto-behavior-").toFile();
        try {
            File jpg = new File(dir,"input.jpg"), mp4 = new File(dir,"input.mp4");
            Files.write(jpg.toPath(),jpeg(foreign,null));
            Files.write(mp4.toPath(),VIDEO);
            byte[] original = Files.readAllBytes(jpg.toPath());
            var options = new MotionContainer.Options(500000,15,30,1000000,ID,"fixture-model");
            eq(28, ID.length(), "vivo ID length");
            for (LivePhotoProfile profile : LivePhotoProfile.values()) {
                File out = new File(dir,profile.id); ok(out.mkdir(),"output directory " + profile.id);
                MotionContainer.Product product = MotionContainer.write(profile,jpg,mp4,out,options);
                MotionContainerVerifier.verify(profile,product,mp4,options);
                checks++;
                eq(profile.paired ? 1 : 0, product.companions().size(), "complete resource result " + profile.id);
                ok(Arrays.equals(original,Files.readAllBytes(jpg.toPath())),"source image unchanged " + profile.id);
                ok(Arrays.equals(VIDEO,Files.readAllBytes(mp4.toPath())),"source video unchanged " + profile.id);
                if (profile == LivePhotoProfile.OPLUS) {
                    byte[] output = Files.readAllBytes(product.primary().toPath());
                    eq((long)JpegSegments.endOffset(output), JpegSegments.mpfPrimarySize(output), "MPF final JPEG size");
                }
                if (profile == LivePhotoProfile.VIVO_LEGACY_PAIR) {
                    eq(ID,VivoLegacyMetadata.readId(product.primary()),"paired image ID");
                    eq(ID,VivoLegacyMetadata.readId(product.companions().get(0)),"paired video ID");
                }
                if (profile == LivePhotoProfile.SAMSUNG_SEF) {
                    byte[] b = Files.readAllBytes(product.primary().toPath());
                    eq("SEFT",new String(b,b.length-4,4,StandardCharsets.US_ASCII),"SEF remains last");
                }
                if (profile == LivePhotoProfile.HUAWEI_LEGACY) {
                    byte[] b = Files.readAllBytes(product.primary().toPath());
                    eq("LIVE_",new String(b,b.length-20,5,StandardCharsets.US_ASCII),"Huawei tail location");
                }
                File mutate = profile.paired ? product.companions().get(0) : product.primary();
                byte[] b = Files.readAllBytes(mutate.toPath());
                int video = indexOf(b,VIDEO); ok(video >= 0,"video present " + profile.id);
                b[video + VIDEO.length - 1] ^= 1;
                Files.write(mutate.toPath(),b);
                rejects(() -> MotionContainerVerifier.verify(profile,product,mp4,options),"damaged motion rejected " + profile.id);
            }
            File padded = new File(dir,"padded.jpg");
            Files.write(padded.toPath(),concat(jpeg(null,null),new byte[]{1,2,3,4,5}));
            File padDir = new File(dir,"padded"); padDir.mkdir();
            var product = MotionContainer.write(LivePhotoProfile.STANDARD,padded,mp4,padDir,options);
            MotionContainerVerifier.verify(LivePhotoProfile.STANDARD,product,mp4,options);
            eq(5L,MotionXmp.primaryPadding(JpegSegments.xmp(Files.readAllBytes(product.primary().toPath()))),"source tail padding accounted for");
            rejects(() -> new MotionContainer.Options(-1,0,30,1000000,ID,"m"),"unknown cover never silently zero");
            rejects(() -> new MotionContainer.Options(1000000,30,30,1000000,ID,"m"),"cover cannot point beyond video");
            rejects(() -> MotionContainer.huaweiTail(new MotionContainer.Options(900000,120,150,1000000,ID,"m"),40),"Huawei short cover field never truncated");
        } finally {
            try (var paths = Files.walk(dir.toPath())) {
                for (var p : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(p);
            }
        }
        System.out.println("Live Photo core: " + checks + " behavior checks PASS (not Android/device acceptance)");
    }

    private static byte[] jpeg(byte[] xmp, byte[] mpf) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        b.write(new byte[]{(byte)255,(byte)216});
        // An EOI-looking pair inside EXIF must not terminate the primary image.
        segment(b,0xe1,new byte[]{'E','x','i','f',0,0,(byte)255,(byte)217});
        segment(b,0xe2,"ICC_PROFILE\0fixture".getBytes(StandardCharsets.US_ASCII));
        if (xmp != null) segment(b,0xe1,concat("http://ns.adobe.com/xap/1.0/\0".getBytes(StandardCharsets.US_ASCII),xmp));
        if (mpf != null) b.write(mpf);
        segment(b,0xda,new byte[]{1,1,0,0,63,0});
        b.write(new byte[]{1,2,(byte)255,0,3,(byte)255,(byte)208,4,(byte)255,(byte)217});
        return b.toByteArray();
    }
    private static void segment(ByteArrayOutputStream b,int marker,byte[] payload) throws IOException {
        int n=payload.length+2; b.write(255);b.write(marker);b.write(n>>>8);b.write(n);b.write(payload);
    }
    private static byte[] concat(byte[] a,byte[] b) { byte[] out=Arrays.copyOf(a,a.length+b.length);System.arraycopy(b,0,out,a.length,b.length);return out; }
    private static int indexOf(byte[] a,byte[] b) { outer:for(int i=0;i<=a.length-b.length;i++){for(int j=0;j<b.length;j++)if(a[i+j]!=b[j])continue outer;return i;}return -1; }
    private static void eq(Object a,Object b,String label) { if(!a.equals(b))throw new AssertionError(label+": expected "+a+", got "+b);checks++; }
    private static void ok(boolean value,String label) { if(!value)throw new AssertionError(label);checks++; }
    private static void rejects(Checked action,String label) throws Exception { try{action.run();}catch(IOException|IllegalArgumentException expected){checks++;return;}throw new AssertionError(label+": unexpectedly accepted"); }
}