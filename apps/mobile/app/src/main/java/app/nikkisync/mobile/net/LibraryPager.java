package app.nikkisync.mobile.net;

import app.nikkisync.mobile.model.Models.*;
import java.util.*;
import java.util.concurrent.CancellationException;
import java.util.function.BooleanSupplier;
import java.util.function.IntConsumer;

/** Keyset pagination has no photo-count ceiling; reject broken cursors instead of large albums. */
public final class LibraryPager {
    private LibraryPager(){}
    @FunctionalInterface public interface Source {AssetPage read(String cursor,int limit)throws Exception;}
    public record Result(List<AssetSummary> items,long baselineRevision,long latestRevision){}
    public static Result read(Source source,BooleanSupplier current,IntConsumer progress)throws Exception{
        LinkedHashMap<String,AssetSummary> photos=new LinkedHashMap<>();Set<String> cursors=new HashSet<>();
        String cursor=null;long baseline=-1,latest=0;
        while(true){
            if(!current.getAsBoolean())throw new CancellationException("Library session changed");
            AssetPage page=source.read(cursor,500);
            if(!current.getAsBoolean())throw new CancellationException("Library session changed");
            if(page==null||page.items()==null||page.libraryRevision()<0)throw new IllegalStateException("图库分页响应无效");
            if(baseline<0)baseline=page.libraryRevision();latest=Math.max(latest,page.libraryRevision());
            int before=photos.size();
            for(AssetSummary asset:page.items()){
                if(asset==null||asset.assetId()==null||asset.assetId().isBlank())throw new IllegalStateException("图库照片标识无效");
                AssetSummary previous=photos.get(asset.assetId());if(previous==null||asset.revision()>=previous.revision())photos.put(asset.assetId(),asset);
            }
            if(progress!=null)progress.accept(photos.size());
            String next=page.nextCursor();
            if(next==null)return new Result(List.copyOf(photos.values()),baseline,latest);
            if(next.isBlank()||!cursors.add(next)||photos.size()==before)throw new IllegalStateException("图库分页未继续前进，请重新同步");
            cursor=next;
        }
    }
}
