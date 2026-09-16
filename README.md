# ContentStation

**Continuing this project? Start with [the current handoff and next-work plan](HANDOFF-PLAN.md), then [the architecture and code map](docs/ARCHITECTURE.md).** It records the deployed Firebase system, verified camera flow, remaining pilot checks and planned self-hosted Postiz integration. Continue from `main`, which now contains v2; the old system is preserved on `main-old-system`.

A mounted iPhone captures shop work, an OpenShorts worker makes vertical clips, and the owner reviews, edits captions, shares, or deletes them in a mobile website. Clip Lab is a separate local web UI for trying the same clipping engine on uploaded footage.

The implementation uses **Firebase Authentication, Firestore and private Cloud Storage**, a Node API suitable for Google Cloud Run, and the pinned OpenShorts renderer. This checkout contains the current apps and operational documentation; older prototypes and plans remain in Git history. See [docs/README.md](docs/README.md) for the documentation map.

## Current apps

| Piece | Source and setup | Purpose |
| --- | --- | --- |
| Owner web UI | [owner-app/](owner-app/README.md) | Sign in, pair a camera, review clips, edit captions, share and publish |
| Clip Lab web UI | [scripts/clip-lab/](scripts/clip-lab/README.md) | Upload long footage, choose clipping settings, review and download clips |
| Clipping engine | [engine-worker/](engine-worker/README.md) | Shared OpenShorts rendering, motion/AI selection, leased background jobs |
| Firebase API | [firebase-api/](firebase-api/README.md) | Authentication, shop isolation, private media, clip jobs and publishing |
| iPhone camera | [wall-app/](wall-app/README.md) | Capture and upload shop footage |
| Publishing | [postiz/](postiz/README.md) | Self-hosted Postiz integration |

## Run locally

Requirements: Node 22+, Java 21+, Python 3.11+ and FFmpeg. The iPhone app additionally needs Xcode.

```sh
npm run setup
npm run dev
```

Open [the owner app](http://127.0.0.1:4311/) and [Firebase Emulator UI](http://127.0.0.1:4000/). Sign in with a fictional phone number, such as `(415) 555-0198`; the verification code appears in the local Auth emulator. No real SMS is sent. The app uses real emulator accounts, database records and private media, not the UI's sample-data mode.

The setup creates ignored local configuration and backend secrets in `.runtime/`, plus public `owner-app/.env.local`. OpenShorts and its virtual environment live under `.runtime/openshorts`. To reuse an existing pinned installation, set `OPENSHORTS_HOME` before running the launcher; the local setup remembers that path for future starts and smoke tests. The launcher never enables paid model calls or real messaging.

`npm run dev -- --no-worker` starts the API and owner website while keeping the queue available for the integration test. If the emulators are already running, they are reused. Ctrl+C stops services started by that launcher. Emulators started by the launcher export their state into `.runtime/firebase-data` on exit and import it on the next start.

## Run Clip Lab

After installing the prerequisites above, Clip Lab can run independently of Firebase and the camera app:

```sh
bash scripts/setup-openshorts.sh
npm run clip-lab
```

Open [Clip Lab](http://127.0.0.1:4320/). It uses the same renderer as the worker and stores local runs under ignored `.runtime/clip-lab/`. Start with motion selection; AI selection needs configured model access. See [Clip Lab setup](scripts/clip-lab/README.md) for prerequisites, AI modes and Postiz drafts.

## Verify the connected flow

```sh
npm run dev -- --no-worker
# In another terminal:
python3 scripts/smoke-e2e.py
```

The smoke test signs in through Firebase Auth's emulator, creates a shop and pairing, uploads an actual MP4 through the camera endpoints, runs OpenShorts, verifies the output fully decodes and supports video seeking, and checks a second owner cannot access it. It retains the clip in the owner app for inspection. `--input /absolute/path/to/footage.mp4` uses your footage; otherwise it generates a synthetic test video. `--phone 14155550196 --delete` also checks deletion and revocation of an already issued media link.

The test refuses to run against a hosted project. It simulates the camera's HTTP requests; it is not evidence of physical iPhone capture, Wi-Fi provisioning or background upload reliability.

| Piece | Location | Checks |
|---|---|---|
| Firebase API | `firebase-api/` | `npm --prefix firebase-api run build`; emulator-backed tests in its README |
| Publishing service | `postiz/` | `node scripts/postiz-local.mjs up` then `verify` (needs Docker); see its README |
| Owner website | `owner-app/` | `npm --prefix owner-app test`; `npm --prefix owner-app run typecheck`; `npm --prefix owner-app run build` |
| OpenShorts worker | `engine-worker/` | `npm run test:worker`; real smoke above |
| iPhone camera | `wall-app/` | `bash wall-app/Tests/run.sh`; simulator build in its README |

## Camera configuration

Set `CS_API_BASE_URL` to the Firebase API origin before building the wall app. The camera receives its device token during pairing. For the simulator, `http://127.0.0.1:4310` reaches the local API. A physical iPhone needs a reachable backend address; its own localhost is not the Mac. Debug builds allow local networking, while Release builds retain normal HTTPS requirements.

The camera release configuration now uses the hosted HTTPS API. Build 9 also replaces the original placeholder setup domain with `lemekeru.web.app`. Check [hosted verification](docs/reports/hosted-verification.md) for TestFlight and hardware-test status.

## What the engine does today

Default `ENGINE_MODE=local` selects a bounded high-motion window and invokes upstream OpenShorts for vertical rendering. This makes the connection testable without a model key. It does not claim semantic understanding or polished editorial selection. The worker also has an opt-in `ai` mode for upstream analysis, including silent-footage visual analysis; that mode requires configured model access and has not been quality-validated by the local smoke.

No automatic social posting exists. Owner sharing/export remains manual, and owner-approved publishing or scheduling through self-hosted [Postiz](postiz/README.md) is implemented behind configuration: with `POSTIZ_URL` set, the owner connects a Facebook Page or Instagram account in Settings, reviews a clip and publishes or schedules it, and sees the live link or failure. It is verified locally with a mock and a real pinned instance ([report](docs/reports/postiz-local-verification.md)); no Meta developer app or hosted Postiz exists yet, so no real post has been made. See [the plan](HANDOFF-PLAN.md#publishing-what-is-done-and-what-remains). The owner app is a mobile website; the mounted camera app is native iOS.

## Hosting

The owner app is deployed at [lemekeru.web.app](https://lemekeru.web.app), with a Cloud Run API and OpenShorts worker in the same Google project. The old nonfunctional Content Station configuration was replaced with the owner's authorization. See [the hosted setup](docs/HOSTED-SETUP.md) and [verification reports](docs/reports/). Running the local setup still does not deploy cloud resources or send messages.

Product names, optional support phone and URLs live in `product.json`; `scripts/sync-product.sh` propagates them. Setup links now point to the deployed owner website, and no fictional support number is displayed. Daily clip texts and automatic face blurring are not enabled.
