# Connected Firebase integration — September 14, 2026

The v2 camera API, Firebase backend, actual OpenShorts renderer and owner website now work together locally. The owner interface retains the supplied design. This is a local integration result; hosted deployment and physical iPhone verification remain unfinished.

## What is connected

1. Owner phone sign-in uses Firebase Authentication. Local testing uses fictional numbers in the Auth emulator.
2. The owner creates a shop and pairs a camera. Camera uploads, previews, framing reference and status use the Firebase API.
3. Uploaded footage creates a durable leased job in Firestore. The worker downloads private footage and invokes pinned upstream OpenShorts.
4. Rendered clips and thumbnails return to private Storage. The owner can play clips, edit captions, prepare sharing, download, skip, report and delete them.
5. Retries, stale leases, pairing changes, owner isolation and deletion revocation have regression coverage. The local launcher also runs queue processing and scheduled maintenance.

The local engine selects a bounded window using motion and uses OpenShorts for rendering. It does not establish AI editorial quality. Optional upstream AI analysis has not been exercised with a paid model in this integration.

## Verified results

| Check | Result |
|---|---|
| Actual detailing footage through Auth → API → Storage → OpenShorts → owner | Passed; 300.04975 seconds became a 30.03-second, 1080 × 1920 clip |
| Output full decode | Passed with FFmpeg |
| Browser playback after final API restart | Playing; ready state 4, 1080 × 1920, 30.03 seconds, no media error |
| Video seeking | HTTP 206 and expected byte range |
| Sharing preparation in owner browser | Real file fetched; button changed to “Share now”; no external share sent |
| Duplicate upload completion | Returned the same job |
| Second-owner access | Denied |
| Separate deletion smoke | Passed; clip disappeared and the previously issued media URL was revoked |
| Firebase API | 15 emulator-backed tests passed; TypeScript build passed |
| Owner app | 15 tests passed; typecheck and production build passed |
| OpenShorts worker | 12 tests passed, including lease loss and completion-response retry |
| Swift camera | 15 assertions passed; Debug and Release simulator builds passed before final generation fix; changed Debug target rebuilt successfully afterward |
| Integration review | Original findings resolved; owner settings subsequently checked for unsupported placeholder claims |
| Local launcher and smoke script | Syntax checks passed; API, owner and continuous worker started successfully |

The real output SHA-256 is `94cfe4cdd48fc369e5313fd00f25a76234b16a0cab22c5e040af6742b7588295`. Local machine-readable run records are retained in ignored `.runtime/smoke/real-result.json` and `.runtime/smoke/deletion-result.json`. A copy of the actual detailing output is saved beside this checkout as `../ContentStation-connected-test-clip.mp4`; test footage is not committed to Git.

## Open and restart

- Owner website: http://127.0.0.1:4311/
- Local Firebase console: http://127.0.0.1:4000/
- Fictional test owner: `(415) 555-0198`; obtain a fresh verification code from the local Auth emulator if sign-in is required. No real SMS is sent.
- Run `npm run dev` from this checkout to start local services. Dependencies are already installed here; a fresh checkout first needs `npm run setup` and the prerequisites in the root README.

The displayed camera is an API capture simulator. Its status becomes offline when the test stops sending heartbeats. This does not indicate a paired physical phone.

## What remains before a live pilot

- Select the existing Firebase project with separate v2 resources, or a new project. Configure hosted API/worker, private storage, owner HTTPS hosting, secrets, scheduler and phone sign-in. No cloud resources or production rules have been changed.
- Configure an actual sender before enabling daily clip messages. Push notifications, team management, billing and a full settings editor are not implemented. Settings now describes available shop facts and view-only controls without invented charges, staff or active face blur.
- Build a new camera app against the hosted API, then verify actual recording, pairing, network interruption, restart, re-pairing and thermal behavior on an iPhone. The existing TestFlight build 7 has not been updated.
- Verify native mobile sharing on a handset. Browser preparation and gesture-order tests passed; no physical share sheet or external post was exercised.
- Assess clip selection quality on consenting pilot footage and explicitly configure AI analysis if desired.

See `docs/HOSTED-SETUP.md` for concrete hosting steps and the other reports here for implementation details. Changes are on `codex/connect-v2`, based on `contentstation-v2`; the old `main` system remains untouched.
