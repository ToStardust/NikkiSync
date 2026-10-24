package app.nikkisync.mobile.inspiration;

import static org.junit.Assert.*;

import android.view.View;
import android.view.ViewGroup;
import android.content.Intent;
import android.os.Looper;
import android.widget.TextView;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import android.widget.EditText;
import app.nikkisync.mobile.ui.chrome.ChromeSheetLayout;

@RunWith(RobolectricTestRunner.class)
public final class InspirationActivityTest {
    @org.junit.Before public void acceptPrivacyForExistingEditorTests(){new app.nikkisync.mobile.privacy.PrivacyConsentStore(org.robolectric.RuntimeEnvironment.getApplication()).accept();}
    @Test public void customCategoryHasCompactHeightAndAVisibleEditableField() throws Exception {
        var controller=Robolectric.buildActivity(InspirationActivity.class).setup();
        try {
            var activity=controller.get();showEditor(activity,null);
            findText((View)field(activity,"activeEditor"),"＋ 新增分类").performClick();
            var nav=activity.navigationHost();View layer=nav.getChildAt(nav.getChildCount()-1);
            nav.measure(View.MeasureSpec.makeMeasureSpec(900,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(2400,View.MeasureSpec.EXACTLY));nav.layout(0,0,900,2400);
            EditText name=input(layer);assertNotNull(name);assertTrue("single name must not consume 400dp",name.getHeight()<100*activity.getResources().getDisplayMetrics().density);
            assertNotNull("input needs a visible border/material",name.getBackground());
            assertEquals(activity.getColor(app.nikkisync.mobile.R.color.text_primary),name.getCurrentTextColor());
            name.setText("拍照");findText(layer,"添加").performClick();nav.interrupt();
            assertTrue(containsText((View)field(activity,"activeEditor"),"拍照"));
        } finally {controller.pause().stop().destroy();}
    }
    @Test public void notebookOpensOfflineWithoutPairingOrGalleryState() {
        var controller = Robolectric.buildActivity(InspirationActivity.class).setup();
        try {
            assertTrue(containsText(controller.get().getWindow().getDecorView(), "穿搭灵感库"));
            assertTrue(containsText(controller.get().getWindow().getDecorView(), "记录新的灵感"));
        } finally { controller.pause().stop().destroy(); }
    }

    @Test public void androidShareOpensAnEditableDraftWithOriginalText() throws Exception {
        Intent share = new Intent(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, "  OUTFIT-123  ");
        var controller = Robolectric.buildActivity(InspirationActivity.class, share).setup();
        try {
            Shadows.shadowOf(Looper.getMainLooper()).idle();
            Object editor=field(controller.get(),"activeEditor");
            assertTrue("Editor must use the current GPU glass sheet",editor instanceof ChromeSheetLayout);
            assertTrue(containsText((View)editor,"  OUTFIT-123  "));
        } finally { controller.pause().stop().destroy(); }
    }

    @Test public void newEditorHasOnlyCodeCategoryAndStatusAndSavesWithoutTitle() throws Exception {
        var controller=Robolectric.buildActivity(InspirationActivity.class).setup();
        try {
            var activity=controller.get();showEditor(activity,null);
            Object editor=field(activity,"activeEditor");assertTrue(editor instanceof ChromeSheetLayout);
            View form=(View)editor;
            assertTrue(containsText(form,"填入染色码 / 搭配码"));
            assertTrue(containsText(form,"选择分类"));assertTrue(containsText(form,"选择状态"));
            assertFalse(containsText(form,"来源原文"));assertFalse(containsText(form,"添加参考图片"));
            assertEquals(1,countInputs(form));
            input(form).setText("  CODE-123  ");findText(form,"自搭").performClick();findText(form,"保存").performClick();
            settle(activity);
            var entries=((InspirationStore)field(activity,"store")).search("CODE-123",null,null);
            assertEquals(1,entries.size());assertEquals("",entries.get(0).title());
            assertEquals("self",entries.get(0).status());assertEquals("  CODE-123  ",entries.get(0).code().rawCode());
        }finally {controller.pause().stop().destroy();}
    }

    @Test public void simplifiedEditingPreservesHiddenUserFieldsAndParsedSnapshot() throws Exception {
        var controller=Robolectric.buildActivity(InspirationActivity.class).setup();
        try {
            var activity=controller.get();var store=(InspirationStore)field(activity,"store");
            var entry=store.create(new InspirationStore.Draft("旧标题","CODE-OLD","dye","原分享正文","https://example.com/p",
                    "旧备注",List.of("旧标签"),List.of("旧分类"),"tried"),1);
            store.recordParseResult(entry.code().id(),"success","{\"clothingIds\":[\"1\"]}","r1","d1",2);
            showEditor(activity,store.get(entry.id()));View editor=(View)field(activity,"activeEditor");
            findText(editor,"已复刻").performClick();findText(editor,"保存").performClick();settle(activity);
            var saved=store.get(entry.id());assertEquals("旧标题",saved.title());assertEquals("旧备注",saved.notes());
            assertEquals(List.of("旧标签"),saved.tags());assertEquals(List.of("旧分类"),saved.categories());
            assertEquals("原分享正文",saved.code().sourceText());assertEquals("https://example.com/p",saved.code().sourceUrl());
            assertEquals("success",saved.code().parsedState());assertEquals("reproduced",saved.status());
        }finally {controller.pause().stop().destroy();}
    }

    @Test public void glassEditorCancelAndPredictiveBackDoNotSaveAnUnconfirmedCode() throws Exception {
        var controller=Robolectric.buildActivity(InspirationActivity.class).setup();
        try {
            var activity=controller.get();showEditor(activity,null);input((View)field(activity,"activeEditor")).setText("UNSAVED-CODE");
            activity.navigationHost().progress(.5f);activity.navigationHost().cancel();activity.navigationHost().interrupt();
            assertNotNull(field(activity,"activeEditor"));assertEquals(2,activity.navigationHost().overlayCount());
            activity.navigationHost().commit();activity.navigationHost().interrupt();
            assertNull(field(activity,"activeEditor"));assertEquals(1,activity.navigationHost().overlayCount());
            assertTrue(((InspirationStore)field(activity,"store")).search("UNSAVED-CODE",null,null).isEmpty());
        }finally {controller.pause().stop().destroy();}
    }

    @Test public void changingOnlyCategoriesKeepsSnapshotButCorrectingCodeInvalidatesIt() throws Exception {
        var controller=Robolectric.buildActivity(InspirationActivity.class).setup();
        try {
            var activity=controller.get();var store=(InspirationStore)field(activity,"store");
            var entry=store.create(new InspirationStore.Draft("","DYE-OLD","dye","原文",null,"",List.of(),List.of("日常"),"want"),1);
            store.recordParseResult(entry.code().id(),"success","{\"clothingIds\":[\"1\"]}","r1","d1",2);
            showEditor(activity,store.get(entry.id()));View sheet=(View)field(activity,"activeEditor");
            findText(sheet,"日常").performClick();findText(sheet,"保存").performClick();settle(activity);activity.navigationHost().interrupt();
            assertEquals(List.of(),store.get(entry.id()).categories());assertEquals("success",store.get(entry.id()).code().parsedState());
            showEditor(activity,store.get(entry.id()));sheet=(View)field(activity,"activeEditor");
            input(sheet).setText("DYE-NEW");findText(sheet,"保存").performClick();settle(activity);
            assertEquals("DYE-NEW",store.get(entry.id()).code().rawCode());assertEquals("pending",store.get(entry.id()).code().parsedState());
            assertNull(store.get(entry.id()).code().snapshotJson());assertEquals("原文",store.get(entry.id()).code().sourceText());
        }finally {controller.pause().stop().destroy();}
    }

    private static Object field(InspirationActivity activity,String name) throws Exception {
        Field page=InspirationActivity.class.getDeclaredField("page");page.setAccessible(true);
        Field f=InspirationPage.class.getDeclaredField(name);f.setAccessible(true);return f.get(page.get(activity));
    }
    private static void showEditor(InspirationActivity activity,InspirationStore.Entry entry) throws Exception {
        Field page=InspirationActivity.class.getDeclaredField("page");page.setAccessible(true);
        Method m=InspirationPage.class.getDeclaredMethod("showEditor",InspirationStore.Entry.class,InspirationShareImport.Incoming.class);
        m.setAccessible(true);m.invoke(page.get(activity),entry,null);
    }
    private static void settle(InspirationActivity activity) throws Exception {
        ((ExecutorService)field(activity,"io")).submit(()->{}).get(10,TimeUnit.SECONDS);
        Shadows.shadowOf(Looper.getMainLooper()).idle();
    }
    private static int countInputs(View view) {
        int count=view instanceof EditText?1:0;
        if(view instanceof ViewGroup group)for(int i=0;i<group.getChildCount();i++)count+=countInputs(group.getChildAt(i));
        return count;
    }
    private static EditText input(View view) {
        if(view instanceof EditText edit)return edit;
        if(view instanceof ViewGroup group)for(int i=0;i<group.getChildCount();i++){EditText found=input(group.getChildAt(i));if(found!=null)return found;}
        return null;
    }
    private static View findText(View view,String value) {
        if(view instanceof TextView text&&value.equals(text.getText().toString()))return view;
        if(view instanceof ViewGroup group)for(int i=0;i<group.getChildCount();i++){View found=findText(group.getChildAt(i),value);if(found!=null)return found;}
        return null;
    }

    private static boolean containsText(View view, String expected) {
        if (view instanceof TextView text && text.getText().toString().contains(expected)) return true;
        if (view instanceof ViewGroup group) for (int i = 0; i < group.getChildCount(); i++)
            if (containsText(group.getChildAt(i), expected)) return true;
        return false;
    }
}
