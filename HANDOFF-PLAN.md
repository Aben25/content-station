# ContentStation: next-agent handoff and implementation plan

Updated September 14, 2026, Pacific time (September 15 UTC). Baseline application commit: `adeeb98afe0942bdad536400b29e0b29db7194df`.

## Start here

Continue from **`codex/connect-v2`** in [Aben25/content-station](https://github.com/Aben25/content-station/tree/codex/connect-v2). This branch contains the owner website, native camera app, Firebase API, OpenShorts worker, deployment configuration, design references and verification reports. `contentstation-v2` is the earlier imported codebase; `main` is the old system. The v2 history is unrelated to `main`. Use the current branch as the base for follow-up work; this handoff does not merge or replace GitHub `main`.

This document records the latest user direction and the next implementation plan. Read [README.md](README.md) for local setup and [docs/HOSTED-SETUP.md](docs/HOSTED-SETUP.md) for cloud operations. The [original design handoff](docs/handoff/HANDOFF.md) remains a visual reference, with superseded technical and product assumptions. Current code, the verification reports, and the user's later instructions take precedence over those assumptions.

**Current milestone:** physical iPhone capture → authenticated upload → Google Cloud OpenShorts render → owner playback works. **Next milestone:** one real shop connects its social account, approves a camera-generated clip, publishes from ContentStation, and sees the live post link.

The current user request is to push the existing work and this handoff. **Postiz has not been installed or integrated.** No social account has been connected, no social post has been sent, and no publishing service subscription has been purchased.

## User direction and product scope

- Use Firebase/Google. The user explicitly authorized replacing the old nonfunctional Content Station in project `lemekeru`; that deployment is complete.
- Use the supplied owner/wall app visual design. The owner app remains a mobile website; the camera app is native iOS.
- Reuse open-source software. The running renderer already uses real OpenShorts. The user prefers self-hosted, open-source **Postiz** for social publishing.
- Proposed publishing architecture: one Postiz installation, with a separate Postiz organization for each ContentStation business. Keep business credentials and data separated on the server.
- First publishing platforms: Instagram and Facebook. The owner reviews the video and caption, then explicitly publishes or schedules it. TikTok and YouTube follow after the first flow is proven.
- Validate one business end to end, then recruit 10 pilot shops in one niche. Measure clips approved/published, time saved, repeat use and willingness to pay. Ten installs are a recruitment goal, not existing traction.
- Current evidence is one physical test installation, not paying customers or a validated commercial pilot. Detailing footage has been used for testing; it is not proof of customer adoption or a final niche decision.
- Existing Google deployment authorization persists. Actual public posting, sending messages to other people, new subscriptions, and enabling paid model processing require authorization for those actions; none is implied by this documentation push.

## What is deployed and verified

| Piece | Current state |
| --- | --- |
| Owner website | [https://lemekeru.web.app](https://lemekeru.web.app), React/Vite, Firebase phone authentication |
| API | [Cloud Run API](https://contentstation-api-233122534259.us-central1.run.app), Node/Fastify, Firebase Admin |
| Data | Google project `lemekeru`, Firestore `(default)`, `cs2_` collections |
| Media | Private bucket `lemekeru-content-station`, object prefix `v2/` |
| Renderer | Cloud Run worker pool `contentstation-render`, `us-central1`, one instance, 2 CPU / 4 GiB |
| Maintenance | Cloud Scheduler `contentstation-maintenance`, every minute |
| Camera | `com.contentstation.station`, version 1.0.0 build 9, accepted in internal TestFlight |
| Social publishing | Not implemented; manual share/download works |

On this handoff pass, the owner site returned HTTP 200 and API `/health` returned HTTP 200, `ok=true`, `project_id=lemekeru`, `emulator=false`, at **2026-09-15 02:17:38 UTC**. This is a reachability check, not a new end-to-end test.

Historical verification, with details in [hosted verification](docs/reports/hosted-verification.md):

- A 58.9 MB, five-minute test upload produced a 30.03-second, 1080×1920 clip through the cloud worker. Full FFmpeg decoding, HTTP range playback, caption editing, duplicate segment completion and two-shop access isolation passed.
- A separate generated fixture passed deletion and revocation of an already issued media URL. The isolation test checks two actual, distinct shops and the `clip_missing` error; an owner lacking a shop is not a valid isolation test.
- A physical **iPhone 15 Pro Max**, build 9, paired at 2026-09-15 01:38:35 UTC. Preview, saved framing, recording and real uploads worked. Its first 12-second, 1080×1920 clip fully decoded at 01:43:25 UTC. The phone footage is private and excluded from Git.
- Last recorded automated checks: 16 Firebase API tests, 24 owner tests, 15 Swift checks, plus API/owner builds, signed iOS archive/export, worker dependency checks and actual OpenShorts rendering. These were not rerun for this documentation-only handoff.
- Hosted browser authentication passed sign-in, repeated resend, incorrect code, correct code, and sign-out using fictional test numbers. Real carrier SMS delivery has not been tested.

Remaining product validation: useful editorial selection on real shop footage; Wi-Fi loss/recovery; switching networks; camera app restarts; thermal behavior. The station app must remain open for recording. Automatic face blurring, daily clip SMS delivery, team management, billing and unattended social posting are not implemented.

## Repository map

| Work | Start with |
| --- | --- |
| API and ownership checks | [firebase-api/src/app.ts](firebase-api/src/app.ts), especially `ownerShop`, `ownedClip`, and media routes |
| Owner API contract and adapter | [Api.ts](owner-app/src/api/Api.ts), [types.ts](owner-app/src/api/types.ts), [firebase.ts](owner-app/src/api/firebase.ts) |
| Owner publishing entry points | [Settings.tsx](owner-app/src/screens/Settings.tsx), [ClipDetail.tsx](owner-app/src/screens/ClipDetail.tsx), [router.ts](owner-app/src/router.ts) |
| Login behavior | [firebaseAuth.ts](owner-app/src/api/firebaseAuth.ts) and its tests |
| Native camera | [wall-app/README.md](wall-app/README.md), `wall-app/ContentStationWall.xcodeproj` |
| Clip processing | [engine-worker/README.md](engine-worker/README.md), [contentstation_worker.py](engine-worker/contentstation_worker.py) |
| Deployed configuration | [docs/HOSTED-SETUP.md](docs/HOSTED-SETUP.md), `deploy/`, `firebase.hosted.json` |
| Local launcher and verification | `scripts/local.mjs`, `scripts/smoke-e2e.py`, `scripts/smoke-hosted.mjs` |
| Shared camera/owner contract | [docs/CONTRACT.md](docs/CONTRACT.md); Firebase code supersedes legacy Supabase auth details |
| Visual references | [design README](docs/handoff/design/README.md), [interactive board](docs/handoff/design/ContentStationBoard.jsx) |
| Product name and URLs | `product.json`, propagated by `scripts/sync-product.sh` |

`supabase/` is an unused reference. It is not the running backend.

## Next work: self-hosted Postiz

The following is an implementation plan, not a claim of existing functionality. Verify the selected upstream version before treating any Postiz API behavior as established.

### 1. Prove organization isolation and account setup locally

Pin a Postiz release/commit and run its recommended Docker Compose stack: Postiz, PostgreSQL, Redis and Temporal. Keep it a separate service and preserve its upstream license/notices. Record the pin, setup, storage volumes, backup/restore procedure and upgrade process in the repository, with credentials supplied at runtime.

Create two test organizations. Verify how organizations are created, how organization-scoped credentials are obtained, and how an owner connects a channel. Public API support for automatic organization provisioning has **not** been verified. Inspect the upstream implementation; document any manual pilot onboarding step honestly rather than inventing an API or calling the experience seamless.

Completion: the running pinned service can authenticate and store a draft, and credentials for organization A cannot read or mutate organization B's channels, posts or media. Record behavior for the actual routes used by ContentStation. A simulated provider response is not proof that a social platform accepted a post.

### 2. Add the ContentStation publishing backend

Extend the existing Firebase-authenticated API through a small Postiz adapter. Derive the shop from `cs2_memberships` and the verified Firebase identity. The current membership model assigns one shop to each user; multi-location switching is separate future work.

Store the shop → Postiz organization mapping and references to server-held credentials. Keep connection attempts, allowed channel IDs, publishing records and provider post IDs bound to that shop. Check clip ownership and channel ownership on every connection/publish/status/cancel action. Client-supplied shop or organization IDs are never proof of access.

Use a shop-scoped idempotency key for each publish request. Record an attempt before sending it to Postiz; preserve returned Postiz IDs and each channel's status. If a timeout occurs after sending, reconcile the uncertain result before another send. Do not assume Postiz offers exactly-once creation or blindly retry an ambiguous POST.

Upload approved media through Postiz's documented upload API before creating a post. Keep raw camera segments private. Model scheduled, processing, published, failed and uncertain outcomes distinctly; return a live post link only when available. Authenticate provider callbacks using the documented mechanism, correlate them with stored records, and tolerate duplicate/out-of-order delivery; use polling if necessary.

Completion: tests cover two-shop access denial, foreign clip/channel IDs, duplicate taps, timeout reconciliation, per-channel partial failure, expired connections, and status/cancel ownership. Tokens remain server-side and out of logs.

### 3. Extend the owner website using the supplied design

Add connected accounts in Settings and a review → choose accounts → publish/schedule flow from Clip Detail. Preserve caption editing and show the saved caption that will be published. Make scheduling times explicit in the shop's timezone.

Show pending, published and failed states with useful recovery actions and real published links. Keep sharing/export available. Connection cancellation or expired authorization should return the owner to a usable screen. Only expose platforms configured on our instance.

Treat clip deletion and publishing separately: decide and implement cancellation of queued posts and cleanup of media copied into Postiz. Explain that deleting a ContentStation clip does not automatically remove an already published social post. Retention and cancellation behavior must agree with the UI copy.

Completion: browser tests demonstrate account connection return/cancellation, review and scheduling, reload persistence, duplicate-click handling, expired connection recovery, partial failures and access isolation. Provider mocks should be labelled as such in reports.

### 4. Configure Google hosting and the first social platforms

Estimate the additional ongoing hosting cost and document the selected deployment. A continuously running Google Cloud VM with Docker Compose is a candidate for the pilot; a topology has **not** been selected or provisioned. Postiz needs persistent services and storage, so do not assume our existing static Firebase Hosting or request-driven API deployment is sufficient.

Use a stable HTTPS address, runtime secrets, private database/queue access, backups and a tested restart. Register the required platform developer applications and configure their exact OAuth callbacks. Begin with Instagram and Facebook; confirm account eligibility and permissions for the pinned integration. Each shop authorizes its own social account through the platform login screen.

Completion: the service survives a restart, retains the two shops' separated data and schedules, and a designated test account connects successfully. Report platform review/permission blockers separately from code readiness. Ask only for missing account access or actions the user needs to complete; continue independent implementation work meanwhile.

### 5. Verify the first real post, then run the pilot

With authorization for the exact test account and approved content, publish one camera-generated clip. Verify platform acceptance and the returned live link, then test a scheduled post and a reconnect/failure path. Keep drafts and test media separate from customer content.

Completion: a real owner can connect, review, publish and see the outcome without agent assistance. Record reproducible evidence without exposing tokens or private footage. Only then onboard the planned 10 shops in one niche and evaluate clips approved/published, time saved and willingness to pay.

## Postiz research references

Checked during this conversation; recheck against the pinned release when implementing:

- [Repository and AGPL-3.0 license](https://github.com/gitroomhq/postiz-app). Review applicable license requirements before modifying or redistributing Postiz; this handoff makes no claim about the licensing of a combined product.
- [Self-hosting installation](https://docs.postiz.com/self-host/installation/overview): recommended Compose stack and production HTTPS.
- [Organization model](https://docs.postiz.com/general/concepts): organizations contain channels, posts, media, team members and settings.
- [Public API](https://docs.postiz.com/public-api/introduction): API-key/OAuth authentication, uploads, channel and post operations.
- [Provider setup](https://docs.postiz.com/self-host/providers/overview): most major platforms require our own developer app credentials. Facebook-linked Instagram shares the Facebook app credentials; Instagram Standalone is a different setup.
- [Client groups](https://docs.postiz.com/general/channels/customers): groups organize and filter channels; they are not a documented tenant security boundary. Use organizations and verify access enforcement.
- [Connect-channel API](https://docs.postiz.com/public-api/integrations/connect): investigate OAuth initiation and secure completion mapping for our UI.

Self-hosting removes the Postiz Cloud subscription, not infrastructure costs, maintenance or platform setup. Composio and Ayrshare were alternatives considered; neither is integrated or required by this plan.

## Operational details that prevent repeat debugging

- **Google project:** explicitly pass `--project lemekeru`; the local gcloud default may point at another app. Region for API/worker/scheduler is `us-central1`.
- **Large camera uploads:** retain both `API_HTTP2=true` and Cloud Run `--use-http2`. A real 58.9 MB hosted upload is verified. Disabling HTTP/2 reintroduces the larger-upload problem.
- **Worker mode:** `ENGINE_MODE=local` means motion selection inside Google Cloud, followed by real pinned OpenShorts rendering. It does not mean the Mac must stay on. AI analysis is opt-in and unvalidated. OpenShorts pin: `5a6f42807576eda572673b32f8c7625cb6d82a3c`.
- **Worker cost:** the existing worker pool incurs charges while idle. Scaling it to zero stops processing; avoid changing it during an active capture test.
- **Website builds:** explicitly override emulator/demo Vite settings using [hosted setup](docs/HOSTED-SETUP.md). The local `.env.local` otherwise points at emulators.
- **Phone auth:** the invisible reCAPTCHA anchor lives outside routed screens in `owner-app/index.html`; the verifier is reused. Preserve send/verify concurrency guards. Do not run REST sign-in for a fictional phone while its browser code confirmation is pending.
- **Pairing:** use two devices. The station's rear camera scans the QR on the owner's phone or laptop. Start about 1–2 feet away. Keep both awake and avoid glare. Build 9 displays the correct hosted setup URL; the website includes these instructions.
- **Camera release:** current internal TestFlight build is 9, App Store Connect app `6793229212`, team `HP284BJ924`, group `Sutway`. App Store production release and external tester invitations have not been performed.
- **Maintenance:** `SMS_MODE=dry-run` leaves daily clip texts unsent. Firebase phone sign-in is separate. Automatic face blurring is absent, so keep product copy truthful.
- **Private diagnostics:** API request URLs can contain pairing tokens. Strip query strings and print explicit field allowlists instead of entire cloud logs, job documents, authentication records or device configurations.

## Local-only access and artifacts

On the current Mac, this checkout is under `outputs/contentstation-v2` in the Codex workspace. Ignored `.runtime/` contains local configuration, test login codes, deployment helpers, credentials and private media; these are deliberately absent from GitHub.

- `.runtime/deploy/test-phones.json`: fictional hosted-auth test codes used by `scripts/smoke-hosted.mjs`.
- `.runtime/deploy/secrets.json`: local deployment secret material; hosted services use Secret Manager. Reuse or provision through authorized secret access without printing values.
- `.runtime/hardware-test/`: private phone clip and validation result. Use only for the authorized test; never include footage in a public commit or demo without permission.
- `.runtime/deploy/`: build 9 signed archive and IPA. The accepted build is available through TestFlight; archives/signing material are not repository deliverables.
- `.runtime/cloud-sdk-venv/bin/python`: local Python with gcloud worker-pool dependencies. If the system gcloud Python reports missing grpc/cffi, use `CLOUDSDK_PYTHON_SITEPACKAGES=1` and this interpreter for that command.
- Existing App Store Connect CLI credentials are in the Mac's `~/.asc/config.json`; read only the fields needed, without printing the file or signing keys.

A fresh checkout can run locally via `npm run setup` and `npm run dev` using generated local secrets and Firebase emulators. Cloud administration, hosted fictional logins and signed iOS builds require separate authorized credentials. Missing ignored files are not missing source code.

## Validation when resuming

For documentation-only work, check links, diffs and accidental sensitive content. For implementation, run the affected tests and builds from the component READMEs. Use `scripts/smoke-e2e.py` for local real-render verification; it refuses hosted targets. The hosted smoke requires an explicit `--project lemekeru`, an authorized input file and local fictional test configuration. Its camera requests simulate a phone; cite the separate physical test for handset evidence.

Update this handoff and the relevant verification report as milestones change. Before the next push, review the staged file list, keep `.runtime/`, credentials, private recordings and build outputs excluded, and verify the pushed branch head matches the local commit.
