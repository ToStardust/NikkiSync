package app.nikkisync.mobile.media.live;
import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;

/** Container audit only: synthetic JPEG + read-only actual game MP4s; never an OEM playback result. */
public final class VerifyVivoGameTrailer {
 public static void main(String[] args)throws Exception{
  if(args.length!=2)throw new IllegalArgumentException("source-video-directory new-workspace-output-directory");
  Path input=Path.of(args[0]),out=Path.of(args[1]);Files.createDirectory(out);
  List<Path> sources;try(var paths=Files.walk(input)){sources=paths.filter(Files::isRegularFile).filter(p->p.toString().toLowerCase(Locale.ROOT).endsWith(".mp4")).sorted().limit(12).toList();}
  List<String> results=new ArrayList<>();
  for(int i=0;i<sources.size();i++){
   File source=sources.get(i).toFile();String before=hash(source);var layout=MotionContainer.vivoSource(source);
   Path directory=Files.createDirectory(out.resolve("sample-"+i));File jpeg=directory.resolve("synthetic.jpg").toFile();
   Files.write(jpeg.toPath(),new byte[]{(byte)255,(byte)216,(byte)255,(byte)218,0,8,1,1,0,0,63,0,1,2,(byte)255,(byte)217});
   var options=new MotionContainer.Options(0,0,1,1,"1760000000000"+"abcdef0"+"00000000","synthetic");
   var product=MotionContainer.write(LivePhotoProfile.VIVO_LEGACY_PAIR,jpeg,source,directory.toFile(),options);
   MotionContainerVerifier.verify(LivePhotoProfile.VIVO_LEGACY_PAIR,product,source,options);
   File movie=product.companions().get(0);var finite=MotionContainer.vivoSource(movie);
   if(finite.trailerBytes()!=0||finite.mediaBytes()!=movie.length())throw new IOException("Output not fully boxed");
   if(!before.equals(hash(source)))throw new IOException("Source changed");
   results.add("{\"sample\":"+i+",\"sourceBytes\":"+source.length()+",\"videoPrefixBytes\":"+layout.mediaBytes()+",\"gameTrailerBytes\":"+layout.trailerBytes()+",\"allSourceBytesPreserved\":true,\"sourceUnchanged\":true,\"companionFullyBoxed\":true}");
  }
  if(sources.isEmpty())throw new IOException("No samples");
  System.out.println("{\"sampleCount\":"+sources.size()+",\"syntheticCoverOnly\":true,\"oemPlaybackTested\":false,\"samples\":["+String.join(",",results)+"]}");
 }
 private static String hash(File file)throws Exception{
  var digest=MessageDigest.getInstance("SHA-256");try(var in=new DigestInputStream(new FileInputStream(file),digest)){in.transferTo(OutputStream.nullOutputStream());}
  return HexFormat.of().formatHex(digest.digest());
 }
}
