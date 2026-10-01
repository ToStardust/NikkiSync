# Remote Bridge Phase 1 progress (2026-09-29)

Historical baseline. For the subsequent PC UI, startup composition, security checks and verification, read `PHASE1_PC_UI_PROGRESS_2026-10-02.md`; Mini Program/iPhone acceptance is still pending.

Source handoff: `CODEX_HANDOFF_2026-09-29.md` on `feature/outfit-inspiration`.

Implemented locally:

- In-memory 10-minute sessions with 256-bit random bearer tokens stored as hashes, explicit close, and `created` / `connected` / `expired` / `closed` states.
- Explicit selection of 1–100 NikkiSync-managed, ready, stable JPG/PNG source resources. The public resource list omits local paths and metadata.
- Separate `/remote/session/{id}/assets` and `/remote/session/{id}/resource/{resourceId}` GET routes, token header authentication, HEAD and single-range download support, and distinct invalid/expired/not-found errors.
- Remote routes are optional and cannot mount on `LocalSyncServer` without TLS. They are not configured by the current PC startup, so this work does not open a new endpoint or share photos by default.

Verification: `npm test -- --runInBand` passed 82/82; focused Remote Bridge tests passed 3/3. Tests cover selection, wrong token, modified session ID, expiry, close, full/range transfer, HEAD, missing source file, and no-TLS rejection. No actual network exposure, QR UI, Mini Program, or iPhone acceptance was performed.

Still required before Phase 1 can be called usable:

1. A PC UI for explicit resource selection and session creation/closing, with a real QR payload containing a reachable endpoint.
2. A production-compatible WeChat Mini Program network route and trusted certificate strategy. The existing PC TLS identity is locally generated; do not assume a released Mini Program can fetch `https://<LAN-IP>:<port>` or trust that certificate. Do not replace this with a photo-storing cloud service without explicit user approval.
3. End-to-end validation on a released/test Mini Program and an iPhone, including preview, save-to-album authorization, expiry, and cancellation.

The pre-existing local edit to `tools/sample-analyzer/analyze.mjs` is unrelated and was preserved.

