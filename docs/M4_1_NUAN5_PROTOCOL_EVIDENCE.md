# M4.1 NUAN5-compatible Resolver — 协议证据与交接

Last updated: 2026-09-03

## Public-source evidence

Protocol facts were read from current public SpinningMomo main-branch sources as an interoperability reference only; no GPL implementation code is copied into NikkiSync.

- [`scan.cpp`](https://github.com/ChanIok/SpinningMomo/blob/main/src/extensions/infinity_nikki/photo_extract/scan.cpp)
- [`infra.cpp`](https://github.com/ChanIok/SpinningMomo/blob/main/src/extensions/infinity_nikki/photo_extract/infra.cpp)

Confirmed contract:

```text
POST https://nuan5.pro/api/decode-photo2
Content-Type: application/json
X-Client: SpinningMomo

{
  "photos": { "<uid>": [["<jpeg-prefix-md5>", "<encoded-tuple>"]] },
  "raw_data": true,
  "raw_id": true
}
```

`encoded-tuple` is Base64 of the concatenated decoded final segment and decoded preceding parameter segment; it is not the preceding envelope text verbatim. For current non-V2 samples, `jpeg-prefix-md5` is lowercase MD5 over local JPEG bytes before the final metadata-delimiter EOI. The reference also supports a `[V2]N` suffix that changes the hash window to the final `N` bytes before that EOI. NikkiSync currently supports its scanner-verified 44-character Base64 trailing form only; do not claim `[V2]` support without samples and a dedicated test.

The response is `[uid, items]`; an item is either an error string or a decoded object containing fields such as `focal`, `apeture`, filter/light values, camera adjustments, `raw.time`, `raw.pos`, `clothes` and optional DIY data.

## NikkiSync state

- Scanner derives and persists PC-only `raw.nativeParamNuan5Md5`; source media bytes are neither stored nor uploaded.
- `Nuan5CompatibleResolver` builds the verified tuple and maps confirmed values into `InfinityPhotoMetadata`; provider-specific data is placed in `metadata.raw.nuan5`.
- `nativeParamPayload` and `nativeParamNuan5Md5` are both redacted from LAN responses.
- Enable only explicitly via `%LOCALAPPDATA%\NikkiSync\metadata-resolver.json`:

```json
{
  "enabled": true,
  "provider": { "type": "nuan5-compatible", "version": "2026.09" }
}
```

No provider is enabled by default and no batch sweep exists.

## Verification and E2E status

Local tests cover JPEG-prefix MD5, SQLite persistence, exact request JSON, tuple construction, response mapping, opt-in config and LAN redaction. They use a local HTTP server; no game media leaves the PC.

On 2026-09-03, the user explicitly authorized exactly one request to `https://nuan5.pro/api/decode-photo2`. The selected real asset was `asset_21aa2ad824a1937002a1f6eaed1af6e0` (UID `100826934`), with a 47,576-character envelope, a 44-character trailing segment and a locally derived MD5. The provider returned a successful decoded record, which the adapter mapped to focal length `15.5`, aperture section `16`, brightness/exposure/contrast/saturation/vibrance/highlights/shadows, vignette and bloom controls, game time, world coordinates and 14 clothing IDs. This is a real single-photo resolver E2E success.

The request contained only UID, NUAN5 tuple and MD5. It did not contain JPEG/MP4 bytes, thumbnails or local paths. No second photo and no batch request was made. Do not use this one-off validation to enable automatic batch parsing.
