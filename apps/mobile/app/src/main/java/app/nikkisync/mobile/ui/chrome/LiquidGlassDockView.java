package app.nikkisync.mobile.ui.chrome;

import android.content.Context;
import android.graphics.*;
import android.view.View;

/** App chrome only: separate backdrop frost, edge lens, and material shell. */
public final class LiquidGlassDockView extends View {
    private final ContentBackdrop backdrop;
    private final View anchor;
    private final RenderNode frost=new RenderNode("NikkiSync dock frost");
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
    private final boolean panel;
    private final int[] origin=new int[2], position=new int[2];
    public LiquidGlassDockView(Context context,ContentBackdrop backdrop,View anchor){this(context,backdrop,anchor,false);}
    public LiquidGlassDockView(Context context,ContentBackdrop backdrop,View anchor,boolean panel){
        super(context);this.backdrop=backdrop;this.anchor=anchor;this.panel=panel;
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }
    @Override protected void onDraw(Canvas canvas){
        if(anchor.getVisibility()!=VISIBLE || anchor.getWidth()<=0 || anchor.getHeight()<=0) return;
        getLocationInWindow(origin);anchor.getLocationInWindow(position);
        float x=position[0]-origin[0],y=position[1]-origin[1];
        float d=getResources().getDisplayMetrics().density, r=(panel?32:28)*d;
        int w=anchor.getWidth(),h=anchor.getHeight();
        RectF rect=new RectF(x,y,x+w,y+h);
        int saved=canvas.save();
        Path clip=new Path();clip.addRoundRect(rect,r,r,Path.Direction.CW);canvas.clipPath(clip);
        if(canvas.isHardwareAccelerated()){
            frost.setPosition((int)x,(int)y,(int)x+w,(int)y+h);
            RecordingCanvas c=frost.beginRecording(w,h);
            try{c.translate(-x,-y);backdrop.draw(c);}finally{frost.endRecording();}
            frost.setRenderEffect(RenderEffect.createBlurEffect((panel?8.5f:9.1f)*d,(panel?8.5f:9.1f)*d,Shader.TileMode.CLAMP));
            canvas.drawRenderNode(frost);
        }
        if(panel) paint.setShader(new LinearGradient(x,y,x,y+h,new int[]{0x9effffff,0x8affffff},null,Shader.TileMode.CLAMP));
        else paint.setColor(canvas.isHardwareAccelerated()?0x80fffefb:0xdbfffefb);
        canvas.drawRoundRect(rect,r,r,paint);paint.setShader(null);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(panel?d*.75f:d);
        paint.setColor(panel?0x4dffffff:0xc8ffffff);
        float inset=paint.getStrokeWidth()*.5f;
        canvas.drawRoundRect(new RectF(x+inset,y+inset,x+w-inset,y+h-inset),r-inset,r-inset,paint);
        paint.setStyle(Paint.Style.FILL);canvas.restoreToCount(saved);
    }
    @Override protected void onDetachedFromWindow(){frost.discardDisplayList();super.onDetachedFromWindow();}
}
