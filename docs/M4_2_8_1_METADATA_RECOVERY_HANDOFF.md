# M4.2.8.1 — Metadata Recovery Handoff

## Reported real-device symptom

After building the current `feature/m4-2-8-clothing-detail` version, Android photo detail shows two different failure modes:

1. Photos from versions before 2.9:
   - `暖暖原生参数：已读取（待本地解码）`
   - `NikkiSync 参数：暂无`
2. Photos from game version 2.9:
   - `暖暖原生参数：未检测到`

Treat these as two separate bugs at different stages of the pipeline.

---

## Bug A — pre-2.9 native data is scanned but never resolved

### Confirmed root cause

The packaged Windows app does **not** instantiate a metadata resolver on a clean install unless one of these exists:

- `%LOCALAPPDATA%\NikkiSync\metadata-resolver.json` with a valid provider; or
- `NIKKISYNC_METADATA_RESOLVER_URL`.

Current `windows-app.ts` effectively does:

```ts
const fileResolver = createMetadataResolverFromConfig(resolverFile)
const resolver = resolverFile?.enabled === false
  ? undefined
  : fileResolver ?? environmentResolver
```

If both config and environment fallback are absent, `resolver` is `undefined`, so `PcCompanionRuntime` receives no `metadataResolver` service.

This exactly explains the observed state: scanner persisted `nativeParamToken` / payload, Android sees the native token, but no resolver ever produces canonical camera/filter/lighting/dressing metadata.

`Nuan5CompatibleResolver` already has a default endpoint:

```text
https://nuan5.pro/api/decode-photo2
```

Networking is allowed for this project. The user explicitly does not require offline-only behavior.

### Required fix

Make the known NUAN5-compatible resolver the clean-install default while retaining explicit user/config override semantics.

Desired precedence:

```text
metadata-resolver.json enabled:false
    -> resolver disabled

valid metadata-resolver.json provider(s)
    -> use configured provider/pipeline

NIKKISYNC_METADATA_RESOLVER_URL
    -> use environment remote-json provider

none of the above
    -> use new Nuan5CompatibleResolver()
```

Do **not** remove hot-config support.

Do **not** force NUAN5 when config explicitly says `enabled:false`.

### TDD requirement

Before changing production selection logic, add a focused test that proves a clean-install/no-config composition selects `nuan5-compatible`, and an explicit `enabled:false` still selects no resolver.

Prefer extracting resolver composition into a small pure helper if that makes the startup behavior testable without starting the full Windows app.

Run the focused test RED, implement the minimal change, then GREEN, then full regression.

### Existing unresolved assets

After enabling the resolver, confirm existing rows that already contain UID + native token/payload are eligible for `MetadataResolverService.listMetadataResolutionCandidates` and resolve after restart without requiring users to delete their database.

If failed-state retry timing prevents immediate recovery from a previous attempt, make a bounded migration/retry decision. Do not wipe user metadata or the entire SQLite database.

---

## Bug B — 2.9 photos are rejected before resolver stage

### Confirmed current limitation

`ResourceClassifier.nativePhotoEnvelope()` currently assumes the exact old trailer layout:

```text
... JPEG/custom payload ...
FFD9
<44 ASCII chars: standard Base64, exactly 32 decoded bytes>
EOF
```

More specifically it reads exactly the final 46 bytes and requires:

```ts
last46[0..2] === FF D9
last46[2..46] matches /^[A-Za-z0-9+/]{43}=$/
Base64 decode length === 32
```

Then it assumes the payload is printable ASCII Base64 between the previous `FFD9` and that final delimiter.

The current scanner tests cover only synthetic fixtures matching this old shape. There is no real 2.9 trailer fixture.

Because the user's 2.9 photos show `暖暖原生参数：未检测到`, failure occurs at or before this scanner extraction stage, not in NUAN5 resolution.

### Upstream evidence

Current `RanAxro/nikki_albums` still decodes Infinity Nikki album parameters through its media decoder using `FFD9` as the image marker for `NikkiPhoto`, rather than NikkiSync's exact final-46-byte wrapper assumption.

Its game-2.9 repository update (`c32be4efbcb86f34c5b9ccd3ec4360dad8ab9d0c`, `[update] 更新HotUpdate api至游戏版本2.9`) changed hot-update language/database version IDs only and did not modify the album decoder path.

This is evidence that NikkiSync's exact EOF/trailer assumption is likely too restrictive. It is **not** permission to guess a replacement format.

---

## Mandatory local evidence collection for 2.9

Use the user's real local Infinity Nikki HQ JPEGs. This is a local-only inspection; do not upload source photos or embedded payload values anywhere.

Compare at least:

- one known pre-2.9 photo that NikkiSync currently reports as `原生参数：已读取`;
- one 2.9 photo that NikkiSync currently reports as `未检测到`.

If identifying one exact sample is ambiguous, inspect a small set of newest HQ JPEGs and a small set of older known-good HQ JPEGs.

Create a temporary diagnostic script/tool (or extend sample-analyzer) that prints **structure only**, never the complete embedded token/payload.

For each sample report:

```text
path basename only
file size
SHA256 of whole file (optional/local report)
number and relative offsets-from-EOF of FFD9 markers in the last 64 KiB
bytes after the final FFD9
bytes between the final two FFD9 markers
ASCII-run candidates in the last 64 KiB:
  relative offset
  run length
  alphabet class: standard-base64 / base64url / printable-other
  padding count
  decoded byte length if valid
SHA256 of each candidate run (do not print candidate contents)
```

Do not print:

- UID directory value if avoidable;
- full token;
- full payload;
- decrypted photo params;
- JPEG image bytes.

The diagnostic's purpose is to answer one question with evidence:

> What exact structural assumption changed between a working pre-2.9 file and a failing 2.9 file?

Possible observations may include token position, extra trailer bytes, Base64URL alphabet, removed padding, a different token length, multiple custom blocks, etc. Do not assume any of these before inspecting the files.

---

## Fix Bug B only after evidence

Once the real 2.9 layout is known:

1. Add the smallest synthetic regression fixture reproducing that actual layout.
2. Verify the new test fails against the current `nativePhotoEnvelope()` implementation.
3. Modify extraction to support both the legacy layout and the evidenced 2.9 layout.
4. Preserve old pre-2.9 behavior.
5. Keep scanning bounded; do not load multi-megabyte JPEGs unnecessarily when a bounded tail scan is enough.
6. Preserve local-only source bytes. Only canonical metadata / existing hashes may leave PC according to existing resolver contract.
7. Recompute NUAN5 MD5 boundary according to the actual evidenced custom-data boundary; do not assume the previous `size - 46` boundary if 2.9 changed the trailer.
8. Verify both old and 2.9 fixtures pass.

Do not solve this by classifying every JPEG as having native params. False positives are worse than a clean `not detected` state.

---

## Bug C — public clothing dictionary is also disabled on clean install

### Confirmed current behavior

`MetadataDictionaryRemoteConfigFile.createMetadataDictionaryProviderFromConfig()` returns a provider only when:

```ts
config?.enabled === true
```

A clean install with no `%LOCALAPPDATA%\NikkiSync\metadata-dictionary-remote.json` therefore never starts `NikkiAlbumsMetadataDictionaryProvider`.

After Bug A is fixed, NUAN5 may produce raw clothing IDs but M4.2.7 name/category/thumbnail enrichment can still remain absent.

### Product intent

The user has explicitly allowed PC/Android networking and wants new clothes/metadata to appear after game updates without requiring a new APK/EXE.

For this recovery build, make the already-integrated `nikki-albums-public` dictionary the clean-install default, while retaining a real explicit disable option.

Suggested precedence:

```text
metadata-dictionary-remote.json enabled:false
    -> remote dictionary disabled

valid enabled custom config
    -> configured provider

missing config
    -> NikkiAlbumsMetadataDictionaryProvider({ locale: 'zh-CN' })
```

Do not send photo/UID/token/payload to this dictionary source. Its requests remain bodyless GETs for public dictionary packages only.

Add tests for the default/disable composition behavior before production changes.

---

## Android observability improvement

Current text `暖暖原生参数：已读取（待本地解码）` is misleading when the resolver is disabled or failed.

After the PC-side fixes, improve `metadataSummary()` minimally so `raw.resolver` state is visible when useful:

Examples:

```text
暖暖原生参数：已读取
NikkiSync 参数：解析中
```

```text
暖暖原生参数：已读取
NikkiSync 参数：解析失败
```

For failure, show a short human-readable reason or diagnostic status without exposing full resolver response/payload.

If canonical camera/filter/lighting/etc. exists, display it normally rather than a stale “待本地解码” status.

This observability change is secondary to fixing the resolver/scanner root causes.

---

## Verification sequence

After implementing Bug A/C and evidence-driven Bug B:

```powershell
npm run typecheck
npm test -- --runInBand
npm run mobile:validate
npm run mobile:build
npm run pc:exe
```

Then run a real local acceptance check with the current user's library:

### Pre-2.9 acceptance

Open one previously affected photo and verify:

```text
native params detected
resolver actually attempts/finishes
camera/filter/lighting metadata appears where present
clothing IDs are enriched with names/categories where dictionary contains them
```

### 2.9 acceptance

Open one real 2.9 photo and verify:

```text
native params detected
resolver gets the required input tuple
canonical metadata is populated
Android no longer says `原生参数：未检测到`
```

### Do not claim success based only on synthetic tests

This bug was discovered by real files after a build that compiled successfully. Final M4.2.8.1 acceptance therefore requires at least one real pre-2.9 file and one real 2.9 file.

---

## Packaging

Only after the above acceptance, rebuild the deliverables and report:

```text
branch
commit SHA
old-photo result
2.9-photo result
resolver provider/status
remote dictionary provider/status
npm typecheck result
npm test result
mobile validate result
APK path + SHA256
Windows release path
```

Keep changes on `feature/m4-2-8-clothing-detail` unless the user explicitly asks to merge `main`.
