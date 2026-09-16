# Active Firebase contract

This is the current contract for the Firebase API, owner website, iPhone camera and clipping worker. The owner interface and JSON types live in [Api.ts](../owner-app/src/api/Api.ts) and [types.ts](../owner-app/src/api/types.ts); camera wire models live in [Models.swift](../wall-app/Sources/Network/Models.swift).

## Base URLs and authentication

`VITE_API_BASE_URL` for the owner and `CS_API_BASE_URL` for the wall point directly to the API origin. Routes are appended directly. There is no `/functions/v1/api` suffix and no anon key requirement.

- Owner requests: `Authorization: Bearer <Firebase ID token>`. Firebase phone Auth handles code sending/verification in the browser, including reCAPTCHA. The old API OTP endpoints are not used.
- Wall requests: `Authorization: Bearer <device_jwt>` from pairing. JWTs bind a device, shop and token version; replacing a device revokes old credentials server-side.
- Worker requests: `x-engine-key`. No Firebase service-account credentials on the worker.
- Cron requests: `x-cron-secret` for `/internal/cron/tick`.
- Media: scoped, time-limited API capabilities. The API authorizes the target object again on access, supports byte ranges, and revokes deleted media. URLs must be treated as temporary secrets.

All owner membership and roles are managed on the server. New data uses `cs2_` Firestore collections and `v2/` object paths. Direct client Firestore/Storage access is denied for this system; only the API's runtime service account accesses them. Do not overwrite access rules used by an older app in a shared project.

## Owner and wall

The owner `Api` interface is implemented in `owner-app/src/api/firebase.ts`; existing shop, pairing, camera, hours and clip routes keep their original JSON shapes. `GET /health` includes `backend`, `emulator` and `project_id`. `GET /me` resumes onboarding from actual persisted shop/device/reference/hours state.

Config adds `reference_frame_revision: string | null`. It changes only when a new reference is saved. The wall must never interpret a renewed signed URL as a reference change. Onboarding and re-framing use the revision with `framing_until`; queue items carry the original pairing's device ID and cannot move between pairings. Replacing a physical camera still needs hardware framing verification.

Segment upload keeps the existing protocol: request upload URL with UTC `start_ts`/`end_ts`; PUT MP4 bytes; call complete with path, bytes, dimensions and fps. Completion verifies stored object metadata and creates one deterministic job per segment. Repeated completion returns the same segment/job IDs.

Owner clips support caption edits, open/share/skip/report events, deletion and private media. Mark a clip shared only after a successful native share operation. Browser permissions and chosen destination remain under the owner's control. Configured Postiz accounts support owner-approved publishing and scheduling through the routes below; there is no unattended posting.

## Publishing (self-hosted Postiz)

Owner routes, all scoped to the signed-in owner's shop. They exist only when the API has `POSTIZ_URL`, `POSTIZ_JWT_SECRET` and `PUBLISHING_SECRET`; otherwise `GET /publishing/accounts` returns `{ configured: false }` and the other routes answer 503 `publishing_unconfigured`.

```text
GET    /publishing/accounts                       -> { configured, providers: [{id,label}], accounts: Account[], connect_completed_at }
POST   /publishing/accounts/connect               { provider }        -> { url, provider }   (send the browser to url)
POST   /publishing/accounts/:id/reconnect         { provider }        -> { url, provider }
DELETE /publishing/accounts/:id                                       -> { ok: true }        (queued posts to it are cancelled)
POST   /publishing/webhooks/connected             { params }          -> { ok: true }        (called by Postiz; JWT signed with its secret)
POST   /clips/:id/publish                         { account_ids, schedule_at?, idempotency_key } -> Publication (201 new, 200 repeated)
GET    /clips/:id/publications                                        -> { publications: Publication[] }
GET    /publications/:id                                              -> Publication
POST   /publications/:id/cancel                                       -> Publication        (409 nothing_to_cancel once final)
```

`Account` is `{ id, provider, provider_label, name, profile, picture, disabled }`; `disabled` means the platform authorization must be renewed. `Publication` is `{ id, clip_id, kind: "now"|"schedule", scheduled_at, requested_at, timezone, caption, state, late, cancel_requested, channels: [{ account_id, provider, provider_label, name, state, live_url, error, updated_at }], last_error, created_at, updated_at }`. Publication states: `preparing`, `sending`, `queued`, `uncertain`, `published`, `partial`, `failed`, `cancelled`. Channel states: `pending`, `queued`, `uncertain`, `published`, `failed`, `cancelled`.

The caption published is the clip's saved caption at the time of the request. `schedule_at` is an ISO instant at least two minutes ahead and within 90 days; the API keeps the owner's minute and gives each publication a distinct second. The publication ID derives from the shop and `idempotency_key`, so a repeated request returns the existing record. Outcomes come from polling Postiz (on reads that find a stale active record, and from the maintenance tick); an unanswered send is reconciled by exact time and channel before anything is sent again. Responses never contain organization keys. Firestore holds `cs2_publishing_orgs` (one per shop, key encrypted with `PUBLISHING_SECRET`) and `cs2_publications`.

Deleting a clip cancels its queued posts; already published posts and the media copy inside Postiz remain. Errors: `provider_unavailable`, `account_missing`, `account_disabled`, `accounts_missing`, `invalid_accounts`, `invalid_schedule`, `publication_missing`, `nothing_to_cancel`, `publishing_busy`, `publishing_unavailable`, `publishing_unconfigured`.

## Worker

```text
POST /engine/jobs/claim             {worker,max}
POST /engine/jobs/:id/heartbeat     {lease_token}
POST /engine/jobs/:id/upload-urls   {lease_token,index}
POST /engine/jobs/:id/done          {lease_token,clips}
POST /engine/jobs/:id/failed        {lease_token,error}
```

Claim returns `{jobs:[{id,lease_token,lease_expires_at,attempts,segment:{id,shop_id,device_id,path,download_url,start_ts,end_ts,bytes,width,height,fps}}]}`. Lease duration is 120 seconds; the worker renews every 30 seconds. `upload-urls` returns `{path,thumb_path,video_upload_url,thumb_upload_url}` for a deterministic index from 0 through 19. Upload with the specified content type.

Each completion clip is `{path,thumb_path,duration_s,caption,source_start_s,source_end_s}`. Completion verifies uploaded outputs, rejects stale leases, atomically persists deterministic clip records, and returns `{clip_ids}`. Identical retries after a lost response return the same IDs. A different result for the same completed job conflicts. Three failed attempts exhaust the job. Expired claims are recovered; deleting the source cancels future generation.

The new Python worker calls the actual pinned OpenShorts implementation. Local mode selects a high-motion window and uses its renderer; AI mode delegates selection to upstream with explicit model credentials. Upstream captioned deliverables are honored. Neither mode directly publishes clips.

## Retention, notification and deployment boundaries

Cron retries pending deletes, expires raw footage and abandoned uploads, recovers abandoned claims, detects stale cameras and handles scheduled delivery. Deletion becomes inaccessible immediately and storage removal can retry. Dry-run/disabled SMS does not acknowledge delivery. Live provider acceptance is recorded separately from handset delivery; a crash between acceptance and acknowledgement may cause a duplicate notification retry.

Local services use Auth, Standard Firestore and Storage emulators under `demo-contentstation-v2`. The smoke script refuses a hosted target. Hosted services require separate configured HTTPS endpoints, secrets, project/bucket, rules and scheduled ticks. No emulator host setting belongs in a hosted environment.
