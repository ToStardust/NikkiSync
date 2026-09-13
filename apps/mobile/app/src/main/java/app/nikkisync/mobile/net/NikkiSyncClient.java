package app.nikkisync.mobile.net;

import android.os.Build;

import app.nikkisync.mobile.BuildConfig;
import app.nikkisync.mobile.model.Models.AssetDetail;
import app.nikkisync.mobile.model.Models.AssetPage;
import app.nikkisync.mobile.model.Models.Changes;
import app.nikkisync.mobile.model.Models.PairedServer;
import app.nikkisync.mobile.model.Models.PairingPayload;
import app.nikkisync.mobile.model.Models.SuitSearchResponse;
import app.nikkisync.mobile.protocol.JsonCodec;
import app.nikkisync.mobile.security.DeviceIdentity;

import org.json.JSONObject;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

import javax.net.ssl.HttpsURLConnection;

public final class NikkiSyncClient {
    private final PairedServer server;
    private final SignedHttpClient http;

    public NikkiSyncClient(PairedServer server, DeviceIdentity identity) throws Exception {
        this.server = server;
        this.http = new SignedHttpClient(server, identity);
    }

    public static PairedServer pair(PairingPayload payload, DeviceIdentity identity) throws Exception {
        PairedServer provisional = new PairedServer(payload.serverId(), "NikkiSync PC", payload.host(), payload.port(),
                payload.tlsFingerprintSha256(), "", "", 0);
        SignedHttpClient http = new SignedHttpClient(provisional, identity);
        JSONObject device = new JSONObject()
                .put("deviceId", identity.deviceId())
                .put("deviceName", Build.MANUFACTURER + " " + Build.MODEL)
                .put("platform", "android")
                .put("publicKey", identity.publicKeyBase64Url())
                .put("appVersion", BuildConfig.VERSION_NAME);
        byte[] body = new JSONObject().put("pairingToken", payload.token()).put("device", device)
                .toString().getBytes(StandardCharsets.UTF_8);
        HttpsURLConnection connection = http.open("POST", "/v1/pair", body, false);
        JSONObject response = new JSONObject(SignedHttpClient.readUtf8(connection));
        if (!payload.serverId().equals(response.getString("serverId"))) {
            throw new SecurityException("PC identity changed during pairing");
        }
        return new PairedServer(
                response.getString("serverId"), response.getString("serverName"), payload.host(), payload.port(),
                payload.tlsFingerprintSha256(), response.getString("serverPublicKey"),
                response.getString("deviceCredential"), 0
        );
    }

    public AssetPage assets(String cursor, int limit) throws Exception {
        String path = "/v1/assets?limit=" + limit;
        if (cursor != null) path += "&cursor=" + encode(cursor);
        return JsonCodec.assetPage(http.json("GET", path));
    }

    public AssetDetail asset(String assetId) throws Exception {
        return JsonCodec.assetDetail(http.json("GET", "/v1/assets/" + encode(assetId)));
    }

    public AssetDetail updateMetadata(String assetId, JSONObject patch) throws Exception {
        byte[] body = patch.toString().getBytes(StandardCharsets.UTF_8);
        HttpsURLConnection connection = http.open("PATCH", "/v1/assets/" + encode(assetId) + "/metadata", body, true);
        return JsonCodec.assetDetail(SignedHttpClient.readUtf8(connection));
    }

    public SuitSearchResponse searchSuits(String query) throws Exception {
        return JsonCodec.suitSearch(http.json("GET", "/v1/search/suits?q=" + encode(query)));
    }

    public Changes changes(long after) throws Exception {
        return JsonCodec.changes(http.json("GET", "/v1/changes?after=" + after));
    }

    public HttpsURLConnection resource(String assetId, String resourceId) throws Exception {
        return http.resource("/v1/assets/" + encode(assetId) + "/resources/" + encode(resourceId));
    }

    public HttpsURLConnection clothingThumbnail(String assetId, String clothingId) throws Exception {
        return http.resource("/v1/assets/" + encode(assetId) + "/clothing/" + encode(clothingId) + "/thumbnail");
    }

    public SignedHttpClient signedHttp() { return http; }
    public PairedServer server() { return server; }

    private static String encode(String value) {
        try { return URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20"); }
        catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }
}
