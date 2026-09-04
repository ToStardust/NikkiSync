package app.nikkisync.mobile;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.ResultPoint;
import com.journeyapps.barcodescanner.BarcodeCallback;
import com.journeyapps.barcodescanner.BarcodeResult;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;
import com.journeyapps.barcodescanner.DefaultDecoderFactory;
import com.journeyapps.barcodescanner.camera.CameraSettings;
import java.util.Collections;
import java.util.List;

public final class PairQrScannerActivity extends Activity {
    public static final String EXTRA_PAIRING_URI = "pairingUri";
    private DecoratedBarcodeView scanner;
    private boolean completed;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        scanner = new DecoratedBarcodeView(this);
        CameraSettings cameraSettings = new CameraSettings(); cameraSettings.setAutoFocusEnabled(true); scanner.getBarcodeView().setCameraSettings(cameraSettings);
        scanner.getBarcodeView().setDecoderFactory(new DefaultDecoderFactory(Collections.singletonList(BarcodeFormat.QR_CODE)));
        scanner.setStatusText("");
        FrameLayout root = new FrameLayout(this); root.addView(scanner, new FrameLayout.LayoutParams(-1, -1));
        TextView hint = new TextView(this); hint.setText("将电脑上的配对二维码放入框内\n仅首次配对需要扫描"); hint.setTextSize(16); hint.setGravity(Gravity.CENTER); hint.setTextColor(0xffffffff); hint.setBackgroundColor(0x99000000); hint.setPadding(24,20,24,20);
        root.addView(hint, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM)); setContentView(root);
        scanner.decodeContinuous(new BarcodeCallback() {
            @Override public void barcodeResult(BarcodeResult result) {
                if (completed || result == null) return; String text = result.getText();
                if (text == null || !(text.startsWith("NS1|") || text.startsWith("nikki-sync://pair?"))) { Toast.makeText(PairQrScannerActivity.this, "这不是 NikkiSync 配对二维码", Toast.LENGTH_SHORT).show(); return; }
                completed = true; scanner.pauseAndWait(); setResult(RESULT_OK, new Intent().putExtra(EXTRA_PAIRING_URI, text)); finish();
            }
            @Override public void possibleResultPoints(List<ResultPoint> resultPoints) {}
        });
    }
    @Override protected void onResume() { super.onResume(); scanner.resume(); }
    @Override protected void onPause() { scanner.pause(); super.onPause(); }
}
