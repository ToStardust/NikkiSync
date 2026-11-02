using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace NikkiSync.WindowsShell.Services;

/// <summary>A read-only, bounded WIC decode. Output contains only rendered preview pixels.</summary>
public static class OrganizerPreview
{
    public static int Run(string input,string output)
    {
        try
        {
            if(!Path.IsPathFullyQualified(input)||!Path.IsPathFullyQualified(output)||File.Exists(output)
                ||!new[]{".jpg",".jpeg",".png",".webp"}.Contains(Path.GetExtension(input).ToLowerInvariant()))return 2;
            using var stream=new FileStream(input,FileMode.Open,FileAccess.Read,FileShare.Read);
            if(stream.Length<4||stream.Length>256L*1024*1024)return 2;
            var decoder=BitmapDecoder.Create(stream,BitmapCreateOptions.DelayCreation,BitmapCacheOption.None);var frame=decoder.Frames[0];
            if(frame.PixelWidth<1||frame.PixelHeight<1||(long)frame.PixelWidth*frame.PixelHeight>300_000_000)return 2;
            int orientation=1;try{if(frame.Metadata is BitmapMetadata metadata)orientation=Convert.ToInt32(metadata.GetQuery("/app1/ifd/{ushort=274}"));}catch{}
            stream.Position=0;var image=new BitmapImage();image.BeginInit();image.CacheOption=BitmapCacheOption.OnLoad;image.StreamSource=stream;
            if(frame.PixelWidth>=frame.PixelHeight)image.DecodePixelWidth=Math.Min(512,frame.PixelWidth);else image.DecodePixelHeight=Math.Min(512,frame.PixelHeight);
            image.EndInit();image.Freeze();BitmapSource pixels=image;
            Transform? transform=orientation switch{2=>new ScaleTransform(-1,1),3=>new RotateTransform(180),4=>new ScaleTransform(1,-1),6=>new RotateTransform(90),8=>new RotateTransform(270),_=>null};
            if(orientation is 5 or 7){var group=new TransformGroup();group.Children.Add(new ScaleTransform(-1,1));group.Children.Add(new RotateTransform(orientation==5?270:90));transform=group;}
            if(transform is not null)pixels=new TransformedBitmap(image,transform);
            var encoder=new JpegBitmapEncoder{QualityLevel=82};encoder.Frames.Add(BitmapFrame.Create(pixels));
            using var file=new FileStream(output,FileMode.CreateNew,FileAccess.Write,FileShare.None);encoder.Save(file);return file.Length<=2*1024*1024?0:3;
        }
        catch{return 5;}
    }
}
