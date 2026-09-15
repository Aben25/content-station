# ContentStation: next-agent handoff and implementation plan

Updated September 14, 2026, Pacific time (September 15 UTC), after the local Postiz integration pass. Baseline application commit: the commit that introduced `postiz/` and `firebase-api/src/publishing.ts` (see `git log`); the previous baseline was `adeeb98afe0942bdad536400b29e0b29db7194df`.

## Start here

Continue from **`codex/connect-v2`** in [Aben25/content-station](https://github.com/Aben25/content-station/tree/codex/connect-v2). This branch contains the owner website, native camera app, Firebase API, OpenShorts worker, deployment configuration, design references and verification reports. `contentstation-v2` is the earlier imported codebase; `main` is the old system. The v2 history is unrelated to `main`. Use the current branch as the base for follow-up work; this handoff does not merge or replace GitHub `main`.

This document records the latest user direction and the next implementation plan. Read [README.md](README.md) for local setup and [docs/HOSTED-SETUP.md](docs/HOSTED-SETUP.md) for cloud operations. The [original design handoff](docs/handoff/HANDOFF.md) remains a visual reference, with superseded technical and product assumptions. Current code, the verification reports, and the user's later instructions take precedence over those assumptions.

**Current milestone:** physical iPhone capture → authenticated upload → Google Cloud OpenShorts render → owner playback works, and owner-approved publishing through self-hosted Postiz is implemented and verified locally (API, owner website, pinned instance). **Next milestone:** one real shop connects its social account on a hosted instance, approves a camera-generated clip, publishes from ContentStation, and sees the live post link.

State of publishing: the pinned Postiz stack runs locally, the ContentStation API provisions one Postiz organization per shop and publishes through it, and the owner website has the connect/review/publish/schedule screens. **No Meta developer app exists, no hosted Postiz has been provisioned, no social account has been connected, and no social post has been sent.** In production the feature stays hidden until the API receives the `POSTIZ_*` secrets. See [the local verification report](docs/reports/postiz-local-verification.md).

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
| Social publishing | Implemented behind configuration and verified locally; hidden on the hosted site until a Postiz instance and Meta app exist. Manual share/download works |

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
| Owner publishing screens | [Accounts.tsx](owner-app/src/screens/Accounts.tsx), [PublishPanel.tsx](owner-app/src/components/PublishPanel.tsx), [usePublications.ts](owner-app/src/hooks/usePublications.ts), [ClipDetail.tsx](owner-app/src/screens/ClipDetail.tsx), [Settings.tsx](owner-app/src/screens/Settings.tsx) |
| Publishing backend | [postiz.ts](firebase-api/src/postiz.ts) (client, key vault), [publishing.ts](firebase-api/src/publishing.ts) (routes, reconciliation), [fake-postiz.ts](firebase-api/test/fake-postiz.ts) and [publishing.test.ts](firebase-api/test/publishing.test.ts) |
| Postiz stack | [postiz/README.md](postiz/README.md), `postiz/docker-compose.yml`, `scripts/postiz-local.mjs` |
| Login behavior | [firebaseAuth.ts](owner-app/src/api/firebaseAuth.ts) and its tests |
| Native camera | [wall-app/README.md](wall-app/README.md), `wall-app/ContentStationWall.xcodeproj` |
| Clip processing | [engine-worker/README.md](engine-worker/README.md), [contentstation_worker.py](engine-worker/contentstation_worker.py) |
| Deployed configuration | [docs/HOSTED-SETUP.md](docs/HOSTED-SETUP.md), `deploy/`, `firebase.hosted.json` |
| Local launcher and verification | `scripts/local.mjs`, `scripts/smoke-e2e.py`, `scripts/smoke-hosted.mjs` |
| Shared camera/owner contract | [docs/CONTRACT.md](docs/CONTRACT.md); Firebase code supersedes legacy Supabase auth details |
| Visual references | [design README](docs/handoff/design/README.md), [interactive board](docs/handoff/design/ContentStationBoard.jsx) |
| Product name and URLs | `product.json`, propagated by `scripts/sync-product.sh` |

`supabase/` is an unused reference. It is not the running backend.

## Publishing: what is done and what remains

Everything below was verified on September 14, 2026 (Pacific) on this Mac; details and limits are in [docs/reports/postiz-local-verification.md](docs/reports/postiz-local-verification.md).

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
- **Docker on this Mac:** there is no Docker Desktop. `colima` (4 CPU, 8 GiB) provides the engine; `docker compose` needs `cliPluginsExtraDirs: ["/opt/homebrew/lib/docker/cli-plugins"]` in `~/.docker/config.json`. `colima start` after a reboot. The Postiz image is 5.6 GB.
- **Firebase emulators for tests:** another project's emulators sit on the default ports on this Mac. `.runtime/firebase.emulators.json` (ignored) runs this repo's Auth/Firestore/Storage emulators on 19099/18080/19199 with copied rules; export the matching `*_EMULATOR_HOST` values before `npm --prefix firebase-api test`. OpenJDK 21 is installed where `scripts/local.mjs` looks for it.
- **Postiz specifics:** `POSTIZ_URL` ends in `/api`; organization keys go in the `Authorization` header without `Bearer`; `API_LIMIT` is a per-IP hourly budget for the whole backend, so keep it high; drafts never contact a platform; cross-organization deletes answer 500, not 403.

## Local-only access and artifacts

On the current Mac, this checkout is under `outputs/contentstation-v2` in the Codex workspace. Ignored `.runtime/` contains local configuration, test login codes, deployment helpers, credentials and private media; these are deliberately absent from GitHub.

- `.runtime/deploy/test-phones.json`: fictional hosted-auth test codes used by `scripts/smoke-hosted.mjs`.
- `.runtime/deploy/secrets.json`: local deployment secret material; hosted services use Secret Manager. Reuse or provision through authorized secret access without printing values.
- `.runtime/hardware-test/`: private phone clip and validation result. Use only for the authorized test; never include footage in a public commit or demo without permission.
- `.runtime/deploy/`: build 9 signed archive and IPA. The accepted build is available through TestFlight; archives/signing material are not repository deliverables.
- `.runtime/cloud-sdk-venv/bin/python`: local Python with gcloud worker-pool dependencies. If the system gcloud Python reports missing grpc/cffi, use `CLOUDSDK_PYTHON_SITEPACKAGES=1` and this interpreter for that command.
- Existing App Store Connect CLI credentials are in the Mac's `~/.asc/config.json`; read only the fields needed, without printing the file or signing keys.
- `postiz/.env` and `postiz/postiz.env` (ignored): local database passwords and the local instance `JWT_SECRET`. `.runtime/postiz-verify.json` holds the last verify run with organization IDs only. Both are throwaway local values; the hosted instance gets its own.

A fresh checkout can run locally via `npm run setup` and `npm run dev` using generated local secrets and Firebase emulators. Cloud administration, hosted fictional logins and signed iOS builds require separate authorized credentials. Missing ignored files are not missing source code.

## Validation when resuming

For documentation-only work, check links, diffs and accidental sensitive content. For implementation, run the affected tests and builds from the component READMEs. For publishing work: `node scripts/postiz-local.mjs up && node scripts/postiz-local.mjs verify`, `npm --prefix firebase-api test` (with emulators), `npm --prefix owner-app test && npm --prefix owner-app run typecheck && npm --prefix owner-app run build`. Use `scripts/smoke-e2e.py` for local real-render verification; it refuses hosted targets. The hosted smoke requires an explicit `--project lemekeru`, an authorized input file and local fictional test configuration. Its camera requests simulate a phone; cite the separate physical test for handset evidence.

Update this handoff and the relevant verification report as milestones change. Before the next push, review the staged file list, keep `.runtime/`, credentials, private recordings and build outputs excluded, and verify the pushed branch head matches the local commit.
