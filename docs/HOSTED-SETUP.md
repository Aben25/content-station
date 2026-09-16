# Hosted ContentStation

Deployed September 14, 2026, to the existing Firebase/Google project `lemekeru` (display name `sutway`). The owner explicitly authorized replacing the nonfunctional old Content Station. The active app uses the default Firestore database and `lemekeru-content-station` bucket. No existing data was deleted during deployment; rules now deny direct client access, and the authenticated API mediates access.

| Component | Deployed target |
| --- | --- |
| Owner website | https://lemekeru.web.app |
| API | https://contentstation-api-233122534259.us-central1.run.app |
| Database | `lemekeru / (default)`, `cs2_` collections |
| Private media | `gs://lemekeru-content-station/v2/` |
| Renderer | Cloud Run worker pool `contentstation-render`, `us-central1` |
| Maintenance | Cloud Scheduler `contentstation-maintenance`, every minute |
| Camera | iOS `com.contentstation.station`, App Store Connect app `6793229212` |

## Deployment configuration

`firebase.hosted.json` deliberately targets the existing project resources. `firebase.json` remains the local emulator configuration. Always supply the explicit gcloud project: another project may be selected locally.

The API runs one CPU, 1 GiB RAM, concurrency 8, minimum zero and maximum two instances. `API_HTTP2=true` and Cloud Run `--use-http2` must both be set. HTTP/2 is necessary for five-minute camera uploads exceeding Cloud Run's HTTP/1 request-size limit; the hosted test uploaded 58,869,803 bytes successfully.

The API service account is `contentstation-api@lemekeru.iam.gserviceaccount.com`. It has Firestore access, Firebase Auth viewer access for revoked-user checks, object access on the Content Station bucket, and access to four individual secrets. `DEVICE_JWT_SECRET`, `MEDIA_SECRET`, `ENGINE_API_KEY` and `CRON_SECRET` come from Secret Manager. No service-account key is included in the image or apps.

The worker service account is `contentstation-render@lemekeru.iam.gserviceaccount.com`. It can read only the engine secret; job leases and scoped media capabilities mediate its data access. Its pool runs one instance with two CPUs and 4 GiB RAM. It incurs compute charges while idle. Set its instances to zero to pause processing, and restore one to resume. The API continues queuing work while it is stopped, subject to raw-footage retention.

The container pins OpenShorts at `5a6f42807576eda572673b32f8c7625cb6d82a3c`, uses CPU-only PyTorch and preloads the detection model. See [hosted render evidence](reports/hosted-verification.md) and the current [worker build instructions](../engine-worker/README.md#cpu-container). `ENGINE_MODE=local` means motion-based window selection running on Google Cloud; a Mac does not need to stay running. Optional AI editorial selection has not been enabled or quality-validated.

The Scheduler makes authenticated POSTs to `/internal/cron/tick`. Cloud Scheduler logs confirm actual HTTP 200 dispatches. It handles retention, stale devices and expired leases. `SMS_MODE=dry-run` intentionally prevents daily clip notifications; a real sender is still required. Firebase phone sign-in is a separate service and is enabled. Hosted authentication tests use two configured fictional phone numbers; their codes remain in ignored local configuration. Real carrier delivery has not been tested.

## Rebuild and deploy

API image: build from the repository root with `deploy/api-cloudbuild.yaml`. Deploy with `deploy/api.env.yaml`, HTTP/2 enabled, the API service account, and Secret Manager mappings. Worker image: build `engine-worker/` using `deploy/worker-cloudbuild.yaml`, then deploy its immutable digest with `deploy/worker.env.yaml` and its engine secret. Never substitute local emulator configuration.

Explicitly override all local Vite settings when building the owner website:

```sh
VITE_FIREBASE_API_KEY=AIzaSyAFxKYI_ViLFAxjk2b1EcCn2B9ctYvn6-E \
VITE_FIREBASE_PROJECT_ID=lemekeru \
VITE_FIREBASE_AUTH_DOMAIN=lemekeru.firebaseapp.com \
VITE_API_BASE_URL=https://contentstation-api-233122534259.us-central1.run.app \
VITE_FIREBASE_AUTH_EMULATOR_URL= VITE_DEMO_MODE=false \
npm --prefix owner-app run build
npx firebase-tools deploy --project lemekeru --config firebase.hosted.json --only hosting
```

Firebase web configuration is public project identification, not an administrative credential. Backend secrets and fictional test login codes must remain private.

## Publishing service (planned, not provisioned)

Owner-approved publishing needs a self-hosted Postiz instance ([postiz/README.md](../postiz/README.md)). It requires persistent PostgreSQL, Redis, Temporal with Elasticsearch, a public HTTPS address for the platform OAuth redirects and for the media the platforms fetch, and a Meta developer app. Static Firebase Hosting and the request-driven Cloud Run API cannot host it. The candidate for the pilot is one Compute Engine VM (4 vCPU, 8 GB, 50 GB disk is upstream's recommendation) running `postiz/docker-compose.yml` behind a TLS reverse proxy, with `POSTIZ_BIND=127.0.0.1` so only the proxy reaches the container, scheduled `pg_dump` and uploads backups, and `DISABLE_SSRF_PROTECTION`/`NOT_SECURED` unset.

The API then needs `POSTIZ_URL=https://<postiz host>/api`, `POSTIZ_JWT_SECRET` (same value as the instance `JWT_SECRET`) and `PUBLISHING_SECRET`, all from Secret Manager, plus `OWNER_APP_URL` (already set). Redeploy the API with those secrets mapped and the owner website unchanged; publishing appears in Settings on its own. Estimated additional cost is the VM plus its disk; none of this has been created and no authorization for it has been given.

## Verification and remaining hardware work

See [hosted verification](reports/hosted-verification.md). `scripts/smoke-hosted.mjs` requires `--project lemekeru` and configured fictional test numbers. It uploads real footage through the camera endpoints and waits for the deployed worker. Its camera is an HTTP simulator, not an iPhone. `--deletion-fixture` uses a separate test shop so the main clip can be retained for browser review.

Physical pairing, preview, saved framing, recording, upload and cloud rendering passed on an iPhone 15 Pro Max running build 9. The first phone-generated clip fully decoded at 1080×1920 for 12 seconds. Wi-Fi loss/recovery, app restarts, switching networks and thermal behavior still need handset tests. The camera release points at the hosted HTTPS API and owner site. This pilot has no automatic face blurring, automatic social publishing, team management or billing implementation. Review clips before sharing.
