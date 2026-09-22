package app.nikkisync.mobile.share;

import android.content.Context;
import android.net.Uri;

import app.nikkisync.mobile.model.Models.AssetSummary;
import app.nikkisync.mobile.net.NikkiSyncClient;

import java.util.Objects;
import java.util.concurrent.Executor;

/**
 * Presentation boundary for share-card work. MainActivity owns UI state only; payload construction,
 * background loading, rendering and MediaStore writes stay behind this coordinator.
 */
public final class ShareCardExportCoordinator {
    public interface Listener {
        void onSuccess(Uri uri);
        void onFailure(Exception error);
    }

    private final Context context;
    private final Executor worker;
    private final Executor callbackExecutor;

    public ShareCardExportCoordinator(Context context, Executor worker, Executor callbackExecutor) {
        this.context = Objects.requireNonNull(context).getApplicationContext();
        this.worker = Objects.requireNonNull(worker);
        this.callbackExecutor = Objects.requireNonNull(callbackExecutor);
    }

    public void exportRemote(
            NikkiSyncClient client,
            AssetSummary asset,
            String metadataJson,
            Listener listener
    ) {
        Objects.requireNonNull(listener);
        worker.execute(() -> {
            try {
                ShareCardPayload payload = ShareCardPayloadBuilder.build(
                        asset.assetId(),
                        asset.capturedAt(),
                        asset.gameVersion(),
                        metadataJson
                );
                Uri uri = ShareCardExporter.export(context, client, asset, payload);
                callbackExecutor.execute(() -> listener.onSuccess(uri));
            } catch (Exception error) {
                callbackExecutor.execute(() -> listener.onFailure(error));
            }
        });
    }

    public void exportLocal(
            Uri backgroundUri,
            String assetId,
            String capturedAt,
            String gameVersion,
            String metadataJson,
            Listener listener
    ) {
        Objects.requireNonNull(listener);
        worker.execute(() -> {
            try {
                ShareCardPayload payload = ShareCardPayloadBuilder.build(
                        assetId,
                        capturedAt,
                        gameVersion,
                        metadataJson
                );
                Uri uri = ShareCardExporter.export(context, backgroundUri, assetId, payload);
                callbackExecutor.execute(() -> listener.onSuccess(uri));
            } catch (Exception error) {
                callbackExecutor.execute(() -> listener.onFailure(error));
            }
        });
    }
}
