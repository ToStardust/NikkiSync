package app.nikkisync.mobile.net;

/** Safe UI categories only: never expose URLs, request signatures or server response bodies. */
public enum ConnectionFailure {
    UNREACHABLE, PAIRING_REJECTED, CERTIFICATE_CHANGED;

    public static ConnectionFailure from(Throwable error) {
        for(int depth=0;error!=null&&depth<8;depth++,error=error.getCause()) {
            if(error instanceof SignedHttpClient.HttpStatusException status&&(status.status==401||status.status==403))return PAIRING_REJECTED;
            if(error instanceof javax.net.ssl.SSLPeerUnverifiedException
                    ||error instanceof java.security.cert.CertificateException)return CERTIFICATE_CHANGED;
        }
        return UNREACHABLE;
    }
    public boolean requiresPairing(){return this!=UNREACHABLE;}
    public String message(){return this==PAIRING_REJECTED?"电脑已拒绝原配对 · 请重新扫码配对":
            this==CERTIFICATE_CHANGED?"电脑证书与原配对不符 · 请确认电脑后重新配对":"电脑暂不可达 · 正在自动重试";}
}
