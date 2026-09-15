# Assumptions and deviations to review (archived)

> Written for the Supabase prototype before the Firebase rebuild. Kept for the reasoning; the numbered items no longer describe the running system.

Everything here was decided without Abenezer in the room. Each one is cheap to reverse now and expensive later. Items marked (handoff open question) map to section 12 of `docs/handoff/HANDOFF.md`.

## Backend

1. Engine contract (handoff open question, blocks M2). Built a job queue: `segment/complete` inserts an `engine_jobs` row, the engine pulls with `POST /engine/jobs/claim` and reports with `jobs/:id/done` or `failed`. An optional `ENGINE_WEBHOOK_URL` also gets a POST per job. Swap to whatever the real engine wants once known.
2. Device commands use long polling (`GET /device/config?since=&wait=25`) instead of Supabase Realtime. One request per 25 seconds per camera, sub second reaction to pause, resume, and framing. Move to Realtime when fleet size makes the invocation count matter.
3. One Edge Function named `api` with an internal router, rather than one function per route. Same paths as the handoff, single deploy.
4. Owner app calls supabase-js for OTP directly. The `/auth/otp/*` routes exist as thin wrappers for other clients.
5. Push notifications are not built. Every "push" in the handoff is sent as SMS in v1. Web push on iOS needs the owner app installed to the home screen, which is a P1 decision.
6. Wi-Fi password is stored AES-GCM encrypted in `pair_tokens`, blanked the moment the camera claims, and the row is deleted an hour after expiry. The handoff says delete the row on claim; the row is kept briefly so `GET /pair/status` can report "connected" to the owner's phone.
7. Staff cannot delete clips (handoff open question). Staff can do everything else, including pause and re-frame.
8. "Rest of today" pause resumes at the next opening time from shop hours (tomorrow 9:00 AM in the prototype). If the shop has no future opening the pause becomes indefinite.
9. Daily delivery runs in a two hour window after `delivery_hour` shop local time and sends once. If the engine has produced nothing by the end of the window, nothing is sent that day.
10. Offline alerts: 5 minutes of silence marks the device offline, alerts us (a row in `notifications` with channel `ops`), and texts the owner once. A second text goes out at 2 hours with the support number.
11. Google Places prefill for hours is used only when `GOOGLE_PLACES_API_KEY` is set (handoff open question). Otherwise the default Mon to Sat 9 to 7 schedule is suggested and labeled as typical hours.
12. New route `POST /pair/reading` so the owner sees "Reading" the moment the camera is on Wi-Fi. New route `POST /device/thumb` for the once a minute still. New route `POST /sms/inbound` for the "Text START" card.
13. Device status enum gains `idle` (outside hours) and `offline` is set by the server.

## Wall app

14. XcodeGen project, iOS 17 deployment target, Swift 5 language mode. Outfit is a web font, the wall app uses the system font at the prototype sizes and weights.
15. Capture uses AVAssetWriter fed by a video data output rather than AVCaptureMovieFileOutput, so motion gating, thumbnails, drift checks and the QR reader share one session.
16. Motion gate and drift thresholds in `docs/CONTRACT.md` section 7 are starting points. Tune on a real shop.
17. The waiting screen code is derived from the device UUID and is for support only. It has no role in pairing.
18. Zoom factor 2.0 while waiting so a phone QR decodes from 6 to 8 feet. Needs a real test with an iPhone 12 at height.
19. Segments are portrait 1080x1920 (frames rotated at the video data output) because the phone is mounted in portrait and clips are vertical. The handoff says 1080p without an orientation. Confirm with the engine.
20. Pre roll is kept as compressed samples from a continuously running VideoToolbox encoder (about 4 MB) instead of raw frames (about 280 MB for 3 s). Keyframe every second, fragment every 2 seconds, so pre roll is 3 to 4 seconds. 8 Mbps at 1080p, 4 Mbps at 720p.
21. Drift checks additionally require 10 seconds without motion before comparing against the reference, and the reference luma is sampled from the local camera when the server reports a new reference frame, not downloaded from the JPEG.
22. Wi-Fi strength has no public RSSI API on iOS. Strong means a satisfied Wi-Fi path, good means another satisfied path, weak means recent failures, none means no path.
23. Unsigned simulator builds cannot use the Keychain (missing application identifier entitlement), so the Keychain wrapper falls back to a file store only for that specific error. Signed device builds use the real Keychain.
24. Faults W-01 and P-01 keep the camera running so waiting resumes instantly. S-01, C-01, and E-31 stop capture. Storage fault clears once free space passes 1.2 GB.

## TestFlight

31. The wall app ships as a new build of the existing App Store Connect record for the earlier Content Station station app (bundle id `com.contentstation.station`, app id 6793229212, listed as "Sutway", internal group "Sutway"). Version 1.0.0, build 7, above the July build 6. The `ai.contentstation.wall` App ID that was auto-registered for the first device build is unused.
32. App icon is a placeholder: black field, amber edge glow, one amber dot. Generated by a small CoreGraphics script, 1024x1024, no alpha.

## Owner app

25. Hash routes. Works from a text message link with no server rewrites.
26. The browser cannot read the current Wi-Fi name. The Network field is empty on real devices and the "We found the one your phone is on." sentence is hidden unless a name is known.
27. `?mock=fresh|offline|attention|paused|empty` on the mock build reproduces the full onboarding and the board's alternate states for review.
28. Prototype top paddings (120, 70, 66) map to the safe area inset plus 61, 11, and 7, since the prototype fakes a 59 point status bar. Bottom paddings use the safe area inset with the prototype value as a floor.
29. Copy the prototype does not have was written for: device states the board does not show (idle, hot, fault, waiting, framing), inline validation and network errors, an expired pair token, a resend confirmation, and a caption saved toast. All follow the copy rules and are easy to find by searching for the strings in `owner-app/src`.
30. Report reasons are sent as `wrong_moment`, `bad_crop`, `should_not_have_been_filmed`. Opening a clip records an `open` event.

## Not built (by design, per handoff priorities)

- Settings beyond the P1 stub, Team, Billing, weekly summary, printable sign, notification lock screen mockups.
- Auto posting, connected accounts, approve queue, multi location, motorized mounts.
- Ops fleet dashboard (the `devices`, `heartbeats`, and `notifications` tables are the plain table for now).
