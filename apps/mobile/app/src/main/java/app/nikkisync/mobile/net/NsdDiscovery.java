package app.nikkisync.mobile.net;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;

import java.nio.charset.StandardCharsets;
import java.util.Map;

public final class NsdDiscovery {
    public interface Listener {
        void onEndpoint(String serverId, String host, int port);
        void onDiscoveryState(boolean active);
    }

    private static final String SERVICE_TYPE = "_nikkisync._tcp.";
    private final NsdManager nsd;
    private final WifiManager.MulticastLock multicastLock;
    private final Listener listener;
    private boolean running;

    public NsdDiscovery(Context context, Listener listener) {
        this.nsd = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        WifiManager wifi = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        this.multicastLock = wifi.createMulticastLock("nikkisync-mdns");
        this.multicastLock.setReferenceCounted(false);
        this.listener = listener;
    }

    public void start() {
        if (running) return;
        running = true;
        try { multicastLock.acquire(); } catch (Exception ignored) {}
        nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener);
    }

    public void stop() {
        if (!running) return;
        running = false;
        try { nsd.stopServiceDiscovery(discoveryListener); } catch (Exception ignored) {}
        try { if (multicastLock.isHeld()) multicastLock.release(); } catch (Exception ignored) {}
        listener.onDiscoveryState(false);
    }

    private final NsdManager.DiscoveryListener discoveryListener = new NsdManager.DiscoveryListener() {
        @Override public void onDiscoveryStarted(String serviceType) { listener.onDiscoveryState(true); }
        @Override public void onDiscoveryStopped(String serviceType) { listener.onDiscoveryState(false); }
        @Override public void onStartDiscoveryFailed(String serviceType, int errorCode) { listener.onDiscoveryState(false); }
        @Override public void onStopDiscoveryFailed(String serviceType, int errorCode) { listener.onDiscoveryState(false); }
        @Override public void onServiceLost(NsdServiceInfo serviceInfo) {}

        @Override public void onServiceFound(NsdServiceInfo serviceInfo) {
            if (!SERVICE_TYPE.equals(serviceInfo.getServiceType())) return;
            try {
                nsd.resolveService(serviceInfo, new NsdManager.ResolveListener() {
                    @Override public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {}

                    @Override public void onServiceResolved(NsdServiceInfo resolved) {
                        String serverId = attribute(resolved.getAttributes(), "serverId");
                        if (serverId == null || resolved.getHost() == null || resolved.getPort() <= 0) return;
                        listener.onEndpoint(serverId, resolved.getHost().getHostAddress(), resolved.getPort());
                    }
                });
            } catch (Exception ignored) {}
        }
    };

    private static String attribute(Map<String, byte[]> attributes, String key) {
        byte[] value = attributes.get(key);
        return value == null ? null : new String(value, StandardCharsets.UTF_8);
    }
}
