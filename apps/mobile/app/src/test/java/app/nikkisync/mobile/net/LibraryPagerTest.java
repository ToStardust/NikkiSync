package app.nikkisync.mobile.net;
import app.nikkisync.mobile.model.Models.*;
import java.util.*;
import java.util.concurrent.CancellationException;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import static org.junit.Assert.*;

public class LibraryPagerTest {
    static AssetSummary photo(int n,long revision){return new AssetSummary("asset_"+n,"photo","ready",null,null,revision,100,100,false,false,null,"preview",null,null);}
    @Test public void readsSixtyFiveThousandWithoutAPhotoCountLimitAndKeepsTheBaselineForChanges()throws Exception{
        AtomicInteger pages=new AtomicInteger();List<Integer> progress=new ArrayList<>();
        var result=LibraryPager.read((cursor,limit)->{
            assertEquals(500,limit);int start=cursor==null?0:Integer.parseInt(cursor);pages.incrementAndGet();List<AssetSummary> items=new ArrayList<>();
            for(int i=start;i<Math.min(start+limit,65000);i++)items.add(photo(i,1));
            return new AssetPage(items,start+limit<65000?String.valueOf(start+limit):null,pages.get()==1?10:20);
        },()->true,progress::add);
        assertEquals(65000,result.items().size());assertEquals(130,pages.get());assertEquals("asset_0",result.items().get(0).assetId());assertEquals("asset_64999",result.items().get(64999).assetId());
        assertEquals(10,result.baselineRevision());assertEquals(20,result.latestRevision());assertEquals(Integer.valueOf(65000),progress.get(progress.size()-1));
    }
    @Test public void repeatedCursorsAndEmptyContinuationFailWithoutInfiniteRequests()throws Exception{
        AtomicInteger calls=new AtomicInteger();
        assertThrows(IllegalStateException.class,()->LibraryPager.read((cursor,limit)->new AssetPage(List.of(photo(calls.incrementAndGet(),1)),"same",1),()->true,null));assertEquals(2,calls.get());
        assertThrows(IllegalStateException.class,()->LibraryPager.read((cursor,limit)->new AssetPage(List.of(),"next",1),()->true,null));
    }
    @Test public void overlappingPagesKeepNewerMetadataAndCancelledSessionsStopBeforeAnotherPage()throws Exception{
        var result=LibraryPager.read((cursor,limit)->cursor==null?new AssetPage(List.of(photo(1,1),photo(2,1)),"next",1):new AssetPage(List.of(photo(2,2),photo(3,1)),null,2),()->true,null);
        assertEquals(List.of("asset_1","asset_2","asset_3"),result.items().stream().map(AssetSummary::assetId).toList());assertEquals(2,result.items().get(1).revision());
        AtomicInteger calls=new AtomicInteger();assertThrows(CancellationException.class,()->LibraryPager.read((cursor,limit)->{calls.incrementAndGet();return new AssetPage(List.of(photo(1,1)),"next",1);},()->calls.get()==0,null));assertEquals(1,calls.get());
    }
}
