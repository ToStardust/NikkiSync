package app.nikkisync.mobile.model;

import java.util.List;

public final class Models {
    private Models() {}

    public static final class PairingPayload {
        private final String serverId, host, token, expiresAt, tlsFingerprintSha256;
        private final int port, protocolVersion;
        public PairingPayload(String serverId, String host, int port, String token, int protocolVersion, String expiresAt, String tlsFingerprintSha256) {
            this.serverId = serverId; this.host = host; this.port = port; this.token = token;
            this.protocolVersion = protocolVersion; this.expiresAt = expiresAt; this.tlsFingerprintSha256 = tlsFingerprintSha256;
        }
        public String serverId() { return serverId; }
        public String host() { return host; }
        public int port() { return port; }
        public String token() { return token; }
        public int protocolVersion() { return protocolVersion; }
        public String expiresAt() { return expiresAt; }
        public String tlsFingerprintSha256() { return tlsFingerprintSha256; }
    }

    public static final class PairedServer {
        private final String serverId, serverName, host, tlsFingerprintSha256, serverPublicKey, deviceCredential;
        private final int port;
        private final long lastRevision;
        public PairedServer(String serverId, String serverName, String host, int port, String tlsFingerprintSha256,
                            String serverPublicKey, String deviceCredential, long lastRevision) {
            this.serverId = serverId; this.serverName = serverName; this.host = host; this.port = port;
            this.tlsFingerprintSha256 = tlsFingerprintSha256; this.serverPublicKey = serverPublicKey;
            this.deviceCredential = deviceCredential; this.lastRevision = lastRevision;
        }
        public String serverId() { return serverId; }
        public String serverName() { return serverName; }
        public String host() { return host; }
        public int port() { return port; }
        public String tlsFingerprintSha256() { return tlsFingerprintSha256; }
        public String serverPublicKey() { return serverPublicKey; }
        public String deviceCredential() { return deviceCredential; }
        public long lastRevision() { return lastRevision; }
        public PairedServer withEndpoint(String newHost, int newPort) {
            return new PairedServer(serverId, serverName, newHost, newPort, tlsFingerprintSha256, serverPublicKey, deviceCredential, lastRevision);
        }
        public PairedServer withRevision(long revision) {
            return new PairedServer(serverId, serverName, host, port, tlsFingerprintSha256, serverPublicKey, deviceCredential, revision);
        }
    }

    public static final class AssetSummary {
        private final String assetId, type, state, capturedAt, uid, thumbnailResourceId, previewResourceId;
        private final String gameVersion, gameVersionSource;
        private final long revision;
        private final Integer width, height;
        private final boolean hasMotion, hasMetadata;
        public AssetSummary(String assetId, String type, String state, String capturedAt, String uid, long revision,
                            Integer width, Integer height, boolean hasMotion, boolean hasMetadata,
                            String thumbnailResourceId, String previewResourceId,
                            String gameVersion, String gameVersionSource) {
            this.assetId = assetId; this.type = type; this.state = state; this.capturedAt = capturedAt; this.uid = uid;
            this.revision = revision; this.width = width; this.height = height; this.hasMotion = hasMotion;
            this.hasMetadata = hasMetadata; this.thumbnailResourceId = thumbnailResourceId; this.previewResourceId = previewResourceId;
            this.gameVersion = gameVersion; this.gameVersionSource = gameVersionSource;
        }
        public String assetId() { return assetId; }
        public String type() { return type; }
        public String state() { return state; }
        public String capturedAt() { return capturedAt; }
        public String uid() { return uid; }
        public long revision() { return revision; }
        public Integer width() { return width; }
        public Integer height() { return height; }
        public boolean hasMotion() { return hasMotion; }
        public boolean hasMetadata() { return hasMetadata; }
        public String thumbnailResourceId() { return thumbnailResourceId; }
        public String previewResourceId() { return previewResourceId; }
        public String gameVersion() { return gameVersion; }
        public String gameVersionSource() { return gameVersionSource; }
    }

    public static final class AssetPage {
        private final List<AssetSummary> items;
        private final String nextCursor;
        private final long libraryRevision;
        public AssetPage(List<AssetSummary> items, String nextCursor, long libraryRevision) {
            this.items = items; this.nextCursor = nextCursor; this.libraryRevision = libraryRevision;
        }
        public List<AssetSummary> items() { return items; }
        public String nextCursor() { return nextCursor; }
        public long libraryRevision() { return libraryRevision; }
    }

    public static final class MediaResource {
        private final String resourceId, role, fileName, mimeType, fileExt, sha256;
        private final long sizeBytes;
        private final Integer width, height;
        private final Long durationMs;
        public MediaResource(String resourceId, String role, String fileName, String mimeType, String fileExt,
                             long sizeBytes, String sha256, Integer width, Integer height, Long durationMs) {
            this.resourceId = resourceId; this.role = role; this.fileName = fileName; this.mimeType = mimeType;
            this.fileExt = fileExt; this.sizeBytes = sizeBytes; this.sha256 = sha256; this.width = width;
            this.height = height; this.durationMs = durationMs;
        }
        public String resourceId() { return resourceId; }
        public String role() { return role; }
        public String fileName() { return fileName; }
        public String mimeType() { return mimeType; }
        public String fileExt() { return fileExt; }
        public long sizeBytes() { return sizeBytes; }
        public String sha256() { return sha256; }
        public Integer width() { return width; }
        public Integer height() { return height; }
        public Long durationMs() { return durationMs; }
    }

    public static final class AssetDetail {
        private final String assetId, type, state;
        private final List<MediaResource> resources;
        private final boolean hasMotion;
        private final String motionStillResourceId, motionResourceId;
        private final Long presentationTimestampUs;
        private final String metadataJson;
        public AssetDetail(String assetId, String type, String state, List<MediaResource> resources, boolean hasMotion,
                           String motionStillResourceId, String motionResourceId, Long presentationTimestampUs, String metadataJson) {
            this.assetId = assetId; this.type = type; this.state = state; this.resources = resources; this.hasMotion = hasMotion;
            this.motionStillResourceId = motionStillResourceId; this.motionResourceId = motionResourceId;
            this.presentationTimestampUs = presentationTimestampUs;
            this.metadataJson = metadataJson;
        }
        public String assetId() { return assetId; }
        public String type() { return type; }
        public String state() { return state; }
        public List<MediaResource> resources() { return resources; }
        public boolean hasMotion() { return hasMotion; }
        public String motionStillResourceId() { return motionStillResourceId; }
        public String motionResourceId() { return motionResourceId; }
        public Long presentationTimestampUs() { return presentationTimestampUs; }
        public String metadataJson() { return metadataJson; }
        public MediaResource originalStill() {
            for (MediaResource resource : resources) if ("source_high_quality".equals(resource.role())) return resource;
            for (MediaResource resource : resources) if ("source_primary".equals(resource.role())) return resource;
            return null;
        }
        public MediaResource motionResource() {
            if (motionResourceId != null) for (MediaResource resource : resources) if (motionResourceId.equals(resource.resourceId())) return resource;
            for (MediaResource resource : resources) if ("source_motion".equals(resource.role())) return resource;
            return null;
        }
    }

    public static final class Change {
        private final long revision;
        private final String type, assetId, occurredAt;
        public Change(long revision, String type, String assetId, String occurredAt) {
            this.revision = revision; this.type = type; this.assetId = assetId; this.occurredAt = occurredAt;
        }
        public long revision() { return revision; }
        public String type() { return type; }
        public String assetId() { return assetId; }
        public String occurredAt() { return occurredAt; }
    }

    public static final class Changes {
        private final List<Change> items;
        private final long libraryRevision;
        private final boolean fullResyncRequired;
        public Changes(List<Change> items, long libraryRevision, boolean fullResyncRequired) {
            this.items = items; this.libraryRevision = libraryRevision; this.fullResyncRequired = fullResyncRequired;
        }
        public List<Change> items() { return items; }
        public long libraryRevision() { return libraryRevision; }
        public boolean fullResyncRequired() { return fullResyncRequired; }
    }
}
