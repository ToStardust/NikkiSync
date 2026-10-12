import app.nikkisync.mobile.media.live.JpegSegments;
import app.nikkisync.mobile.media.live.LivePhotoProfile;
import app.nikkisync.mobile.media.live.MotionContainer;
import app.nikkisync.mobile.media.live.MotionContainerVerifier;
import app.nikkisync.mobile.media.live.MotionXmp;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HexFormat;

/** Local container audit only; no Android codec or OEM Gallery acceptance is implied. */
public final class VerifyUnrotatedQuality {
    public static void main(String[] args) throws Exception {
        if(args.length!=7)throw new IllegalArgumentException("JPEG MP4 new-output-directory cover-PTS-us cover-index frame-count duration-us");
        File image=new File(args[0]),video=new File(args[1]),out=new File(args[2]);
        String imageHash=hash(image),videoHash=hash(video);
        Files.createDirectory(out.toPath());
        var options=new MotionContainer.Options(Long.parseLong(args[3]),Integer.parseInt(args[4]),
                Integer.parseInt(args[5]),Long.parseLong(args[6]),"1760000000000abcdef0000000000","audit-only");
        var product=MotionContainer.write(LivePhotoProfile.OPLUS,image,video,out,options);
        MotionContainerVerifier.verify(LivePhotoProfile.OPLUS,product,video,options);
        byte[] source=JpegSegments.read(image),container;
        try(InputStream input=Files.newInputStream(product.primary().toPath())) {
            container=input.readNBytes((int)Math.min(product.primary().length(),JpegSegments.MAX_IMAGE_BYTES));
        }
        byte[] xmp=JpegSegments.xmp(container);long length=MotionXmp.videoLength(xmp);
        File extracted=new File(out,"embedded.mp4");
        try(RandomAccessFile input=new RandomAccessFile(product.primary(),"r");OutputStream output=Files.newOutputStream(extracted.toPath())) {
            input.seek(input.length()-length);byte[] buffer=new byte[128*1024];long remaining=length;
            while(remaining>0){int n=(int)Math.min(remaining,buffer.length);input.readFully(buffer,0,n);output.write(buffer,0,n);remaining-=n;}
        }
        // Metadata can change. The scan's compressed pixels must stay identical.
        byte[] beforeScan=scan(source),afterScan=scan(container);
        if(!Arrays.equals(beforeScan,afterScan))throw new IllegalStateException("JPEG compressed pixels changed");
        String extractedHash=hash(extracted);
        if(!videoHash.equals(extractedHash)||!videoHash.equals(hash(video))||!imageHash.equals(hash(image)))
            throw new IllegalStateException("Embedded video or source files changed");
        String report="{\n  \"scope\": \"Oplus container only, not device playback\",\n  \"sourceVideoSha256\": \""+videoHash+"\",\n"
                +"  \"embeddedVideoSha256\": \""+extractedHash+"\",\n  \"videoBytes\": "+length+",\n"
                +"  \"sourceJpegTrailerBytes\": "+(source.length-JpegSegments.endOffset(source))+",\n"
                +"  \"exportedVideoGapBytes\": "+(product.primary().length()-length-JpegSegments.endOffset(container))+",\n"
                +"  \"primaryPadding\": "+MotionXmp.primaryPadding(xmp)+",\n  \"oplusLayoutVerified\": true,\n"
                +"  \"videoUnchanged\": true,\n  \"jpegCompressedPixelsUnchanged\": true,\n  \"sourceFilesUnchanged\": true\n}\n";
        Files.writeString(new File(out,"quality-report.json").toPath(),report);System.out.print(report);
    }
    private static String hash(File file) throws Exception {
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(InputStream input=Files.newInputStream(file.toPath())){byte[] buffer=new byte[128*1024];int n;while((n=input.read(buffer))!=-1)digest.update(buffer,0,n);}
        return HexFormat.of().formatHex(digest.digest());
    }
    private static byte[] scan(byte[] image) throws Exception {
        int end=JpegSegments.endOffset(image),offset=2;
        while(offset<end) {
            if((image[offset++]&255)!=255)throw new IllegalArgumentException("Invalid JPEG marker");
            int marker=image[offset++]&255;while(marker==255)marker=image[offset++]&255;
            if(marker==0xda)return Arrays.copyOfRange(image,offset-2,end);
            int length=((image[offset]&255)<<8)|(image[offset+1]&255);offset+=length;
        }
        throw new IllegalArgumentException("No JPEG pixel scan");
    }
}
