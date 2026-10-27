package app.nikkisync.mobile.net;
import org.junit.Test;
import static org.junit.Assert.*;
public class ConnectionFailureTest {
    @Test public void timeoutRetriesWithoutAskingToErasePairing(){
        assertFalse(ConnectionFailure.from(new java.net.SocketTimeoutException()).requiresPairing());
    }
    @Test public void rejectedIdentityAndChangedCertificateHaveDifferentSafeMessages(){
        assertEquals(ConnectionFailure.PAIRING_REJECTED,ConnectionFailure.from(new SignedHttpClient.HttpStatusException(401,"private response")));
        assertEquals(ConnectionFailure.CERTIFICATE_CHANGED,ConnectionFailure.from(new javax.net.ssl.SSLHandshakeException("failed"){ {initCause(new java.security.cert.CertificateException("private certificate"));} }));
        assertFalse(ConnectionFailure.PAIRING_REJECTED.message().contains("private response"));
    }
}
