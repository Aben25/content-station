# ContentStation

A mounted iPhone captures shop work, an OpenShorts worker makes vertical clips, and the owner views, edits captions, shares, or deletes them in a mobile website. The design matches the supplied Scope and visual direction handoff.

The active implementation uses **Firebase Authentication, Firestore and private Cloud Storage**, a Node API suitable for Google Cloud Run, and the real pinned OpenShorts renderer. `supabase/` remains an unused reference from the initial v2 branch. It is not needed to run this system.

## Run locally

Requirements: Node 22+, Java 21+, Python 3.11+ and FFmpeg. The iPhone app additionally needs Xcode.

```sh
npm run setup
npm run dev
```

Open [the owner app](http://127.0.0.1:4311/) and [Firebase Emulator UI](http://127.0.0.1:4000/). Sign in with a fictional phone number, such as `(415) 555-0198`; the verification code appears in the local Auth emulator. No real SMS is sent. The app uses real emulator accounts, database records and private media, not the UI's sample-data mode.

The setup creates ignored local configuration and backend secrets in `.runtime/`, plus public `owner-app/.env.local`. OpenShorts and its virtual environment live under `.runtime/openshorts`. To reuse an existing pinned installation, set `OPENSHORTS_HOME` before running the launcher. The launcher never enables paid model calls or real messaging.

`npm run dev -- --no-worker` starts the API and owner website while keeping the queue available for the integration test. If the emulators are already running, they are reused. Ctrl+C stops services started by that launcher. Emulators started by the launcher export their state into `.runtime/firebase-data` on exit and import it on the next start.

## Verify the connected flow

```sh
npm run dev -- --no-worker
# In another terminal, with the same OPENSHORTS_HOME if customized:
python3 scripts/smoke-e2e.py
```

The smoke test signs in through Firebase Auth's emulator, creates a shop and pairing, uploads an actual MP4 through the camera endpoints, runs OpenShorts, verifies the output fully decodes and supports video seeking, and checks a second owner cannot access it. It retains the clip in the owner app for inspection. `--input /absolute/path/to/footage.mp4` uses your footage; otherwise it generates a synthetic test video. `--phone 14155550196 --delete` also checks deletion and revocation of an already issued media link.

The test refuses to run against a hosted project. It simulates the camera's HTTP requests; it is not evidence of physical iPhone capture, Wi-Fi provisioning or background upload reliability.

| Piece | Location | Checks |
|---|---|---|
| Firebase API | `firebase-api/` | `npm --prefix firebase-api run build`; emulator-backed tests in its README |
| Owner website | `owner-app/` | `npm --prefix owner-app test`; `npm --prefix owner-app run typecheck`; `npm --prefix owner-app run build` |
| OpenShorts worker | `engine-worker/` | `npm run test:worker`; real smoke above |
| iPhone camera | `wall-app/` | `bash wall-app/Tests/run.sh`; simulator build in its README |

## Camera configuration

Set `CS_API_BASE_URL` to the API origin before building the wall app. It adds no Supabase route suffix and needs no anon key. For the simulator, `http://127.0.0.1:4310` reaches the local API. A physical iPhone needs a reachable backend address; its own localhost is not the Mac. Debug builds allow local networking, while Release builds retain normal HTTPS requirements.

The provided TestFlight build 7 predates this integration. Building this branch locally does not update an installed TestFlight app. A new signed build using the hosted API is a separate release step.

## What the engine does today

Default `ENGINE_MODE=local` selects a bounded high-motion window and invokes upstream OpenShorts for vertical rendering. This makes the connection testable without a model key. It does not claim semantic understanding or polished editorial selection. The worker also has an opt-in `ai` mode for upstream analysis, including silent-footage visual analysis; that mode requires configured model access and has not been quality-validated by the local smoke.

No automatic social posting or approval queue is included. Owner sharing/export remains manual. The owner app is a mobile website; the mounted camera app is native iOS.

## Hosting

See [the hosted setup checklist](docs/HOSTED-SETUP.md) and [the implementation and verification reports](docs/reports/). Use a selected Firebase project, a dedicated v2 storage bucket and narrowly scoped access. The local setup does not deploy rules, create cloud resources, send messages, update TestFlight or replace the older Firebase system.

Product names, support phone and URLs live in `product.json`; `scripts/sync-product.sh` propagates them. Replace the placeholder support contact and `cs.ai` links with your real values before a customer release.
