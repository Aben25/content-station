# ContentStation: Coding Agent Handoff

Read this whole file before writing any code. Then read the design files listed in section 9. Ask before deviating from anything marked **Decided**.

Working name: **ContentStation** (may be renamed to Filmhand; keep all product strings in one constants file so the swap is one edit).

---

## 1. What we are building

A phone mounted permanently on a shop wall films the work happening in the shop. A pipeline picks the best moments, cuts them into short vertical clips, and delivers them to the owner ready to post. The owner mounts the phone once and never touches it again.

**The promise:** you keep working, your Instagram fills itself.

**Why it wins:** every competitor requires effort. A phone on a tripod still needs editing. CapCut needs someone to sit down. An agency costs $1,500 to $5,000 a month and shows up once. This is always on, every job, zero owner time, for $100 to $300 a month.

**First customers:** car detailing and wrap shops, tattoo studios, barbershops. One fixed workstation, visually satisfying work, owners who know they should post daily and don't. Med spas later, once consent flow exists.

**Competitive context:** no direct competitor exists as of September 2026. Adjacent: sports auto-cameras (Trace, Veo, Pixellot) and business auto-posting software (Scale Social AI, Presly, Opus Clip). Nobody has fused always-on in-store capture with auto-clip and auto-post. Capture friction is the moat.

---

## 2. The three pieces

| Piece | What it is | Stack (default, confirm with Abenezer) |
|---|---|---|
| **Wall app** | iOS app on a mounted iPhone 12 or newer, locked in Single App Mode. Captures, uploads, reports health, shows status. | Swift, AVFoundation, background URLSession |
| **Owner app** | Mobile web app the owner opens from a text message link. Onboarding, clip review, camera status, settings. | Next.js or Vite + React, deployed to Vercel |
| **Backend** | Auth, device registry, storage, clip delivery, notifications. Hands segments to the existing clipping engine. | Supabase (Postgres, Storage, Edge Functions, Auth via phone OTP), Twilio for SMS |

The clipping engine already exists and is a separate service. Its input format is **TODO: confirm with Abenezer** before building the segment uploader. Assume until told otherwise: MP4 segments, H.264, 1080p, 5 minutes each, with a JSON sidecar (device_id, shop_id, start_ts, end_ts).

---

## 3. Decisions already made

Everything in this section is **Decided**. Do not re-litigate; ask if something seems wrong.

### Device
- iPhone 12 or newer, chosen over Android for the camera API (all lenses exposed, smooth zoom, manual exposure lock, consistent across devices).
- Fixed wide shot in v1. No motorized mount. Motion comes later via DockKit if clips prove out.
- Screen stays on at minimum brightness. Rear camera faces the work area, so the screen usually faces the wall and may not be visible from the floor. Status never depends on the wall screen alone.
- Every phone is supervised (Apple Business Manager, added via Apple Configurator) and enrolled in an MDM with Single App Mode. Passcode off, auto-lock off, iOS auto-update blocked. This is what makes the app relaunch after a power cut or crash.
- Ships with a spare in the box.

### Capture
- 1080p, motion-gated (record only when something is happening), 5 minute segments.
- Upload segments to Supabase Storage over Wi-Fi as each finishes. Buffer locally when offline. Ring buffer deletes segments once uploaded or after 48 hours.
- Heartbeat every 60 seconds: battery, temperature word, storage, Wi-Fi strength, small thumbnail. Silence for 5 minutes triggers an alert to us and a text to the owner.
- Thermal handling: watch ProcessInfo.thermalState. Serious: drop to 720p. Critical: pause capture, show "Cooling down". Resume automatically.
- Frame drift detection: compare current frame to the reference frame saved at framing. On drift, set device status to `reframe` and notify the owner.
- Recording hours are set by the owner. Outside hours the app is idle, screen black, no glow.

### Onboarding (the QR trick)
The wall phone is mounted high, so nobody types on it. Direction is reversed:
1. Owner opens the link on their own phone, signs in with phone number + 6-digit code.
2. Enters shop name, type, Instagram handle (optional).
3. Enters Wi-Fi name and password.
4. Owner's phone shows a QR code. Owner holds it up to the wall camera from 6 to 8 feet.
5. Wall phone reads the QR, joins Wi-Fi (NEHotspotConfiguration), registers to the account, shows a green check. Owner app advances by itself, no tap.
6. Owner sees a live preview from the wall camera with a framing guide for their shop type, adjusts the arm by hand, taps "Looks good". Reference frame is saved.
7. Recording hours (pre-filled from Google Places when possible). This screen is also the consent moment.
8. Done. Shows a preview of tomorrow's notification.

QR payload (JSON, then base64): `{ v: 1, ssid, password, pair_token }`. `pair_token` is single-use, expires in 10 minutes, and maps to the shop. Never put credentials in a URL.

### Delivery, v1
- No auto-posting in v1. Every morning at 8 AM local, owner gets an SMS and push: "3 clips from today. Tap to see."
- Owner opens Home, sees clips, taps Share (OS share sheet) or Skip. That is the whole loop.
- Auto-post via Instagram and TikTok APIs is P2. Leave room in Settings > Posting, mark "Coming soon".

### Privacy
- Face blur defaults on for anyone who is not staff. Staff faces can be allowed per person.
- Raw footage deleted after 48 hours. Clips kept until the owner deletes them. This copy is visible on the Recording settings screen without tapping deeper.
- Pause is two taps from anywhere: Camera tab, then Pause. Options: 1 hour, rest of today, until I resume. Each shows exactly when recording resumes.
- Delete forever removes the clip and its source segment. Confirmation says exactly that.
- Printable "This area is recorded for social content" sign as a PDF from Settings (P1).
- Nothing in the product should read as a security or surveillance camera. Amber, not red. It films work, not people.

### Copy rules
- No em dashes anywhere. Use commas, periods, or "to" for ranges.
- Sentence case. Short, plain, warm. Like a good employee texting the owner.
- CTA says what happens: "Text me a code", "Looks good", "Use these hours", "Delete clip and footage".
- Errors say what happened and what to do. No apologies, no vagueness.

---

## 4. Wall app states

The wall app is a state machine. One full-screen state at a time. Dark background, one glyph, one line at 44px, optional second line at 28px in #B8B3AA. Legible at 8 feet at minimum brightness.

| State | Trigger | Screen | Exit |
|---|---|---|---|
| `waiting` | First boot or factory reset | Short code (e.g. 4KP7) in amber, "Open cs.ai/start on your phone" | QR read |
| `reading` | QR detected | Amber disc, "Got it." | Parsed |
| `connecting` | Joining Wi-Fi and registering | Progress bar with network name. Never a bare spinner. | Success or fault |
| `framing` | Owner is on the framing step | Live preview with amber guide box, "Adjust from your phone" | Owner taps Looks good |
| `recording` | Normal operation in hours | Black screen, amber edge glow, one 14px amber dot at the bottom. This is all a customer sees. | Any fault, pause, or end of hours |
| `paused` | Owner paused | Pause glyph, "Paused until 3:00 PM" | Timer or resume |
| `nointernet` | Heartbeat fails 2 min | Dashed ring, "No internet. Buffering." | Reconnect |
| `nointernet_long` | Heartbeat fails 10 min | Dashed ring, "Still no internet. Re-scan QR from your phone" | Reconnect |
| `reframe` | Frame drift | Tilted frame glyph, "Camera moved. Check your phone" | Owner re-frames |
| `hot` | Thermal critical | "Cooling down. Back soon." No numbers. | Thermal recovers |
| `fault` | Anything else | "Text us: (415) 555-0142" plus error code | Manual |

Exact visuals for every state are in `design/ContentStationBoard.jsx` (`WallApp` component) and `design/project/Wall App.dc.html`.

---

## 5. Owner app screens

Bottom nav with three tabs: Clips, Camera, Settings. Portrait only. One-handed, primary action in thumb reach.

**P0 (build these):**
- Sign in (phone number), Code (6 digits)
- Onboarding: Shop, Wi-Fi, QR, Frame, Hours, Done
- Home: today's clips (9:16 cards, caption, Share and Skip), empty state (a still of what the camera saw plus when clips are expected, never blank)
- Clip detail: full-screen playback, editable caption, Share, Download, Skip, Delete, Report
- Camera: status card (green recording, yellow no internet, red needs attention, yellow paused with Resume now), then four rows: Pause recording, Check the shot, Re-scan QR, Replace camera
- Sheets: Pause (three options with resume times), Delete forever, Report (Wrong moment, Bad crop, Shouldn't have been filmed)
- Toasts for every action
- Re-scan QR (re-runs Wi-Fi and QR only), Replace camera (three steps, framing and hours carry over)

**P1:** Settings screens in full (Business profile, Posting, Recording, Team, Billing), weekly summary notification, printable sign.

**P2:** Connected accounts, auto-post schedule, approve queue, multi-location, motorized camera controls.

Every P0 screen is fully built and interactive in `design/ContentStationBoard.jsx` (`OwnerApp` component). Use it as the visual source of truth. Copy the inline style values exactly.

---

## 6. Design tokens

Extracted from the design files. Use these, do not invent new ones.

**Font:** Outfit (Google Fonts), weights 400, 500, 600, 700. System UI fallback. Monospace only for footage placeholder labels.

**Color**
| Token | Hex | Use |
|---|---|---|
| ink | #171614 | Text, primary buttons, active nav |
| body | #3F3C37 | Secondary body text |
| muted | #6F6B64 | Labels, captions, back buttons |
| tertiary | #B8B3AA | Chevrons, wall app line two |
| inactive | #A39E95 | Inactive nav tab |
| paper | #F7F6F3 | Owner app background, sheets |
| panel | #F1EFEA | Subtle panels, "Good to know" box |
| board | #ECEAE5 | Design board background only |
| white | #FFFFFF | Inputs, cards |
| amber | #E08A2E | Recording state, primary action on dark screens, brand accent. Never for errors. |
| dark | #0E0D0C | Clip detail and framing backgrounds |
| black | #000000 | Wall app background |
| light-on-dark | #F2EFE9 | Text on dark screens |
| green | #2F8F5B | Recording status |
| yellow | #D9A21B | No internet, paused |
| red | #C94B32 | Needs attention, delete |
| green-bg | #E6F0E9 | Recording status card |
| yellow-bg | #F6EEDB | No internet and paused status cards |
| red-bg | #F5E3DE | Needs attention status card |
| hairline | rgba(23,22,20,.08) | Dividers |
| border | rgba(23,22,20,.14) | Input and secondary button borders |

**Radii:** inputs and primary buttons 14, secondary buttons 12, cards 20, sheets 28, pills 22, wall app glyph corners 14.

**Sizes:** primary button 56 tall, secondary 48, pill 44, input 56. Owner app base text 17px, line height 1.35. Screen titles 28px/600. Wall app line one 44px/600, line two 28px/400.

**Motion:** only three animations exist: wall app ring pulse, wall app progress bar, QR status dot pulse. Respect prefers-reduced-motion. No entrance animations, no hover effects.

**Footage placeholders:** striped panels (`repeating-linear-gradient(135deg, #3a3835 0 14px, #2c2a27 14px 28px)`) with a monospace label. Replace with real thumbnails once the pipeline produces them.

---

## 7. Data model (Supabase, starting point)

```
shops            id, name, type (barbershop|detailing|wrap|tattoo|other), instagram, phone, timezone, hours jsonb, plan, created_at
users            id, phone, shop_id, role (owner|staff)
devices          id, shop_id, serial, status (waiting|reading|connecting|framing|recording|paused|nointernet|reframe|hot|fault|offline), paused_until, reference_frame_path, last_seen_at, wifi_strength, battery, thermal, storage_free_mb, app_version
pair_tokens      token, shop_id, ssid, password_enc, expires_at, used_at
heartbeats       id, device_id, at, battery, thermal, wifi, storage_free_mb, thumb_path        (keep 7 days)
segments         id, device_id, shop_id, path, start_ts, end_ts, bytes, status (uploaded|processing|done|deleted), delete_after
clips            id, shop_id, segment_id, path, thumb_path, duration_s, caption, created_at, delivered_at, status (new|shared|skipped|deleted|reported)
clip_events      id, clip_id, user_id, type (open|share|skip|delete|report), reason, at
notifications    id, shop_id, type, channel (sms|push), sent_at, opened_at
```

Storage buckets: `segments` (private, 48h lifecycle), `clips` (private, signed URLs), `thumbs` (private).

Row-level security: users see only their shop. Devices authenticate with a device JWT issued at pairing.

---

## 8. API surface (Edge Functions)

```
POST /auth/otp/send            { phone }
POST /auth/otp/verify          { phone, code }                     -> session
POST /shops                    { name, type, instagram }
POST /pair/token               { ssid, password }                  -> { pair_token, qr_payload }
POST /pair/claim               { pair_token, serial }              -> { device_jwt, shop, hours }   (called by wall app)
POST /device/heartbeat         { battery, thermal, wifi, storage, thumb } (device_jwt)
POST /device/segment/complete  { path, start_ts, end_ts, bytes }   (device_jwt) -> enqueues engine job
GET  /device/config            -> { hours, paused_until, reference_frame, status }  (device_jwt, polled every 60s or via Realtime)
POST /device/status            { status, code }                    (device_jwt)
POST /camera/pause             { until: '1h'|'today'|'indefinite' }
POST /camera/resume
POST /camera/reference-frame   (saves current preview as reference)
GET  /clips?date=              -> today's clips with signed URLs
POST /clips/:id/event          { type, reason }
DELETE /clips/:id              (deletes clip and source segment)
```

Live preview during framing: wall app streams 2 fps JPEG thumbnails to Storage or a Realtime channel while in `framing` state. Owner app shows the latest. Good enough for adjusting an arm by hand; do not build WebRTC in v1.

Engine handoff: `segment/complete` inserts a job. The engine (external) picks up jobs, writes clips to the `clips` bucket, inserts `clips` rows. A scheduled function at 8 AM shop-local sends the daily notification if there are new clips.

---

## 9. Files in this directory

```
HANDOFF.md                                  this file
docs/content-camera-design-requirements.md  the original design brief given to the designer
design/README.md                            Claude Design handoff notes
design/project/ContentStation Board.dc.html the design board (canvas)
design/project/Owner App.dc.html            owner app prototype, all screens and logic
design/project/Wall App.dc.html             wall app prototype, all states
design/project/ios-frame.jsx                iOS device frame used by the prototypes
design/project/support.js                   runtime for the .dc.html format (reference only)
design/ContentStationBoard.jsx              React implementation of the whole board, pixel-matched, interactive
design/contentstation-board.html            standalone build of the above, open in any browser
```

How to use them:
- `ContentStationBoard.jsx` is the fastest way to see everything. Open `contentstation-board.html` in a browser and click through. The `OwnerApp` and `WallApp` components in the JSX can be lifted directly into the owner app codebase; the Swift wall app should match `WallApp` state for state.
- The `.dc.html` files are the designer's originals. When the JSX and the .dc.html disagree, the .dc.html wins.
- Copy strings verbatim from the prototypes. They have been through review.

---

## 10. Build order

Work in this order. Each milestone has a done condition.

**M1: Wall app capture (Swift)**
Done when: a supervised iPhone in Single App Mode boots into the app, shows `waiting` with a code, reads a QR from 6 feet, joins Wi-Fi, claims a device JWT, records motion-gated 1080p in 5 minute segments, uploads them to Supabase Storage, sends heartbeats every 60 seconds, and shows the amber glow while recording. Survives a power cut without human help.

**M2: Backend**
Done when: all endpoints in section 8 exist with RLS, pair tokens expire, the 48 hour segment lifecycle runs, and a segment upload creates an engine job.

**M3: Owner app P0 (React)**
Done when: an owner can go from the text link through all seven onboarding steps on a real phone, see the live framing preview, and land on Home. Camera screen reflects real device status. Pause and resume work end to end and the wall phone reacts within 60 seconds.

**M4: Engine wiring and delivery**
Done when: segments flow into the existing engine, clips come back into the `clips` bucket, the 8 AM notification fires, and the owner can Share, Skip, Delete, and Report from Home and Clip detail.

**M5: First install**
Done when: one detailing, wrap, or barber shop is running for a week and the owner has posted at least a third of the delivered clips without being asked.

Do not start motorized mounts, auto-posting, or multi-location before M5.

---

## 11. Rules for the coding agent

1. Read the design files before writing UI. Do not invent screens, states, or copy that aren't in them.
2. Match the prototype's visuals exactly. Same colors, radii, sizes, spacing, strings.
3. No em dashes in any user-facing string, comment, or doc.
4. Keep product name, support phone number, and URLs in one constants file.
5. Never log Wi-Fi passwords, pair tokens, or device JWTs. Encrypt the Wi-Fi password at rest in `pair_tokens` and delete the row once claimed.
6. Every device-facing endpoint must tolerate retries and out-of-order arrival. Phones lose Wi-Fi mid-upload constantly.
7. Ask Abenezer before: changing the stack, adding a dependency over 1 MB to the owner app, adding any screen not in section 5, or touching the engine's contract.
8. When something in this file conflicts with the design files, the design files win for visuals and copy, this file wins for behavior and architecture. Flag the conflict either way.

---

## 12. Open questions for Abenezer

| Question | Blocking |
|---|---|
| Engine input format and how it wants to be triggered (queue, webhook, folder watch)? | M2 |
| Final name: ContentStation or Filmhand? | No, constants file |
| Which MDM (Mosyle, Hexnode, Miradore)? Determines the Single App Mode setup script. | M1 |
| Google Places API key for hours prefill, or skip prefill in v1? | No |
| Should staff be able to delete clips? Prototype assumes only owner. | No |
| Skip button on Home cards or only in Clip detail? Prototype has both. | No |
| Support phone number for the wall app fault screen and the box card. Prototype uses (415) 555-0142. | M1 |
