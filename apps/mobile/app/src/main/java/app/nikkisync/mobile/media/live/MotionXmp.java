package app.nikkisync.mobile.media.live;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.SAXException;

/** Namespace-aware XMP replacement; never discard unrelated application metadata. */
public final class MotionXmp {
    public static final String CAMERA="http://ns.google.com/photos/1.0/camera/";
    public static final String CONTAINER="http://ns.google.com/photos/1.0/container/";
    public static final String ITEM="http://ns.google.com/photos/1.0/container/item/";
    private static final String RDF="http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    private static final String OPLUS="http://ns.oplus.com/photos/1.0/camera/";
    private static final String VIVO="http://ns.vivo.com/photos/1.0/camera/";
    private MotionXmp() {}

    public static byte[] create(LivePhotoProfile profile,long length,long pts,long padding) {
        if(length<=0 || pts<0 || padding<0)throw new IllegalArgumentException("无效 Motion Photo 长度/时间戳");
        String head="<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF xmlns:rdf=\""+RDF+"\"><rdf:Description rdf:about=\"\"";
        if(profile==LivePhotoProfile.VIVO_LEGACY_PAIR || profile==LivePhotoProfile.HUAWEI_LEGACY)
            return (head+"/></rdf:RDF></x:xmpmeta>").getBytes(StandardCharsets.UTF_8);
        StringBuilder s=new StringBuilder(head).append(" xmlns:GCamera=\"").append(CAMERA)
            .append("\" GCamera:MotionPhoto=\"1\" GCamera:MotionPhotoVersion=\"1\" GCamera:MotionPhotoPresentationTimestampUs=\"").append(pts).append("\"");
        if(profile==LivePhotoProfile.XIAOMI) s.append(" GCamera:MicroVideo=\"1\" GCamera:MicroVideoVersion=\"1\" GCamera:MicroVideoOffset=\"")
            .append(length).append("\" GCamera:MicroVideoPresentationTimestampUs=\"").append(pts).append("\"");
        if(profile==LivePhotoProfile.OPLUS) s.append(" xmlns:OpCamera=\"").append(OPLUS)
            .append("\" OpCamera:MotionPhotoOwner=\"oplus\" OpCamera:OLivePhotoVersion=\"2\" OpCamera:MotionPhotoFeatureFlag=\"1\" OpCamera:VideoLength=\"").append(length).append("\"");
        if(profile==LivePhotoProfile.VIVO_SINGLE_XMP) s.append(" xmlns:VCamera=\"").append(VIVO)
            .append("\" VCamera:VMotionPhotoVersion=\"1\" VCamera:VMotionPhotoSource=\"1\" VCamera:VMediaKitVersion=\"1.0.0.9\"");
        if(profile==LivePhotoProfile.SAMSUNG_SEF) return s.append("/></rdf:RDF></x:xmpmeta>").toString().getBytes(StandardCharsets.UTF_8);
        s.append(" xmlns:Container=\"").append(CONTAINER).append("\" xmlns:Item=\"").append(ITEM).append("\"><Container:Directory><rdf:Seq>")
            .append("<rdf:li rdf:parseType=\"Resource\"><Container:Item Item:Mime=\"image/jpeg\" Item:Semantic=\"Primary\" Item:Padding=\"").append(padding).append("\"/></rdf:li>")
            .append("<rdf:li rdf:parseType=\"Resource\"><Container:Item Item:Mime=\"video/mp4\" Item:Semantic=\"MotionPhoto\" Item:Length=\"").append(length)
            .append("\"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>");
        return s.toString().getBytes(StandardCharsets.UTF_8);
    }
    public static byte[] merge(byte[] previous,byte[] replacement) throws IOException {
        Document fresh=parse(replacement);
        if(previous==null) return replacement;
        Document old=parse(previous);
        strip(old.getDocumentElement());
        NodeList oldRdf=old.getElementsByTagNameNS(RDF,"RDF"),newRdf=fresh.getElementsByTagNameNS(RDF,"RDF");
        if(oldRdf.getLength()!=1 || newRdf.getLength()!=1)throw new IOException("XMP RDF 结构不受支持");
        for(Node n=newRdf.item(0).getFirstChild();n!=null;n=n.getNextSibling()) oldRdf.item(0).appendChild(old.importNode(n,true));
        try {
            var transformer=TransformerFactory.newInstance().newTransformer();
            transformer.setOutputProperty(OutputKeys.OMIT_XML_DECLARATION,"yes");
            transformer.setOutputProperty(OutputKeys.ENCODING,"UTF-8");
            ByteArrayOutputStream out=new ByteArrayOutputStream();
            transformer.transform(new DOMSource(old),new StreamResult(out));
            if(out.size()>65000)throw new IOException("合并后的 XMP 超过单 APP1 容量");
            return out.toByteArray();
        } catch(IOException e){throw e;}catch(Exception e){throw new IOException("无法保留原始 XMP",e);}
    }
    private static void strip(Element root) {
        var attrs=root.getAttributes();
        for(int i=attrs.getLength()-1;i>=0;i--){Node a=attrs.item(i);if(isMotionProperty(a.getNamespaceURI(),a.getLocalName()))root.removeAttributeNode((org.w3c.dom.Attr)a);}
        for(Node n=root.getFirstChild();n!=null;){Node next=n.getNextSibling();if(n instanceof Element e){
            if((CONTAINER.equals(e.getNamespaceURI())&&"Directory".equals(e.getLocalName())) || isMotionProperty(e.getNamespaceURI(),e.getLocalName()))root.removeChild(e);
            else strip(e);
        }n=next;}
    }
    private static boolean isMotionProperty(String ns,String key) {
        if(key==null)return false;
        return CAMERA.equals(ns)&&(key.startsWith("MotionPhoto")||key.startsWith("MicroVideo"))
            || OPLUS.equals(ns)&&(key.startsWith("MotionPhoto")||key.startsWith("OLivePhoto")||key.equals("VideoLength"))
            || VIVO.equals(ns)&&(key.startsWith("VMotionPhoto")||key.equals("VMediaKitVersion"));
    }
    private static Document parse(byte[] bytes) throws IOException {
        if(bytes==null || bytes.length>65000)throw new IOException("XMP 缺失或过大");
        String s=new String(bytes,StandardCharsets.UTF_8).toUpperCase(Locale.ROOT);
        if(s.contains("<!DOCTYPE") || s.contains("<!ENTITY"))throw new IOException("XMP 不允许 DTD/外部实体");
        try {
            DocumentBuilderFactory f=DocumentBuilderFactory.newInstance();f.setNamespaceAware(true);f.setExpandEntityReferences(false);
            var builder=f.newDocumentBuilder();
            builder.setEntityResolver((publicId,systemId)->{throw new SAXException("External entity forbidden");});
            builder.setErrorHandler(new org.xml.sax.helpers.DefaultHandler(){
                @Override public void error(org.xml.sax.SAXParseException e)throws SAXException{throw e;}
                @Override public void fatalError(org.xml.sax.SAXParseException e)throws SAXException{throw e;}
            });
            return builder.parse(new ByteArrayInputStream(bytes));
        }catch(Exception e){throw new IOException("无法安全解析 XMP",e);}
    }
    public static long videoLength(byte[] xmp)throws IOException{return itemNumber(xmp,"MotionPhoto","Length",-1);}
    public static long primaryPadding(byte[] xmp)throws IOException{return itemNumber(xmp,"Primary","Padding",0);}
    private static long itemNumber(byte[] xmp,String semantic,String field,long fallback)throws IOException{
        NodeList items=parse(xmp).getElementsByTagNameNS(CONTAINER,"Item");Element match=null;
        for(int i=0;i<items.getLength();i++){Element e=(Element)items.item(i);if(semantic.equals(e.getAttributeNS(ITEM,"Semantic"))){if(match!=null)throw new IOException("重复的 XMP 媒体项");match=e;}}
        if(match==null)throw new IOException("缺少 XMP "+semantic+" 项");
        String expected="Primary".equals(semantic)?"image/jpeg":"video/mp4";
        if(!expected.equals(match.getAttributeNS(ITEM,"Mime")))throw new IOException("XMP 媒体类型不匹配");
        String value=match.getAttributeNS(ITEM,field);if(value.isEmpty()&&fallback>=0)return fallback;
        try{long n=Long.parseLong(value);if(n<0)throw new NumberFormatException();return n;}catch(NumberFormatException e){throw new IOException("无效 XMP "+field,e);}
    }
    public static long timestamp(byte[] xmp)throws IOException{
        NodeList all=parse(xmp).getElementsByTagName("*");String value=null;
        for(int i=0;i<all.getLength();i++){Element e=(Element)all.item(i);if(e.hasAttributeNS(CAMERA,"MotionPhotoPresentationTimestampUs")){
            if(value!=null)throw new IOException("重复的封面时间戳");value=e.getAttributeNS(CAMERA,"MotionPhotoPresentationTimestampUs");}}
        try{long n=Long.parseLong(value);if(n<0)throw new NumberFormatException();return n;}catch(Exception e){throw new IOException("封面时间戳缺失/无效",e);}
    }
}