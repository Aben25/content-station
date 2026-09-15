# ContentStation shared contract

> Archived. This was the v2 Supabase contract; the Supabase code itself was removed from the tree (git history `ec404bd`). The active contract is [../FIREBASE-CONTRACT.md](../FIREBASE-CONTRACT.md). Owner/device JSON shapes below are still accurate; Supabase setup, SQL tables, implicit mock mode and the old unleased engine routes are not.

Read this before touching any of the three pieces. `docs/handoff/HANDOFF.md` owns behavior and architecture. The design files own visuals and copy. This file pins the seams between the wall app, the owner app, and the backend so the three can be built in parallel. Changes here need a matching change in every consumer.

No em dashes anywhere in code, copy, comments, or docs.

## 1. Product constants

`product.json` at the repo root is the single source for product name, support phone, URLs, and timing constants. Run `scripts/sync-product.sh` after editing it. The script copies it to:

- `supabase/functions/_shared/product.json`
- `owner-app/src/product.json`
- `wall-app/Sources/Generated/Product.swift`

Never hardcode the product name, the support number, or `cs.ai/start` anywhere else.

## 2. Backend surface

One Edge Function named `api` routes every path below. Base URL:

```
{SUPABASE_URL}/functions/v1/api
```

The function is deployed with `verify_jwt = false` and does its own auth. Every request also sends `apikey: {SUPABASE_ANON_KEY}`.

Auth headers:

- Owner or staff: `Authorization: Bearer {supabase access token}` from supabase-js phone OTP sign in.
- Wall device: `Authorization: Bearer {device_jwt}` issued by `POST /pair/claim`.
- Engine: `x-engine-key: {ENGINE_API_KEY}`.
- Cron: `x-cron-secret: {CRON_SECRET}`.

Timestamps are ISO 8601 in UTC with a `Z` suffix. Times shown to owners are converted to `shops.timezone` in the owner app.

Errors: HTTP 4xx or 5xx with body `{ "error": { "code": "snake_case", "message": "plain sentence" } }`. Messages follow the copy rules: say what happened and what to do.

### 2.1 Owner routes

```
POST /auth/otp/send          { phone }                       -> { ok: true }
POST /auth/otp/verify        { phone, code }                 -> { session }        (owner app normally calls supabase-js directly instead)
GET  /me                                                     -> { user, shop, device, onboarding_step }
POST /shops                  { name, type, instagram?, timezone? } -> { shop }
PATCH /shops/current         { name?, type?, instagram?, timezone?, hours? } -> { shop }
POST /pair/token             { ssid, password }              -> { pair_token, qr_payload, expires_at }
GET  /pair/status            ?pair_token=                    -> { state: "waiting"|"reading"|"connected"|"expired", device_id? }
GET  /camera/status                                          -> CameraStatus
POST /camera/pause           { until: "1h"|"today"|"indefinite" } -> CameraStatus
POST /camera/resume                                          -> CameraStatus
POST /camera/framing/start                                   -> { framing_until }
GET  /camera/preview                                         -> { url, captured_at } | 204 when none yet
POST /camera/reference-frame                                 -> { reference_frame_path }
POST /camera/unpair                                          -> { ok: true }       (Replace camera: old device drops to waiting)
GET  /clips                  ?date=YYYY-MM-DD (shop local, default today) -> { date, clips: Clip[], older: [{ date, count }] }
GET  /clips/:id                                              -> Clip
PATCH /clips/:id             { caption }                     -> Clip
POST /clips/:id/event        { type: "open"|"share"|"skip"|"report", reason? } -> Clip
DELETE /clips/:id                                            -> { ok: true }       (deletes clip file, thumb, and source segment)
GET  /shop/hours/suggest     ?name=&type=                    -> { hours, source: "google"|"default" }
GET  /health                                                 -> { ok, at }
POST /sms/inbound            Twilio form webhook              -> TwiML reply with the start link
```

`onboarding_step` is one of `shop | wifi | qr | frame | hours | done`. The owner app resumes there after sign in. Rules: no shop row means `shop`. Shop but no paired device means `wifi`. Paired device with no reference frame means `frame`. Reference frame but no hours means `hours`. Otherwise `done`.

CameraStatus:

```json
{
  "device_id": "uuid",
  "status": "recording",
  "status_code": null,
  "status_since": "2026-09-13T16:02:00Z",
  "paused_until": null,
  "pause_mode": "none",
  "last_seen_at": "2026-09-13T16:14:00Z",
  "wifi": "strong",
  "thermal": "nominal",
  "battery": 100,
  "storage_free_mb": 41230,
  "last_thumb_url": "https://...signed",
  "hours": { "mon": { "open": "09:00", "close": "19:00" }, "sun": null },
  "timezone": "America/Los_Angeles",
  "workstation": "chair 1",
  "next_delivery_at": "2026-09-14T15:00:00Z"
}
```

`status` values: `waiting reading connecting framing recording paused nointernet reframe hot fault offline idle`. `offline` is set by the server when no heartbeat arrives for `heartbeatAlertMinutes`. `idle` means outside recording hours. The owner app maps these to the four prototype states: `recording` and `idle` show green, `nointernet` and `offline` and `paused` show yellow, `reframe` `hot` `fault` show red. `wifi` is one of `strong good weak none`. `thermal` is one of `nominal fair serious critical`, shown as a word (Normal, Warm, Hot, Cooling down).

Clip:

```json
{
  "id": "uuid",
  "caption": "Clean skin fade, start to finish.",
  "duration_s": 14,
  "status": "new",
  "created_at": "...",
  "delivered_at": "...",
  "video_url": "https://...signed, 1 hour",
  "thumb_url": "https://...signed, 1 hour",
  "source_seconds": 42
}
```

Pause semantics. `1h` sets `paused_until = now + 1h`. `today` sets `paused_until` to the next opening time in shop local time (tomorrow 9:00 AM in the prototype). `indefinite` sets `pause_mode = indefinite` and `paused_until = null`. Resume clears both.

### 2.2 Device routes

```
POST /pair/reading           { pair_token }                  -> { ok }             (no auth, call right after Wi-Fi joins so the owner sees "Reading")
POST /pair/claim             { pair_token, serial, model, app_version } -> { device_jwt, device_id, shop: { id, name, type, workstation }, config: Config }
POST /device/heartbeat       Heartbeat                        -> Config
GET  /device/config          ?since={iso}&wait={0..25}        -> Config           (long poll, see below)
POST /device/status          { status, code? }                -> { ok: true }
POST /device/segment/upload-url { start_ts, end_ts }          -> { path, upload_url, expires_at }
POST /device/segment/complete { path, start_ts, end_ts, bytes, width, height, fps } -> { segment_id, job_id }
POST /device/preview         body: image/jpeg                 -> 204
POST /device/thumb           body: image/jpeg                 -> 204              (latest still, sent at most once a minute)
```

Heartbeat body:

```json
{
  "battery": 100,
  "thermal": "nominal",
  "wifi": "strong",
  "storage_free_mb": 41230,
  "state": "recording",
  "code": null,
  "app_version": "1.0.0",
  "recording_seconds_today": 7200
}
```

Config (returned by claim, heartbeat, and config):

```json
{
  "server_time": "2026-09-13T16:14:00Z",
  "updated_at": "2026-09-13T16:10:00Z",
  "hours": { "mon": { "open": "09:00", "close": "19:00" }, "tue": ..., "sun": null },
  "hours_confirmed": false,
  "timezone": "America/Los_Angeles",
  "paused_until": null,
  "pause_mode": "none",
  "framing_until": null,
  "reference_frame_url": null,
  "unpaired": false,
  "workstation": "chair 1"
}
```

Long poll: `GET /device/config?since={updated_at from the last config}&wait=25` returns immediately if the device's `config_updated_at` is newer than `since`, otherwise holds up to `wait` seconds checking once a second, then returns the current config with HTTP 200 either way. The device re-issues the request immediately after each response. Owner actions that bump `config_updated_at`: pause, resume, framing start, reference frame saved, hours changed, unpair. This gives sub-second reaction without Realtime.

Heartbeat every `heartbeatSeconds`. The heartbeat response is also a Config, so a device that has lost the long poll still converges within a minute.

Segment upload: call `segment/upload-url`, PUT the MP4 to `upload_url` with a background URLSession upload task (headers `Content-Type: video/mp4` and `x-upsert: true`), then call `segment/complete`. `hours` in Config is the default schedule until `hours_confirmed` is true; record on the default schedule either way. Both device calls are idempotent on `path`. Retry with backoff on any failure. Out of order arrival is fine.

Preview streaming: while `framing_until` is in the future, POST a JPEG at `previewFps` per second to `/device/preview`. Long edge 960 px, JPEG quality 0.6. Stop when `framing_until` passes or the reference frame arrives in Config.

### 2.3 Engine routes

The clipping engine is external. Its real input format is an open question in the handoff. Until confirmed, the contract is a job queue plus an optional webhook.

```
POST /engine/jobs/claim      { worker, max }                  -> { jobs: [{ id, segment: { id, shop_id, device_id, path, download_url, start_ts, end_ts, bytes, width, height } }] }
POST /engine/jobs/:id/done   { clips: [{ path, thumb_path, duration_s, caption, source_start_s, source_end_s }] } -> { clip_ids }
POST /engine/jobs/:id/failed { error }                        -> { ok: true }
```

If `ENGINE_WEBHOOK_URL` is set, `segment/complete` also POSTs `{ job_id, segment }` to it with header `x-engine-key`. The engine writes clip files into the `clips` bucket under `{shop_id}/{clip_id}.mp4` and thumbs under `thumbs/{shop_id}/clips/{clip_id}.jpg`, then calls `jobs/:id/done`.

### 2.4 Cron

`POST /internal/cron/tick` with `x-cron-secret`, called every minute by pg_cron. It runs: daily delivery for shops whose local time just crossed `deliveryHourLocal`, segment deletion after `rawRetentionHours`, heartbeat pruning after 7 days, pair token expiry, offline detection and alerts.

## 3. Data model

See `supabase/migrations/0001_init.sql`. Summary of what differs from the handoff sketch, all additive:

- `devices` gains `pause_mode`, `framing_until`, `config_updated_at`, `status_code`, `status_since`, `model`, `last_thumb_path`, `unpaired_at`.
- `shops` gains `workstation` (the "chair 1" string in copy) and `delivery_hour`.
- `segments` gains `width`, `height`, `fps`.
- `clips` gains `source_start_s`, `source_end_s`.
- New `engine_jobs` table.
- `notifications.channel` also allows `ops` for alerts to us.
- `devices.status` also allows `idle`.

Storage buckets, all private:

- `segments/{shop_id}/{device_id}/{start_ts_unix_ms}.mp4`
- `clips/{shop_id}/{clip_id}.mp4`
- `thumbs/{shop_id}/clips/{clip_id}.jpg`
- `thumbs/{shop_id}/device/{device_id}/latest.jpg`
- `thumbs/{shop_id}/device/{device_id}/preview.jpg`
- `thumbs/{shop_id}/device/{device_id}/reference.jpg`

Hours JSON: keys `mon tue wed thu fri sat sun`, value `{ "open": "HH:MM", "close": "HH:MM" }` in 24 hour shop local time, or `null` for closed. The default when nothing is known is Mon to Sat 09:00 to 19:00, Sunday closed.

## 4. QR payload

```
base64( JSON.stringify({ v: 1, ssid, password, pair_token }) )
```

Standard base64, no line breaks. `pair_token` is 12 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, single use, expires after `pairTokenMinutes`. Never put it in a URL. The owner app renders the QR at full content width with error correction level L to keep modules large. The wall app sets `videoZoomFactor` to 2.0 while in `waiting` so a phone held 6 to 8 feet away decodes.

## 5. Device identity and JWT

The wall app generates a UUID once, stores it in the Keychain, and sends it as `serial`. The device JWT is HS256 signed with `DEVICE_JWT_SECRET`, claims `{ sub: device_id, shop_id, role: "device", iat, exp }`, one year expiry. Store it in the Keychain. If any device route returns 401, drop to `waiting` and show the code.

The short code shown in `waiting` is the first four characters of the device UUID, uppercased, with 0, O, 1, I mapped away. It is for support conversations only.

## 6. Wall app state machine

States and copy are exactly those in `docs/handoff/design/project/Wall App.dc.html`. The device reports every transition with `POST /device/status`. Server-side mapping: `nointernet_long` is reported as `nointernet` with `code: "long"`.

Transitions:

- `waiting` on first boot, after unpair, after 401. Camera runs with QR metadata output, zoom 2.0.
- `reading` when a QR decodes. Hold 1.5 s minimum so the owner sees "Got it."
- `connecting` while joining Wi-Fi with NEHotspotConfiguration and calling `pair/claim`. Progress bar. On failure show `fault` with code `W-01` (Wi-Fi join failed) or `P-01` (claim failed), then return to `waiting` after 20 s so the owner can retry from the QR screen.
- `framing` when Config has `framing_until` in the future. Stream previews. Exit when `reference_frame_url` becomes non null or `framing_until` passes.
- `recording` inside hours, not paused, healthy. Black screen, amber glow, dot. Capture is motion gated.
- `idle` outside hours. Screen black, no glow. Report `idle`. Not a design state, it is just a black screen.
- `paused` when `pause_mode != none` and (`paused_until` is null or in the future). Line one uses the resume time in shop local time, or "Paused until you resume" for indefinite.
- `nointernet` when heartbeat and config calls have failed for `nointernetMinutes`. After `nointernetLongMinutes` switch copy to the long variant. Keep capturing and buffering. Return to the previous state on the first successful call.
- `reframe` when drift is detected. Keep recording. Exit when a new reference frame is saved.
- `hot` when `ProcessInfo.thermalState == .critical`. Stop capture. Resume automatically at `.serious` or better. At `.serious` keep capturing at 720p.
- `fault` for anything unrecoverable. Show the support number and a code. Codes: `E-31` unknown, `W-01` Wi-Fi join, `P-01` pair claim, `S-01` storage full, `C-01` camera unavailable.

Priority when several apply: `hot` > `fault` > `framing` > `paused` > `reframe` (display only, keeps recording) > `nointernet` (display only, keeps recording) > `recording` or `idle`.

## 7. Capture rules

- Session preset 1920x1080 at 30 fps, rear wide camera, exposure and white balance locked after framing to avoid flicker. Fall back to 1280x720 at thermal `.serious`. The phone is mounted in portrait, so frames are rotated at the output and segment files are 1080x1920 (720x1280 in fallback). `segment/complete` reports the file's width and height.
- Motion gate: every 4th frame, downscale luma to 32x32, mean absolute difference against the previous sample. Motion when diff > 6 (0 to 255 scale). Start writing on motion, keep a 3 s pre roll from a ring buffer, stop after 8 s without motion. Cap each file at `segmentMinutes`. Files that end up under 4 s are discarded.
- H.264, AVAssetWriter, fragmented so a crash mid segment leaves a playable file where possible.
- Ring buffer on disk under Application Support/segments. Delete a file after `segment/complete` succeeds, or after `rawRetentionHours` whichever first. Refuse to record and show `fault S-01` when free space drops under 1 GB.
- Thumbnail: one JPEG per minute to `/device/thumb`, long edge 480 px.
- Drift: at framing, keep the reference luma at 64x64 in memory and on disk. Every 5 minutes, during a window with no motion, compare the current 64x64 luma to the reference. Drift when mean absolute difference > 28 for three consecutive checks. Send `status reframe`. Clear when a new reference arrives.
- Heartbeat every 60 s regardless of state.

## 8. Owner app rules

- Mobile web, Vite plus React plus TypeScript. No dependency over 1 MB. `qrcode` for the QR and `@supabase/supabase-js` are allowed.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` select the real backend. When both are absent the app runs against an in memory mock that reproduces the prototype's data and timing so the whole flow can be clicked through with no backend.
- Routes are hash based: `#/start` sign in, `#/code`, `#/onboarding/shop`, `#/onboarding/wifi`, `#/onboarding/qr`, `#/onboarding/frame`, `#/onboarding/hours`, `#/onboarding/done`, `#/home`, `#/clips/:id`, `#/camera`, `#/camera/frame`, `#/camera/rescan`, `#/camera/rescan/wifi`, `#/camera/rescan/qr`, `#/camera/replace`, `#/settings`.
- Share uses `navigator.share` with the clip file when supported, otherwise opens the signed URL. Download uses the signed URL with the `download` attribute.
- Every user facing string comes from the prototype. Dynamic values (times, names, counts) are formatted in shop local time.
