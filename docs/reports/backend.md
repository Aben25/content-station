# Firebase backend integration report

Implemented the Firebase API in `firebase-api/`, with root emulator configuration, deny-all direct client Firestore/Storage rules, and an empty composite-index manifest. Queries use single-field filters and perform additional sorting in the API; no missing composite-index requirement is hidden by the emulator.

The owner, pairing, camera, device, clips, engine, cron and inbound SMS routes follow the integration plan. Firebase ID tokens replace Supabase sessions. Firebase Standard Firestore transactions protect server-owned memberships, pair claims and replay, segment/job creation, job leases, completion, deletion and daily delivery acknowledgement. `cs2_` collection names and `v2/` private object prefixes isolate this version from legacy data.

Media uses API-signed scoped capabilities, so neither local emulators nor hosted Cloud Run require a service-account private key to sign GCS URLs. Streaming uploads enforce type and byte limits with immutable object creation; HTTP range reads support seeking. File deletion immediately revokes media through tombstones, cancels future generation and retries failed storage operations. Failed concurrent uploads cannot delete another request's successful object generation. Abandoned raw uploads also expire and retry deletion.

Verification completed on 2026-09-14:

- `npm --prefix firebase-api run build`: passed.
- Firebase Admin upgraded to 14.4.0 with a narrow patched `gaxios`/`uuid` override; `npm audit --omit=dev` reports zero vulnerabilities.
- Main Fastify integration/auth suite: 10 tests passed with real Firebase Auth, Firestore and Storage emulators. Covers owner isolation; atomic single-use pairing and same-device retries; unpair replay rejection; deterministic completion retries; expired/replaced lease rejection and attempt exhaustion; storage deletion failure/retry; SMS failure/retry; stable reference revisions; absent/mismatched scoped uploads; private video range playback and deleted capability revocation; cron lease recovery; missing owner authentication.
- Additional isolated emulator suite: 2 tests passed. Covers abandoned raw upload retention with failed deletion retry, and concurrent failed upload safety. Each regression was observed failing before its fix.
- The initial missing-auth route test failed with 404 instead of 401. Initial contract scenarios failed against the route stub. The first complete route pass exposed and fixed Fastify's default URL parameter length rejection for signed media capabilities.
- No fake database was used. SMS and deletion failure adapters inject failure at the external provider boundary while database transitions and real object storage remain emulator-backed.

The root agent owns complete OpenShorts/owner browser smoke verification. These API tests use small fixture bytes to verify media transport and metadata boundaries; actual playable MP4 validation belongs to the worker and full smoke. They do not claim an iPhone capture test, a live SMS, a hosted deployment, or a production security review.

Operational limits and follow-up considerations:

- The daily SMS acknowledgement records provider acceptance, not handset delivery. A crash after provider acceptance but before Firestore acknowledgement may cause a duplicate retry. Disabled and dry-run modes never mark clips delivered.
- Cloud Run credentials, actual project/bucket, HTTPS URLs, owner origins, secrets, rules application and Scheduler setup require the separately authorized hosted configuration. Nothing was deployed.
- Main integration tests now use the isolated named Firestore emulator database `backend-tests`; they share only the configured Auth emulator and private uniquely scoped fixture objects. They cannot claim launcher worker jobs or update its delivery metadata. Earlier verification used the main emulator database; the final run is isolated. Retention/concurrency tests use a separate emulator project.
- Interrupted Storage SDK uploads can retain retry timers, so the test runner force-exits after all test results are collected.
