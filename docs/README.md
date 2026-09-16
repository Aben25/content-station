# Documentation map

Start with [HANDOFF-PLAN.md](../HANDOFF-PLAN.md) at the repository root: it records what is deployed, what was verified, the current direction and what remains. [ARCHITECTURE.md](ARCHITECTURE.md) maps the code.

## Live references

| Document | What it is for |
| --- | --- |
| [FIREBASE-CONTRACT.md](FIREBASE-CONTRACT.md) | The API contract the camera app, owner website, worker and publishing screens are built against: authentication, routes, JSON shapes, media capabilities, publishing. |
| [HOSTED-SETUP.md](HOSTED-SETUP.md) | The deployed Google Cloud/Firebase resources, how to rebuild and deploy, and the planned (not provisioned) Postiz hosting. |
| [../postiz/README.md](../postiz/README.md) | The pinned self-hosted Postiz stack: routes used, limits, backups, upgrades. |
| [../owner-app/README.md](../owner-app/README.md) | Current owner web UI, local development, demo mode and checks. |
| [../scripts/clip-lab/README.md](../scripts/clip-lab/README.md) | Local clipping web UI, engine setup, AI configuration and drafts. |
| [../engine-worker/README.md](../engine-worker/README.md) | Shared OpenShorts renderer, worker settings, tests and container build. |
| [../wall-app/README.md](../wall-app/README.md) | Current iPhone camera app, configuration and build instructions. |

## Verification reports

These are the latest recorded hosted and Postiz verification passes, with their dates and limits. They describe prior runs, not checks repeated in every fresh checkout. Current automated coverage lives beside the apps and worker.

| Report | Covers |
| --- | --- |
| [reports/hosted-verification.md](reports/hosted-verification.md) | Hosted deployment, real upload → cloud render → playback, TestFlight build, physical iPhone capture. |
| [reports/postiz-local-verification.md](reports/postiz-local-verification.md) | Self-hosted Postiz: organization isolation on the pinned instance, API publishing tests, owner screens. |

## Earlier versions

Superseded design exports, prototype contracts, implementation plans and resolved review reports were removed from the working tree. They remain in Git history at `7b40583`. The separate old system is preserved on `main-old-system`. Use the current app source for UI behavior and the Firebase contract for integration work.
