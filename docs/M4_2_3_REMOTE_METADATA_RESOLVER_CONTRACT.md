# M4.2.3 Remote Metadata Resolver Contract

## Purpose

Introduce an optional online metadata enrichment layer without changing the local-first architecture.

The PC client remains the owner of local scanning, SQLite storage and revision handling. Remote services only provide metadata enrichment.

## Data flow

```
Photo Scanner
    |
    v
Local Asset + MetadataResolverPipeline
    |
    +--> Local Resolver
    |
    +--> Dictionary Resolver
    |
    +--> Remote JSON Resolver (opt-in)
```

## Request

Endpoint receives JSON:

```json
{
  "uid": "player_uid",
  "params": "base64_native_parameter_payload",
  "token": "native_token",
  "md5": "payload_md5",
  "payloadFormat": "base64-envelope",
  "payloadDecodedBytes": 48000
}
```

Rules:

- Never upload original photo bytes.
- Never require Android app update for dictionary/provider changes.
- Provider must be explicitly enabled by local configuration.
- Unknown fields must be ignored for forward compatibility.

## Response

```json
{
  "version": "provider-version",
  "metadata": {
    "characterId": "...",
    "clothingIds": ["..."],
    "poseId": "...",
    "filterId": "...",
    "lightingId": "..."
  }
}
```

## Future Android role

Android remains a presentation/synchronization client. It consumes canonical metadata through the existing PC API and does not directly depend on the remote provider.

This keeps:

- EXE updates optional.
- APK updates optional.
- Metadata updates independent from binary releases.
