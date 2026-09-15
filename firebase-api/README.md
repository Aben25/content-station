# Firebase API

Node 22+, Firebase Admin, Fastify. This replaces the legacy Supabase API surface. It uses the real Auth, Firestore and Storage emulators locally; there is no in-memory database substitute. Run from the repository root:

```sh
npm --prefix firebase-api ci
npm --prefix firebase-api run build
npm --prefix firebase-api run dev
```

Export the values in `.env.example` first, or use the repository local launcher. The API deliberately does not load secret files implicitly. All four application secrets must have at least 32 characters. `API_BASE_URL` must be reachable by the owner, device and worker; localhost works for local smoke, while a physical phone needs the host's LAN address. The API binds loopback unless `HOST` is set. Cloud Run uses application default credentials and a private storage bucket, with no downloaded service-account private key.

`FIRESTORE_DATABASE_ID` selects the Firestore Standard database; unset defaults to `(default)`. The authorized hosted pilot uses project `lemekeru`, database `(default)` and `cs2_` collections; see [hosted setup](../docs/HOSTED-SETUP.md). Explicit `buildApp({ databaseId })` overrides the environment so emulator tests remain isolated.

The owner authenticates through the Firebase client SDK and sends its ID token. The API verifies revocation and reads `cs2_memberships`; creating a shop atomically creates its owner membership. Client Firestore and Storage access is denied by the included rules. No owner can supply their own membership or device token. Phone OTP wrapper routes return 410 with a Firebase SDK instruction.

Pair claims use Firestore transactions. A pair code can be claimed once; an identical serial can retry only while the resulting device is still paired. Replacing or unpairing a device invalidates its operations while `/device/config` can tell the former device that it is unpaired. Saved reference frames have a stable explicit revision.

## Media and jobs

Media URLs are one-hour API-signed capabilities, bound to an object, operation and database record. Engine upload capabilities also bind the current two-minute job lease. They work on the Storage emulator and in Cloud Run with ordinary bucket permissions. Video reads support HTTP byte ranges. Every request checks tombstones and current pairing or lease state; deleted media capabilities stop working immediately. Uploads stream to Cloud Storage with size limits, type restrictions and an immutable create precondition. Retries preserve an existing object. Failed concurrent uploads only clean up the generation they created.

Segment completion verifies stored size and content type, then creates deterministic segment and job IDs in one transaction. The worker validates the MP4 itself. Job claims are atomic, expire after 120 seconds, renew through heartbeat, and stop after three attempts. Output paths are deterministic per job/index. Completion checks stored output objects and atomically creates deterministic clip IDs; identical completion retries return the same IDs. Replaced or expired leases cannot mutate a job.

Deletion tombstones the clip and source and cancels the source job before touching storage. Storage failures return 503 with `deletion_pending`; retrying the deletion or cron finishes it. Existing sibling clips remain available, but the source cannot produce new clips. Cron also expires incomplete raw uploads and retries failed object deletion. Raw source retention is configured in root `product.json`.

## SMS

`SMS_MODE=disabled` is the default. `dry-run` records a dry-run notification without sending or setting `delivered_at`. `live` requires Twilio configuration. Daily delivery acquires a transactional notification lease, waits for the provider's successful response, and only then marks clips delivered. Provider failures remain retryable. A process crash after provider acceptance but before the database acknowledgement can cause a duplicate text on retry; provider acceptance is not proof of handset delivery. The signed Twilio inbound webhook is available only when configured.

## Verification

Start Auth, Firestore and Storage emulators using the root configuration, export their hosts, then:

```sh
npm --prefix firebase-api test
```

The main integration tests use the configured Auth emulator project and an isolated named Firestore emulator database, `backend-tests`, with unique fixture owners and shops. They cancel their own pending jobs afterward and cannot claim the launcher worker's jobs or change its delivery records. Retention/concurrent-upload tests use a separate `demo-cs2-retention-tests` emulator project. Tests force exit after completion because the Google Storage client's interrupted-upload retry timers otherwise linger.

A narrow `gaxios` dependency override selects patched `uuid` 11.1.1 or later; its stable `v4()` API is used for multipart boundaries. Firebase Admin 14.4 and this override leave `npm audit` with zero known vulnerabilities.

No hosted resources, rules, texts or deployments are created by build or test commands. The API is already deployed in the authorized project `lemekeru`; see [hosted setup](../docs/HOSTED-SETUP.md) and [verification](../docs/reports/hosted-verification.md). Future deployments must retain the production project/bucket, HTTPS URLs, HTTP/2 upload support, managed secrets, service identity, scheduler authentication and deny-client-access rules. Remove emulator environment variables before deploying.
