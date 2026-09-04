package app.nikkisync.mobile.net;

import app.nikkisync.mobile.model.Models.PairedServer;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;

import javax.net.ssl.SSLSocket;

public final class RealtimeWebSocket {
    public interface Listener {
        void onText(String json);
        void onConnectionState(boolean connected);
    }

    private final SignedHttpClient http;
    private final PairedServer server;
    private final Listener listener;
    private final SecureRandom random = new SecureRandom();
    private volatile boolean running;
    private volatile SSLSocket socket;
    private Thread thread;

    public RealtimeWebSocket(SignedHttpClient http, PairedServer server, Listener listener) {
        this.http = http;
        this.server = server;
        this.listener = listener;
    }

    public void start() {
        if (running) return;
        running = true;
        thread = new Thread(this::loop, "NikkiSync-WebSocket");
        thread.start();
    }

    public void stop() {
        running = false;
        SSLSocket current = socket;
        socket = null;
        if (current != null) try { current.close(); } catch (Exception ignored) {}
        if (thread != null) thread.interrupt();
        listener.onConnectionState(false);
    }

    private void loop() {
        long retry = 1_000;
        while (running) {
            try {
                connectAndRead();
                retry = 1_000;
            } catch (Exception ignored) {
                listener.onConnectionState(false);
                if (!running) break;
                try { Thread.sleep(retry); } catch (InterruptedException ignoredSleep) {}
                retry = Math.min(10_000, retry * 2);
            }
        }
    }

    private void connectAndRead() throws Exception {
        SSLSocket current = (SSLSocket) http.tls().socketFactory().createSocket(server.host(), server.port());
        socket = current;
        current.setSoTimeout(0);
        current.startHandshake();
        byte[] keyBytes = new byte[16]; random.nextBytes(keyBytes);
        String key = Base64.getEncoder().encodeToString(keyBytes);
        Map<String, String> auth = http.authHeaders("GET", "/ws/v1", new byte[0]);
        String hostHeader = server.host().contains(":") ? "[" + server.host() + "]:" + server.port() : server.host() + ":" + server.port();
        StringBuilder request = new StringBuilder()
                .append("GET /ws/v1 HTTP/1.1\r\n")
                .append("Host: ").append(hostHeader).append("\r\n")
                .append("Upgrade: websocket\r\n")
                .append("Connection: Upgrade\r\n")
                .append("Sec-WebSocket-Version: 13\r\n")
                .append("Sec-WebSocket-Key: ").append(key).append("\r\n");
        for (Map.Entry<String, String> header : auth.entrySet()) request.append(header.getKey()).append(": ").append(header.getValue()).append("\r\n");
        request.append("\r\n");
        OutputStream output = current.getOutputStream();
        output.write(request.toString().getBytes(StandardCharsets.US_ASCII)); output.flush();
        BufferedInputStream input = new BufferedInputStream(current.getInputStream());
        String response = readHttpHead(input);
        if (!response.startsWith("HTTP/1.1 101")) throw new IllegalStateException("WebSocket upgrade rejected");
        listener.onConnectionState(true);
        while (running && !current.isClosed()) {
            String text = readTextFrame(input);
            if (text != null) listener.onText(text);
        }
    }

    private static String readHttpHead(InputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        int state = 0;
        while (output.size() < 16 * 1024) {
            int value = input.read(); if (value < 0) throw new EOFException(); output.write(value);
            if (state == 0) state = value == '\r' ? 1 : 0;
            else if (state == 1) state = value == '\n' ? 2 : 0;
            else if (state == 2) state = value == '\r' ? 3 : 0;
            else if (state == 3) state = value == '\n' ? 4 : 0;
            if (state == 4) return new String(output.toByteArray(), StandardCharsets.US_ASCII);
        }
        throw new IllegalStateException("WebSocket response headers too large");
    }

    private static String readTextFrame(InputStream input) throws Exception {
        int first = input.read(); if (first < 0) throw new EOFException();
        int second = input.read(); if (second < 0) throw new EOFException();
        int opcode = first & 0x0f;
        long length = second & 0x7f;
        if (length == 126) length = ((long) readByte(input) << 8) | readByte(input);
        else if (length == 127) {
            length = 0;
            for (int i = 0; i < 8; i++) length = (length << 8) | readByte(input);
        }
        if (length > 2 * 1024 * 1024) throw new IllegalStateException("WebSocket frame too large");
        byte[] payload = readExactly(input, (int) length);
        if (payload.length != length) throw new EOFException();
        if (opcode == 0x8) throw new EOFException();
        if (opcode != 0x1) return null;
        return new String(payload, StandardCharsets.UTF_8);
    }

    private static int readByte(InputStream input) throws Exception {
        int value = input.read(); if (value < 0) throw new EOFException(); return value;
    }

    private static byte[] readExactly(InputStream input, int length) throws Exception {
        byte[] data = new byte[length]; int offset = 0;
        while (offset < length) {
            int read = input.read(data, offset, length - offset);
            if (read < 0) throw new EOFException();
            offset += read;
        }
        return data;
    }
}
