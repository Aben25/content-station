# Hosted verification — September 14, 2026

The owner explicitly authorized replacement of the nonfunctional old Content Station in Google/Firebase project `lemekeru`. The active API, private data access rules, owner website, renderer and maintenance schedule are deployed. No existing app data was deleted as part of deployment.

## Live resources

- Owner website: https://lemekeru.web.app
- API: https://contentstation-api-233122534259.us-central1.run.app
- API revision: `contentstation-api-00001-mch`
- API image: `us-central1-docker.pkg.dev/lemekeru/contentstation/api@sha256:72e3a72938de016a2ff40504e1a7fdb6b9d22c3afaf30e31bb8f7ef76eaa4f6b`
- Worker revision: `contentstation-render-00001-g6w`, Ready, one instance
- Worker image: `us-central1-docker.pkg.dev/lemekeru/contentstation/worker@sha256:e8bb3395f79f900096739062bb1c8cbc7e5a36eba36a4d7a5946cf67a75d813c`
- Maintenance: `contentstation-maintenance`; Cloud Scheduler logs show actual HTTP 200 dispatches.
- Data: `(default)` Firestore database, `cs2_` collections, `lemekeru-content-station` bucket, `v2/` media prefix.

The API image build and worker image build succeeded on Cloud Build. The worker build ran the actual pinned OpenShorts renderer on generated media and verified decoded 1080×1920 output. Runtime credentials use service identities and Secret Manager.

## Real upload → cloud render → owner playback

`scripts/smoke-hosted.mjs --project lemekeru --phase upload` uploaded the previously selected five-minute detailing test footage through the same authenticated endpoints used by the camera. The capture source was an API simulator, not a physical phone.

| Check | Result |
| --- | --- |
| API health | Correct project; `emulator=false` |
| Input | 58,869,803 bytes, 300.04975 seconds |
| Repeated segment completion | Same job returned; no duplicate |
| Cloud rendering | Pinned OpenShorts, CPU, motion-based selection |
| Worker ready → completed | 21:12:26.966 → 21:15:19.251 UTC, about 172 seconds |
| Output | 30.03 seconds, 1080×1920 |
| Full video decode | Passed using FFmpeg |
| Video seeking | HTTP 206 and correct 1,024-byte range |
| Owner isolation | Two distinct shops; wrong owner's clip fetch returns `clip_missing` |
| Browser playback | Playing, readyState 4, advancing time, 1080×1920; no media error |
| Caption update | Saved through the hosted API |

Job: `c65020beeed3ffe74be08a3bd6dc2bcc3d84657edbb76f5fa953cf1cdd436d69`.
Clip: `d6c765c3782746ac98cbc317d3e0453f3bcb56426b25045a0539bcff6dbd02f3`.
Output SHA-256: `5c61a951c9f3ad31c7b9c3f72e0783bf8f5faa3dcaf642fc187b1c9343a6774f`.

A separate 12-second generated fixture produced clip `6949ae37883c26f4ec4a291c2030467c0aab45444aa23c33f8e512befe8cca5c`. Its full decode, range playback, distinct-shop access check and deletion passed; the previously issued video capability stopped working after deletion. The main real-footage clip remains available for review.

The first version of the isolation smoke accepted any 403/404, including an owner without a shop. Review caught this gap. The script now creates/asserts two different shops and requires `clip_missing`; the real-footage test was rerun successfully with this stronger assertion.

## Owner website and camera release

The live browser flow verified Firebase phone sign-in, the API-camera preview, saved framing and recording hours, completed onboarding, a generated clip, and sign-out. The final deployed bundle also passed two successive code resends, an incorrect code, and a successful sign-in afterward. All phone authentication used configured fictional test numbers; no real SMS was sent. The reCAPTCHA anchor persists outside routed screens and the verifier is reused across resends. Production CAPTCHA checks remain enabled.

The website removes unimplemented automatic face-blurring claims, delivery promises and fictional support contacts. Sharing remains manual. Settings now has a functional sign-out control; reports are acknowledged only after the API saves them.

Camera version 1.0.0 build 9 is uploaded and accepted for internal TestFlight testing under the existing group. Build ID: `cfcd6aec-2230-449a-8535-fac0b5cdfe9b`. Release API configuration uses HTTPS, the setup screen points at `lemekeru.web.app`, and the signed archive/export succeeded. Build 9 supersedes build 8's leftover setup-domain text. No external testers were invited and no App Store production release was submitted.

## Automated checks

- Firebase API: 16 emulator-backed tests passed, including a real HTTP/2 listener accepting a 33 MiB upload; TypeScript build passed.
- Owner website: 24 tests, TypeScript check and production build passed. Auth lifecycle/concurrency, invalid-code handling and sign-out are covered.
- Camera: 15 Swift checks passed, including pairing isolation, framing, encoder callbacks and drift behavior; signed Release archive/export passed.
- Worker: CPU image dependency checks and real renderer build test passed; hosted real and generated footage both completed.

## Remaining pilot validation

Physical iPhone pairing/capture, Wi-Fi loss/recovery, app restarts and thermal behavior still need a handset test. Daily clip SMS is intentionally in dry-run mode; real carrier sign-in delivery and notification delivery have not been tested. Motion selection demonstrates the connected pipeline, not semantic editorial quality. Automatic face blurring, automatic social posting, team management and billing are not implemented.

Secrets, test login codes, signed credentials, raw build logs and resumable camera tokens remain in ignored local configuration or Secret Manager. They are not part of this report or the published branch.
