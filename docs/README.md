# Documentation map

Start with [HANDOFF-PLAN.md](../HANDOFF-PLAN.md) at the repository root: it records what is deployed, what was verified, the current direction and what remains. [ARCHITECTURE.md](ARCHITECTURE.md) maps the code.

## Live references

| Document | What it is for |
| --- | --- |
| [FIREBASE-CONTRACT.md](FIREBASE-CONTRACT.md) | The API contract the camera app, owner website, worker and publishing screens are built against: authentication, routes, JSON shapes, media capabilities, publishing. |
| [HOSTED-SETUP.md](HOSTED-SETUP.md) | The deployed Google Cloud/Firebase resources, how to rebuild and deploy, and the planned (not provisioned) Postiz hosting. |
| [../postiz/README.md](../postiz/README.md) | The pinned self-hosted Postiz stack: routes used, limits, backups, upgrades. |
| [handoff/](handoff/) | The supplied product handoff and visual design (`design/`). The visuals are authoritative; the technical assumptions in `HANDOFF.md` are superseded by the contract above. |

## Verification reports

Each report records one pass of evidence, with what it does and does not prove.

| Report | Covers |
| --- | --- |
| [reports/hosted-verification.md](reports/hosted-verification.md) | Hosted deployment, real upload → cloud render → playback, TestFlight build, physical iPhone capture. |
| [reports/connected-verification.md](reports/connected-verification.md) | Local end-to-end run through the Firebase emulators and the real renderer. |
| [reports/postiz-local-verification.md](reports/postiz-local-verification.md) | Self-hosted Postiz: organization isolation on the pinned instance, API publishing tests, owner screens. |
| [reports/backend.md](reports/backend.md), [reports/owner.md](reports/owner.md), [reports/wall.md](reports/wall.md), [reports/cloud-worker.md](reports/cloud-worker.md) | Component build reports from the Firebase rebuild. |
| [reports/review-firebase-owner.md](reports/review-firebase-owner.md), [reports/review-wall-worker.md](reports/review-wall-worker.md), [reports/integration-fixes.md](reports/integration-fixes.md) | Review findings and the fixes made for them. |

## Archive

Superseded documents kept for their reasoning. Nothing in `archive/` describes the running system.

| Document | Why it is kept |
| --- | --- |
| [archive/SUPABASE-CONTRACT.md](archive/SUPABASE-CONTRACT.md) | The first backend's contract. Its owner/device JSON shapes and the wall app state machine are still accurate; the Supabase specifics are not. The code was removed from the tree (git history `ec404bd`). |
| [archive/FIREBASE-INTEGRATION-PLAN.md](archive/FIREBASE-INTEGRATION-PLAN.md) | The task breakdown used for the Firebase rebuild. |
| [archive/EARLY-ASSUMPTIONS.md](archive/EARLY-ASSUMPTIONS.md) | Decisions taken before the rebuild and why. |
