# ContentStation: next-agent handoff and implementation plan

Updated September 15, 2026, Pacific time, for the repository cleanup built on Clip Lab commit `7b40583`. This revision contains the cleanup and next-agent handoff. The deployment and Postiz evidence below comes from earlier dated verification and was not rerun for this cleanup. No cloud deployment or TestFlight upload accompanied these source changes.

## Start here

Continue from **`main`** in [Aben25/content-station](https://github.com/Aben25/content-station/tree/main). It contains the v2 owner website, native camera app, Firebase API, OpenShorts worker, Clip Lab, deployment configuration and current documentation. The cleanup advances `main` from `7b40583`; `codex/connect-v2` remains at that earlier Clip Lab commit and is not the branch to resume. The old system is preserved on **`main-old-system`** at `9f209d9`; its history is unrelated to the v2 history. The earlier promotion replaced the old `main` history rather than merging it. Keep the backup branch unless the user authorizes its removal. `contentstation-v2` is the earlier imported codebase.

This document records the latest user direction and the next implementation plan. Read [README.md](README.md) for local setup and [docs/HOSTED-SETUP.md](docs/HOSTED-SETUP.md) for cloud operations. The current app source is the UI reference. Superseded design exports, prototype plans and resolved review reports were removed from this checkout; they remain available in Git history at `7b40583`.

## Next-agent quick start

- **Workspace:** `/Users/abeniforjesus/Desktop/ContentStationAI`, cloned from `Aben25/content-station`. Read `AGENTS.md`, this handoff and `docs/ARCHITECTURE.md`; fetch and inspect `main` before editing so later commits are included.
- **Completed cleanup:** removed 21 obsolete prototype/design/plan/report files and the camera's unused Supabase key/header. Kept both current web UIs, their shared clipping engine, Firebase API, native camera, Postiz, tests and deployment files. Runtime UI and clipping behavior were preserved; explicit demo modes remain useful for development.
- **Local readiness:** owner/API dependencies were installed and builds passed. OpenShorts is not installed in this checkout, and private footage, model keys and prior Postiz configuration were not cloned. Python 3.12 is available at `/opt/homebrew/bin/python3.12`; the shell's default `python3` is 3.9, so select 3.12 explicitly for renderer setup and Clip Lab.
- **Suggested next work:** follow [Clip Lab setup](scripts/clip-lab/README.md). Install the pinned renderer with `PYTHON_BIN=/opt/homebrew/bin/python3.12 bash scripts/setup-openshorts.sh`, then launch `/opt/homebrew/bin/python3.12 scripts/clip-lab/server.py`. Validate a synthetic or user-authorized video in motion mode through upload, segmentation, rendering, playback and download. Record actual results before claiming full rendering works on this Mac.
- **Further work:** a Postiz draft remains unverified through Clip Lab. Its CLI path is separate from the owner's Firebase/Postiz publishing path. Hosted Postiz and a Meta app remain product milestones; use the existing authorization boundaries below when that work is requested.
- **Evidence:** see [Validation when resuming](#validation-when-resuming) for the checks passed during cleanup and the integration checks not repeated. The saved hosted/Postiz reports describe earlier runs, not the current Mac's installed services.

## Product milestone

**Current milestone:** physical iPhone capture → authenticated upload → Google Cloud OpenShorts render → owner playback works, and owner-approved publishing through self-hosted Postiz is implemented and verified locally (API, owner website, pinned instance). **Next milestone:** one real shop connects its social account on a hosted instance, approves a camera-generated clip, publishes from ContentStation, and sees the live post link.

Last recorded publishing state: the pinned Postiz stack passed local verification in the prior environment, the ContentStation API provisions one Postiz organization per shop and publishes through it, and the owner website has the connect/review/publish/schedule screens. **That verification did not provision a Meta app or hosted Postiz, connect a real social account, or send a social post.** Check the current service state before continuing. In production the feature stays hidden until the API receives the `POSTIZ_*` secrets. See [the local verification report](docs/reports/postiz-local-verification.md).

## User direction and product scope

- Use Firebase/Google. The user explicitly authorized replacing the old nonfunctional Content Station in project `lemekeru`; that deployment is complete.
- Preserve the current owner and camera UI. The owner app remains a mobile website; the camera app is native iOS. Clip Lab remains a separate local web UI for testing the shared clipping engine.
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
| Social publishing | Implemented behind configuration and verified locally; hidden on the hosted site until a Postiz instance and Meta app exist. Manual share/download works |

The prior handoff recorded the owner site returning HTTP 200 and API `/health` returning HTTP 200, `ok=true`, `project_id=lemekeru`, `emulator=false`, at **2026-09-15 02:17:38 UTC**. This was a reachability check, not a new end-to-end test, and was not repeated for the cleanup.

Historical verification, with details in [hosted verification](docs/reports/hosted-verification.md):

- A 58.9 MB, five-minute test upload produced a 30.03-second, 1080×1920 clip through the cloud worker. Full FFmpeg decoding, HTTP range playback, caption editing, duplicate segment completion and two-shop access isolation passed.
- A separate generated fixture passed deletion and revocation of an already issued media URL. The isolation test checks two actual, distinct shops and the `clip_missing` error; an owner lacking a shop is not a valid isolation test.
- A physical **iPhone 15 Pro Max**, build 9, paired at 2026-09-15 01:38:35 UTC. Preview, saved framing, recording and real uploads worked. Its first 12-second, 1080×1920 clip fully decoded at 01:43:25 UTC. The phone footage is private and excluded from Git.
- The hosted pass recorded 16 Firebase API tests, 24 owner tests and 15 Swift checks, plus builds and real rendering. The later Postiz pass recorded 24 API tests and 42 owner tests. These counts belong to their dated reports; they are not fresh deployment or hardware verification.
- Hosted browser authentication passed sign-in, repeated resend, incorrect code, correct code, and sign-out using fictional test numbers. Real carrier SMS delivery has not been tested.

Remaining product validation: useful editorial selection on real shop footage; Wi-Fi loss/recovery; switching networks; camera app restarts; thermal behavior. The station app must remain open for recording. Automatic face blurring, daily clip SMS delivery, team management, billing and unattended social posting are not implemented.

## Repository map

| Work | Start with |
| --- | --- |
| API and ownership checks | [firebase-api/src/context.ts](firebase-api/src/context.ts) (`ownerShop`, `ownedClip`, capabilities) and the route modules in [firebase-api/src/routes/](firebase-api/src/routes/); map in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Owner API contract and adapter | [Api.ts](owner-app/src/api/Api.ts), [types.ts](owner-app/src/api/types.ts), [firebase.ts](owner-app/src/api/firebase.ts) |
| Owner publishing screens | [Accounts.tsx](owner-app/src/screens/Accounts.tsx), [PublishPanel.tsx](owner-app/src/components/PublishPanel.tsx), [usePublications.ts](owner-app/src/hooks/usePublications.ts), [ClipDetail.tsx](owner-app/src/screens/ClipDetail.tsx), [Settings.tsx](owner-app/src/screens/Settings.tsx) |
| Publishing backend | [postiz.ts](firebase-api/src/postiz.ts) (client, key vault), [routes/publishing.ts](firebase-api/src/routes/publishing.ts) (routes, reconciliation), [fake-postiz.ts](firebase-api/test/fake-postiz.ts) and [publishing.test.ts](firebase-api/test/publishing.test.ts) |
| Postiz stack | [postiz/README.md](postiz/README.md), `postiz/docker-compose.yml`, `scripts/postiz-local.mjs` |
| Login behavior | [firebaseAuth.ts](owner-app/src/api/firebaseAuth.ts) and its tests |
| Native camera | [wall-app/README.md](wall-app/README.md), `wall-app/ContentStationWall.xcodeproj` |
| Clip processing | [engine-worker/README.md](engine-worker/README.md), [contentstation_worker.py](engine-worker/contentstation_worker.py) |
| Clip Lab web UI | [scripts/clip-lab/README.md](scripts/clip-lab/README.md), `server.py`, `index.html`, `gemini_cli_bridge.py`; run with `npm run clip-lab` |
| Deployed configuration | [docs/HOSTED-SETUP.md](docs/HOSTED-SETUP.md), `deploy/`, `firebase.hosted.json` |
| Local launcher and verification | `scripts/local.mjs`, `scripts/smoke-e2e.py`, `scripts/smoke-hosted.mjs` |
| Shared camera/owner contract | [docs/FIREBASE-CONTRACT.md](docs/FIREBASE-CONTRACT.md), owner `api/types.ts` and camera `Network/Models.swift` |
| UI development | [owner-app/README.md](owner-app/README.md), `owner-app/src/`, `wall-app/Sources/UI/`, `scripts/clip-lab/index.html` |
| Product name and URLs | `product.json`, propagated by `scripts/sync-product.sh` |

The working tree contains the current Firebase implementation. Older systems and design exports are recoverable through Git history and `main-old-system`; they are not alternative runtime targets.

## Publishing: what is done and what remains

The completed steps below were verified on September 14, 2026 (Pacific) in the prior environment; details and limits are in [docs/reports/postiz-local-verification.md](docs/reports/postiz-local-verification.md).

### Done: pinned local stack and organization isolation (plan step 1)

- `postiz/docker-compose.yml` pins `ghcr.io/gitroomhq/postiz-app:v2.23.0` by tag and digest with PostgreSQL, Redis, Temporal and Elasticsearch. Elasticsearch is required: Temporal's SQL visibility store refuses Postiz's Text search attributes and the backend exits at startup without it.
- `node scripts/postiz-local.mjs setup | up | verify | down` generates ignored secrets, starts the stack, and runs the two-organization check. The check passed 17/17 against the real instance: provisioning through `POST /enterprise/create-user` (JWT signed with the instance secret), duplicate and forged provisioning refused, per-organization uploads including a real MP4, one organization unable to list, post to, or delete another's channels and drafts, and persistence across a container restart. Channels in that check are labelled fake database rows; drafts start no workflow; no platform was contacted.
- Organization provisioning through the public API is not documented upstream; the pinned source has the unauthenticated-but-signed `/enterprise` routes, which is what the API uses. Recheck them on any upgrade.

### Done: ContentStation publishing backend (plan step 2)

- One Postiz organization per shop, created lazily from the shop record in `cs2_memberships`/`cs2_shops`; the organization key is AES-GCM encrypted with `PUBLISHING_SECRET` in `cs2_publishing_orgs` and never returned to clients.
- Connection start goes through `/enterprise/url` with a redirect back to the owner site (`#/accounts`) and a completion webhook that the API verifies with the instance secret before it touches any record; the channel list is then read from Postiz.
- Publications (`cs2_publications`) are shop-scoped, keyed by the owner's idempotency key, written before the send, and given a unique scheduled second; unanswered sends are reconciled by looking posts up by time and channel before any resend. Outcomes are polled from Postiz on reads and from the maintenance tick (`publications_checked` in the cron response). Clip deletion and account removal cancel queued posts.
- Tests: 8 new emulator-backed tests against an in-process fake Postiz (two-shop denial, foreign clip/account/publication IDs, duplicate taps, timeout with and without a created post, rejection and outage, scheduling and cancel, disconnect and delete, cron reconciliation, no keys in responses). All 24 API tests pass.

### Done: owner website (plan step 3)

- Settings has a Connected accounts row. The Accounts screen lists connected accounts, connects (full-page hand-off to the platform login, return handled at `#/accounts?added=…`), reconnects expired ones, and removes with a confirmation that states what happens to posts. An unconfigured server shows a plain message.
- Clip Detail has a Publish action when accounts exist, a review sheet with the saved caption, account selection, Now or a shop-time schedule, and a per-account outcome list with live links, failures, cancel and late hints. Delete copy mentions cancelled scheduled posts and posts that stay published. Sharing and download are unchanged.
- 42 owner tests pass (typecheck and production build too), including the new Accounts, ClipDetail, adapter and helper tests. A demo-mode browser pass of the new screens was done with sample data; see the report for what that does and does not prove.

### Remaining: Google hosting and the first platforms (plan step 4)

Nothing is provisioned. The steps, in order, and who can do them:

1. **Meta developer app (user).** Create the app on a business portfolio, add Facebook Login for Business, set the redirect URIs `https://<postiz host>/integrations/social/facebook` and `.../instagram`, request `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `business_management`, `instagram_basic`, `instagram_content_publish`, and switch the app to Live. Public use needs business verification; the pilot's own Page and Instagram professional account can be added as testers before review. Provide `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` through Secret Manager only.
2. **Host Postiz (needs authorization; it costs money).** Candidate: one Compute Engine VM (4 vCPU, 8 GB, 50 GB) in `lemekeru`, `postiz/docker-compose.yml` bound to loopback behind a TLS reverse proxy on a stable HTTPS name, `DISABLE_SSRF_PROTECTION` and `NOT_SECURED` unset, `DISABLE_REGISTRATION=true`, scheduled `pg_dump` and uploads backups, and a tested restart. The uploads path must be publicly reachable because the platforms fetch media from it.
3. **Connect the API.** Add `POSTIZ_URL`, `POSTIZ_JWT_SECRET` and `PUBLISHING_SECRET` to Secret Manager, map them into the Cloud Run API, redeploy. The owner website needs no change; the feature appears when `GET /publishing/accounts` reports `configured: true`.
4. Run `node scripts/postiz-local.mjs verify` against the hosted instance (point `postiz/.env`/`postiz.env` copies at it or adapt the script's URL and secret), then connect the designated test Page.

### Remaining: first real post and pilot (plan step 5)

With explicit authorization for the test account and approved content: publish one camera-generated clip, confirm the platform accepted it and the live link appears in the app, test a scheduled post and a reconnect after revoking the platform authorization, and record the evidence without tokens or private footage. Only then recruit the 10 pilot shops.

### Known limits to keep in the product copy

- Postiz's public API cannot delete media, so a copy of every published or queued clip stays in the shop's organization library until removed server-side. The owner app says so on delete.
- Per-post failure reasons are not exposed by the public list route; the app shows a generic failure with a reconnect hint.
- If the owner cancels or fails the platform login, Postiz shows its own error page and does not redirect back; the Accounts screen tells owners to use the browser's Back button.
- Postiz webhooks are unsigned and UI-configured, so they are not used; outcomes are polled, with the maintenance tick as the fallback.

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
- **Local Docker:** the earlier Postiz verification used Colima with 4 CPU and 8 GiB. Confirm the current Docker engine before running the stack; the ignored instance configuration is not part of a clone. See [Postiz setup](postiz/README.md).
- **Firebase emulators for tests:** check for port conflicts before starting the root emulator configuration. The earlier environment used an ignored alternate configuration on 19099/18080/19199; that file is not included in a clone. Export the matching `*_EMULATOR_HOST` values before `npm --prefix firebase-api test`.
- **Postiz specifics:** `POSTIZ_URL` ends in `/api`; organization keys go in the `Authorization` header without `Bearer`; `API_LIMIT` is a per-IP hourly budget for the whole backend, so keep it high; drafts never contact a platform; cross-organization deletes answer 500, not 403.

## Local-only access and artifacts

The current checkout is under `Desktop/ContentStationAI`. Private artifacts from the earlier environment are not included in a clone. Keep local state in the existing ignored locations:

- `.runtime/local-env.json`, `.runtime/openshorts/` and `.runtime/jobs/`: local app configuration, pinned renderer and worker files created by setup.
- `.runtime/clip-lab.env` and `.runtime/clip-lab/`: optional local model configuration and Clip Lab media/runs.
- `.runtime/deploy/test-phones.json`: separately provisioned fictional hosted-auth test codes used by `scripts/smoke-hosted.mjs`.
- `postiz/.env`, `postiz/postiz.env` and `postiz/backups/`: generated local Postiz secrets and state; hosted instances use their own configuration.
- Private recordings, signing material and exported iOS archives: keep out of Git. Hosted services use Secret Manager; obtain credentials through authorized access without printing them.

A fresh checkout can run locally via `npm run setup` and `npm run dev` using generated local secrets and Firebase emulators. Cloud administration, hosted fictional logins and signed iOS builds require separate authorized credentials. Missing ignored files are not missing source code.

## Validation when resuming

The September 15 cleanup removed superseded design exports, plans and reports, plus the camera's unused Supabase configuration/header. Local checks passed: API TypeScript build, owner typecheck/production build and 42 tests, 12 worker tests, 15 Swift checks, and a Debug iOS simulator build. All local Markdown links, Python and Clip Lab JavaScript syntax, camera plist files, and Clip Lab HTTP UI/state serving were checked. No full render, Firebase emulator integration suite, cloud deployment, physical-device run or external publishing was repeated. The fresh checkout still needs OpenShorts setup for actual rendering.

For documentation-only work, check links, diffs and accidental sensitive content. For implementation, run the affected tests and builds from the component READMEs. For publishing work: `node scripts/postiz-local.mjs up && node scripts/postiz-local.mjs verify`, `npm --prefix firebase-api test` (with emulators), `npm --prefix owner-app test && npm --prefix owner-app run typecheck && npm --prefix owner-app run build`. Use `scripts/smoke-e2e.py` for local real-render verification; it refuses hosted targets. The hosted smoke requires an explicit `--project lemekeru`, an authorized input file and local fictional test configuration. Its camera requests simulate a phone; cite the separate physical test for handset evidence.

Update this handoff and the relevant verification report as milestones change. Before the next push, review the staged file list, keep `.runtime/`, credentials, private recordings and build outputs excluded, and verify the pushed branch head matches the local commit.
