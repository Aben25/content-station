# Firebase integration implementation plan

> Historical implementation plan. Its checkboxes record the original task breakdown, not current completion status. Firebase deployment and physical iPhone capture are now verified in [hosted verification](reports/hosted-verification.md). The later user authorization covered replacing the old cloud system. For current scope and the next self-hosted Postiz phase, read [HANDOFF-PLAN.md](../HANDOFF-PLAN.md); earlier deployment and publishing exclusions below describe the original phase only.

Goal: preserve the supplied v2 owner/wall design while a real uploaded MP4 flows through OpenShorts into private clips that the owner can play, share and delete.

User approved connecting the system and requested Firebase/Google instead of Supabase. The design ZIP matches the committed prototypes. Work is isolated on codex/connect-v2; main and the old engine checkout are not deployment targets.

## Architecture and constraints

- Firebase Authentication phone sign-in for the mobile owner website; Firebase ID tokens authenticate owner requests.
- Node TypeScript API, Firebase Admin, Firestore Standard SDK operations and private Cloud Storage. API deployed as a Google Cloud Run service when project setup is available. Local Auth/Firestore/Storage emulators first, with real persistence and media processing, not a fake API.
- New Firestore collection names start with cs2_; objects start with v2/. Direct client Firestore and Storage access denied. Owners access only their assigned shop through the API; roles and membership are server-managed.
- Keep docs/CONTRACT.md shapes/routes for wall and owner except Supabase authentication. API base is VITE_API_BASE_URL / CS_API_BASE_URL, no /functions/v1/api suffix automatically added. Keep legacy CS_SUPABASE_ANON_KEY optional for old builds, not required by Firebase API.
- Device credentials remain signed device tokens. Pair tokens single-use with atomic claim and same-device retry. Responses use UTC ISO dates. Keep portrait capture, motion gating, local queue, pauses, and framing behavior.
- Config adds reference_frame_revision: stable saved-reference revision, null until saved. Device queue items are bound to originating device ID; a different pairing never uploads an old queue item.
- Engine API: x-engine-key. POST /engine/jobs/claim {worker,max} returns jobs [{id,lease_token,lease_expires_at,attempts,segment:{id,shop_id,device_id,path,download_url,start_ts,end_ts,bytes,width,height,fps}}]. Lease 120 seconds, heartbeat every 30 seconds. POST /engine/jobs/:id/heartbeat {lease_token} renews. POST /engine/jobs/:id/upload-urls {lease_token,index} returns {path,thumb_path,video_upload_url,thumb_upload_url}. Index nonnegative <20, deterministic output paths per job/index.
- POST /engine/jobs/:id/done {lease_token,clips:[{path,thumb_path,duration_s,caption,source_start_s,source_end_s}]} atomically creates deterministic clip records and completes a job; identical retry returns the same clip IDs. Stale/replaced leases cannot complete or fail work. POST /engine/jobs/:id/failed {lease_token,error} retries at most three attempts. Expired leases become claimable. POST /internal/cron/tick uses x-cron-secret.
- No automatic social publishing. Keep owner sharing, captions, skip/report/delete; preserve design. Demo mode must be explicit and visibly marked, never silently stand in for missing production settings.
- Offline local smoke run uses OpenShorts' actual renderer with --skip-analysis on a bounded selected segment; its deterministic selection is documented, not advertised as AI quality. Full AI mode invokes the upstream analysis with explicitly configured model credentials. No fake quality or customer traction claims.
- No deployment, production migration, external texts, or paid model calls until configuration/authorization supports the concrete action.

## Task 1: Firebase API and reliable media delivery

Owner: backend implementer. Scope firebase-api/, firebase rules/indexes/config and tests. Adapt existing Supabase contract behavior into Firebase; preserve supabase/ only as unused legacy reference.

- [ ] First add tests that demonstrate owner isolation, duplicate completion, expired/stale leases, token replay, delete failure and SMS failure.
- [ ] Implement all contract owner/device/engine endpoints with server-owned membership and scoped media capabilities. Upload and read URLs must work both locally and hosted. Verify uploaded objects before segment completion. Use transactional deterministic IDs for jobs and clips.
- [ ] Atomic pair claim including rescan/replacement. Save reference revision, retain replacement context. Do not return another shop's media for arbitrary clip references.
- [ ] Deletion marks pending first, retries failures; never regenerate deleted footage through an active worker. Daily delivery only acknowledges successful SMS (dry-run explicit), can retry failures; cron sweeps retention and expired jobs.
- [ ] Use fastify inject tests and emulator-backed integration tests where practical. Produce report at docs/reports/backend.md and commit only owned paths. Provide start script PORT 4310 and environment example.

## Task 2: Owner app Firebase connection and truthful state

Owner: owner implementer. Scope owner-app/. Same visual design from docs/handoff/design/project/Owner App.dc.html.

- [ ] Tests first for real/demo configuration, missing configuration and share/delete/error behavior.
- [ ] Replace Supabase client with Firebase Auth phone OTP + reCAPTCHA and Firebase emulator support, Firebase ID token renewal, API calls against VITE_API_BASE_URL. Keep public Api interface and existing route shapes.
- [ ] Explicit VITE_DEMO_MODE only for mock. Without config display useful setup state; never fake camera recording stats. Real Home refreshes clips/status and refreshes expired media appropriately.
- [ ] Fix real sharing/download (files/blobs with browser gesture constraints) and record only actual successful shares. Preserve replacement context with backend unpair flow. Keep typography/layout/colors.
- [ ] npm typecheck, build, focused tests; report docs/reports/owner.md and commit owned files.

## Task 3: Wall app pairing boundaries and reference revision

Owner: wall implementer. Scope wall-app/.

- [ ] Add regression tests for stable reference revision, resetting drift only on saved frame, re-pairing with old queued media and token failures.
- [ ] Decode optional reference_frame_revision. Stop using renewed signed URL as identity. Same reference during polling does not change framing/drift state; a new save does.
- [ ] Bind queue entries to original pairing identity. Quarantine legacy or mismatched entries on unpair/re-pair; cancel outstanding tasks from old pairing; maintain same-pairing restart recovery. Retention still removes expired quarantined media.
- [ ] Rename API configuration to backend-neutral CS_API_BASE_URL; anon header optional for legacy compatibility. Support local HTTP test endpoint in Debug only without weakening Release transport security.
- [ ] Build committed Xcode project for simulator; run suitable pure Swift tests. Document physical-device limits and report docs/reports/wall.md; commit owned files.

## Task 4: OpenShorts worker and full local verification

Owner: root. Scope engine-worker/, scripts/, root docs and integration tests.

- [ ] Python standard-library worker tests first: leased job lifecycle, deterministic artifact handling, renewal/loss, download size limit, subprocess failure, completion retry without rerender.
- [ ] Pinned upstream OpenShorts installer and adapter; stdlib HTTP, ffprobe and ffmpeg validation. Worker fetches private input, selects bounded local window or configured upstream AI, calls real OpenShorts renderer, creates thumbnail, uploads artifacts, completes job. Temporary media cleanup, signal handling and bounded concurrency one job initially.
- [ ] Local launch script creates ignored local credentials/config, starts Firebase emulators/API/owner/worker, with no paid calls or production access. Dockerfiles/Cloud Run deployment instructions without publishing.
- [ ] Complete smoke through real Firebase Auth emulator -> owner -> shop -> pair -> device upload -> OpenShorts worker -> owner playback/delete. Verify two-shop isolation, duplicate/stale work, restart/retry. Inspect actual rendered output and browser UI. Record exactly what passed and what remains hardware/hosted-only.

## Completion gate

All changed parts build, focused regression tests pass, end-to-end local run produces a playable vertical video through the chosen upstream engine and displays it in the real owner interface. Review final branch diff and resolve important findings. Hosted setup and iPhone install are separately reported if access or physical hardware is unavailable.
