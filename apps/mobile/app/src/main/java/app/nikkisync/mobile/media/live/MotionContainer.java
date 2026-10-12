package app.nikkisync.mobile.media.live;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.List;

/** File packaging only. No Android UI, downloading, metadata SDK calls or gallery-certification claims. */
public final class MotionContainer {
    static final byte[] SEF_NAME="MotionPhoto_Data".getBytes(StandardCharsets.US_ASCII);
    public record Options(long presentationUs,int coverFrame,int frameCount,long durationUs,String pairId,String model){
        public Options{if(presentationUs<0||durationUs<=presentationUs||coverFrame<0||frameCount<=coverFrame)throw new IllegalArgumentException("封面必须位于真实视频范围内");}
    }
    public record Product(File primary,List<File> companions){public Product{companions=List.copyOf(companions);}}
    private MotionContainer(){}
    public static Product write(LivePhotoProfile profile,File jpeg,File video,File outDir,Options options)throws IOException{
        byte[] original=JpegSegments.read(jpeg);int oldEnd=JpegSegments.endOffset(original);
        // Match the public Oplus reference layout: MP4 immediately after EOI. Drop only the exported copy's
        // opaque trailer, never image scan data or the source file/parameter snapshot.
        if(profile==LivePhotoProfile.OPLUS&&oldEnd!=original.length)original=Arrays.copyOf(original,oldEnd);
        long padding=original.length-oldEnd;
        JpegSegments.require(video.length()>0,"视频为空");
        byte[] xmp=MotionXmp.create(profile,video.length(),options.presentationUs,padding);
        byte[] primary=JpegSegments.rewrite(original,xmp,profile==LivePhotoProfile.OPLUS?mpfSegment(0):null);
        if(profile==LivePhotoProfile.OPLUS)primary=JpegSegments.rewrite(original,xmp,mpfSegment(JpegSegments.endOffset(primary)));
        File image=new File(outDir,profile.paired?"IMG_live.jpg":"live_MP.jpg");
        if(profile==LivePhotoProfile.VIVO_LEGACY_PAIR){
            File movie=new File(outDir,"IMG_live.mp4");
            try(OutputStream out=create(image)){out.write(primary);out.write(VivoLegacyMetadata.payload(options.pairId,options.model,null));}
            ensureFiniteBoxes(video);
            try(OutputStream out=create(movie)){copy(video,out);out.write(VivoLegacyMetadata.uuid(VivoLegacyMetadata.payload(options.pairId,options.model,options.coverFrame)));}
            return new Product(image,List.of(movie));
        }
        try(OutputStream out=create(image)){
            out.write(primary);
            if(profile==LivePhotoProfile.SAMSUNG_SEF){
                long size=8L+SEF_NAME.length+video.length();JpegSegments.require(size<=0xffffffffL,"SEF 视频超出 32 位范围");
                out.write(new byte[]{0,0,0x30,0x0a});out.write(le32(SEF_NAME.length));out.write(SEF_NAME);copy(video,out);out.write(sefIndex(size));
            }else{copy(video,out);if(profile==LivePhotoProfile.HUAWEI_LEGACY)out.write(huaweiTail(options,video.length()));}
        }
        return new Product(image,List.of());
    }
    public static byte[] mpfSegment(long primaryLength)throws IOException{
        JpegSegments.require(primaryLength>=0&&primaryLength<=0xffffffffL,"MPF 图像超出 32 位范围");
        ByteBuffer b=ByteBuffer.allocate(74).order(ByteOrder.BIG_ENDIAN);b.put((byte)255).put((byte)226).putShort((short)72).put(new byte[]{'M','P','F',0});
        b.order(ByteOrder.LITTLE_ENDIAN).put((byte)'I').put((byte)'I').putShort((short)42).putInt(8).putShort((short)3);
        ifd(b,0xb000,7,4,0x30303130); // ASCII 0100 (not the old byte-reversed version literal).
        ifd(b,0xb001,4,1,1);ifd(b,0xb002,7,16,50);b.putInt(0);
        b.putInt(0x00030000).putInt((int)primaryLength).putInt(0).putShort((short)0).putShort((short)0);return b.array();
    }
    private static void ifd(ByteBuffer b,int tag,int type,int count,int value){b.putShort((short)tag).putShort((short)type).putInt(count).putInt(value);}
    private static byte[] sefIndex(long size){return ByteBuffer.allocate(32).order(ByteOrder.LITTLE_ENDIAN)
        .put("SEFH".getBytes(StandardCharsets.US_ASCII)).putInt(106).putInt(1).putInt(0x0a300000).putInt((int)size).putInt((int)size).putInt(24).put("SEFT".getBytes(StandardCharsets.US_ASCII)).array();}
    static byte[] huaweiTail(Options o,long videoLength)throws IOException{
        // A narrowly scoped legacy candidate; fields are NOT a universal Huawei/Honor specification.
        JpegSegments.require(o.coverFrame<100,"当前华为尾标候选仅支持两位封面帧号，请选标准格式");
        byte[] tail=new byte[60];Arrays.fill(tail,(byte)' ');
        ascii(tail,0,6,"v6_f"+o.coverFrame);ascii(tail,20,8,o.coverFrame+":"+o.frameCount);ascii(tail,40,20,"LIVE_"+(videoLength+20));return tail;
    }
    private static void ascii(byte[] b,int offset,int max,String value)throws IOException{byte[] a=value.getBytes(StandardCharsets.US_ASCII);JpegSegments.require(a.length<=max,"厂商尾标字段超长，拒绝截断");System.arraycopy(a,0,b,offset,a.length);}
    private static byte[] le32(int n){return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(n).array();}
    private static OutputStream create(File file)throws IOException{return new BufferedOutputStream(Files.newOutputStream(file.toPath(),StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE));}
    static void copy(File file,OutputStream out)throws IOException{try(InputStream in=new BufferedInputStream(new FileInputStream(file))){byte[] b=new byte[128*1024];int n;while((n=in.read(b))!=-1){if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("Live 导出已取消");out.write(b,0,n);}}}
    private static void ensureFiniteBoxes(File mp4)throws IOException{
        try(var r=new java.io.RandomAccessFile(mp4,"r")){long at=0;while(at<r.length()){
            JpegSegments.require(r.length()-at>=8,"MP4 box 截断");r.seek(at);long n=Integer.toUnsignedLong(r.readInt());r.skipBytes(4);int header=8;
            JpegSegments.require(n!=0,"vivo 双文件追加 uuid 前不接受 size=0 的末尾 box");if(n==1){JpegSegments.require(r.length()-at>=16,"MP4 largesize 截断");n=r.readLong();header=16;}
            JpegSegments.require(n>=header&&n<=r.length()-at,"MP4 box 长度无效");at+=n;
        }}
    }
}
