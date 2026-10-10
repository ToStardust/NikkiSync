package app.nikkisync.mobile.ui;

import static org.junit.Assert.*;
import android.app.Activity;
import android.widget.ProgressBar;
import android.widget.TextView;
import app.nikkisync.mobile.R;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;

@RunWith(RobolectricTestRunner.class)
public class OperationProgressDialogTest {
    @Test public void unknownStageThenMeasuredProgressAndCompletionAreVisible() {
        Activity activity=Robolectric.buildActivity(Activity.class).setup().get();activity.setTheme(R.style.AppTheme);
        var dialog=new OperationProgressDialog(activity,"生成分享图",null);dialog.show();
        dialog.update("读取原图",0,0);assertTrue(dialog.bar().isIndeterminate());
        dialog.update("部件图片",4,16);assertFalse(dialog.bar().isIndeterminate());assertEquals(25,dialog.bar().getProgress());
        assertTrue(dialog.label().getText().toString().contains("4 / 16"));
        dialog.update("写入相册",3,3);assertEquals(100,dialog.bar().getProgress());dialog.dismiss();
        dialog.update("迟到结果",0,0);assertFalse(dialog.isShowing());
    }
}
