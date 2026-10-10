package app.nikkisync.mobile.net;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Test;
import static org.junit.Assert.*;

public final class RealtimeWebSocketTest {
    @Test public void pingReceivesMaskedPongWithTheSamePayload() throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        assertNull(RealtimeWebSocket.readTextFrame(new ByteArrayInputStream(new byte[]{(byte) 0x89, 2, 7, 9}), output));
        byte[] pong = output.toByteArray();
        assertEquals(8, pong.length);
        assertEquals(0x8a, pong[0] & 255);
        assertEquals(0x82, pong[1] & 255);
        assertEquals(7, pong[6] ^ pong[2]);
        assertEquals(9, pong[7] ^ pong[3]);
    }

    @Test public void textFrameIsDeliveredUnchanged() throws Exception {
        byte[] text = "hello".getBytes(StandardCharsets.UTF_8);
        ByteArrayOutputStream frame = new ByteArrayOutputStream();
        frame.write(0x81); frame.write(text.length); frame.write(text);
        assertEquals("hello", RealtimeWebSocket.readTextFrame(new ByteArrayInputStream(frame.toByteArray()), new ByteArrayOutputStream()));
    }

    @Test public void handshakeRequiresMatchingAccept() throws Exception {
        String headers = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n";
        RealtimeWebSocket.validateUpgrade(headers, "dGhlIHNhbXBsZSBub25jZQ==");
        assertThrows(Exception.class, () -> RealtimeWebSocket.validateUpgrade(headers, "different-key"));
        assertThrows(Exception.class, () -> RealtimeWebSocket.validateUpgrade("HTTP/1.1 200 OK\r\n\r\n", "key"));
    }
}
