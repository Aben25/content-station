# Content Camera: App Design Requirements (v1)

Working name: **ShopCam** (placeholder, rename freely)
Owner: Abenezer
Status: Draft for design kickoff, September 2026

---

## 1. What we are building

A phone mounted permanently on a shop wall films the work happening in the shop. An AI pipeline picks the best moments, cuts them into short vertical clips, and delivers them to the owner ready to post. The owner does nothing except mount the phone once and post what they like.

**The promise in one line:** you keep working, your Instagram fills itself.

**First customers:** car detailing and wrap shops, tattoo studios, barbershops. One fixed workstation, visually satisfying work, owners who already know they should post daily and don't.

**What matters most in the design:**
1. Setup takes under five minutes and never requires typing on the wall phone.
2. The owner can get value with one tap a day (or zero, once auto-post is on).
3. Every state of the system is understandable from the owner's own phone, without looking at the wall.

---

## 2. Surfaces to design

There are two apps. Design both.

| Surface | Device | Who sees it | Purpose |
|---|---|---|---|
| **Wall app** | iPhone 12 or newer, locked to this app, mounted 7 to 9 ft up | Owner during setup, occasionally after | Capture footage, show status, display setup preview |
| **Owner app** | Owner's own phone (mobile web first, native later) | Owner and staff | Onboarding, review clips, post, manage the camera |

A third internal ops dashboard (fleet health for us) is out of scope for design in v1. Engineering will build a plain table.

---

## 3. Users

**Shop owner.** Runs a 1 to 5 person shop. Hands busy all day. Checks their phone in short bursts between jobs. Not technical. Already posts to Instagram and TikTok, inconsistently. Cares about looking good and getting customers, not about features.

**Staff member.** May be the one who scans the QR or re-frames the camera. Should be able to do anything the owner can except billing and disconnecting accounts.

**Customer in the shop.** Never uses the app but is on camera. The design must make it easy for the shop to be transparent about recording (see section 8).

---

## 4. Design principles

1. **Zero effort is the product.** Every screen should be judged by "does this add a step?" If it does, it needs a strong reason.
2. **Glanceable.** The owner looks at this for ten seconds between jobs. Big thumbnails, one primary action per screen, no dense settings.
3. **Calm.** No badges, no streak pressure, no guilt. The camera works quietly; the app should feel the same.
4. **Trust.** The shop is putting a camera in their workspace. Recording state, pausing, and deletion must be obvious and fast.
5. **Show, don't explain.** Use the actual footage and clips as the UI wherever possible instead of illustrations or copy.

Tone of voice: short, plain, warm. Never corporate, never cutesy. Write like a good employee texting the owner.

---

## 5. Wall app

### 5.1 Physical constraints the design must respect

- Mounted high in a corner, rear camera facing the work area. **The screen usually faces the wall or ceiling and may not be visible from the floor.** Status must never depend on the wall screen alone; it must also live in the owner app and in notifications.
- Screen runs at minimum brightness all day. Assume the owner sees it dim, at an angle, from 8 feet away, if at all.
- No touch interaction after install. Nobody will reach it.
- The rear camera must be able to read a QR code held up from the floor at roughly 6 to 8 feet.

### 5.2 States to design

Each state is a full-screen, single-purpose display. One large glyph, one line of text, optional second line. Legible at 8 feet at low brightness. High contrast, dark background (a bright screen creates glare on shiny cars and mirrors).

| State | Trigger | What it shows | Exit |
|---|---|---|---|
| **Waiting for setup** | First boot or factory reset | "Open [link] on your phone" plus a short code | QR detected |
| **Reading QR** | QR in view | Confirmation animation | Credentials parsed |
| **Connecting** | Joining Wi-Fi and registering | Progress, no spinner-only screens | Success or failure |
| **Framing** | Owner is in the framing step in the owner app | Live camera preview with framing guide overlay (see 6.2) | Owner taps Done |
| **Recording** | Normal operation | Small steady indicator, mostly dark screen | Any fault |
| **Paused** | Owner paused from app | Clear "Paused until [time]" | Timer or resume |
| **No internet** | Heartbeat fails for 2 minutes | "No internet. Buffering." then after 10 minutes "Re-scan QR from your phone" | Connection returns |
| **Re-frame needed** | Frame drift detected | "Camera moved. Check your phone." | Owner re-frames |
| **Too hot** | Thermal state critical | "Cooling down. Back soon." | Thermal recovers |
| **Fault** | Anything else | "Text us: [number]" plus error code | Manual |

Also design a **recording indicator** that is visible from the floor even when the screen is not: a small colored light or glow at the screen edge. This may be all a customer ever sees.

### 5.3 Non-goals for the wall app

- No settings, no menus, no touch targets.
- No clip playback on the wall.
- No account or login UI.

---

## 6. Owner app

Mobile web first, so it works from a text message link with no install. Must feel native: full-screen, bottom actions in thumb reach, fast.

### 6.1 Information architecture

```
Sign in (phone number + code)
  Onboarding (first run only)
  Home: Today's clips
    Clip detail
  Camera
    Status
    Framing
    Pause
    Re-scan QR
    Replace camera
  Settings
    Business profile
    Posting (v1: delivery preferences; later: connected accounts, schedule)
    Recording (hours, pause rules, face blur, retention)
    Team
    Billing
```

Keep the bottom nav to three items: Clips, Camera, Settings.

### 6.2 Onboarding flow

Goal: box open to first frame captured in under five minutes, with the phone never taken off the wall once mounted.

**Step 0: Unbox.** Physical card in the box: "Mount it. Plug it in. Text START to [number]." The text reply contains the link that begins the flow. Design the card too.

**Step 1: Sign in.** Phone number, six-digit code. No email, no password.

**Step 2: Your shop.** Shop name, type (pick from list), Instagram handle (optional). Three fields max.

**Step 3: Wi-Fi.** Network name and password. Pre-fill the network name if the owner's phone is on Wi-Fi and the browser allows it. Show the password field with a reveal toggle.

**Step 4: Show the camera your phone.** Full-screen QR code with the instruction "Hold this up to the camera." Include a small illustration of a person holding a phone up toward a corner-mounted camera. Below the QR: live status pulled from the backend ("Waiting", "Reading", "Connected"). The owner never taps anything here; the screen advances when the camera registers.

**Step 5: Frame the shot.** Live preview from the wall camera on the owner's phone. Overlay a simple framing guide for the shop type (for a detailing bay: "Keep the whole car inside this box"). The owner adjusts the arm by hand while watching. One button: "Looks good."

**Step 6: Recording hours.** "When should the camera record?" Default to shop hours from Google if we can find them, otherwise a simple day and time picker. This step doubles as the consent moment: state plainly that the camera records during these hours and how to pause it.

**Step 7: Done.** "First clips arrive tomorrow morning." Show a preview of what a clip notification will look like.

Design each step to be recoverable: back is always available, and re-running any single step from Camera > Status must not require redoing the others.

### 6.3 Home: Today's clips

This is the screen the owner opens from a notification. It must load fast and put the clips first.

- Header: date and a one-line status of the camera (green dot "Recording", or the fault text).
- Clips as a vertical list of large 9:16 thumbnails, autoplay muted on scroll, newest first.
- Each clip card: thumbnail, duration, one-line auto caption, and two actions: **Share** and **Skip**. Share opens the OS share sheet (Instagram, TikTok, save). Skip hides it and teaches the model.
- Empty state (no clips yet): what the camera saw today as a single still, and when clips are expected. Never a blank screen.
- Older days accessible by scrolling or a date picker. Keep it simple; this is not a media library.

### 6.4 Clip detail

- Full-screen playback, sound on.
- Actions: Share, Download, Skip, Delete forever, Report a problem (wrong moment, bad crop, shouldn't have been filmed).
- Show the auto caption as editable text before sharing. Editing should be optional and fast.
- Nothing else. No timeline editor, no trimming in v1.

### 6.5 Camera

- **Status card:** big and obvious. Green "Recording since 8:02 AM", yellow "No internet since 2:14 PM", red "Needs attention". Below it: last frame captured (small still), Wi-Fi strength, temperature (as a plain word, not a number), and "Last seen [time]".
- **Pause:** one tap, choose 1 hour, rest of day, or until I resume. Confirmation shows exactly when recording resumes. This must be reachable in two taps from anywhere in the app because a customer may ask for it on the spot.
- **Framing:** re-run step 5 of onboarding.
- **Re-scan QR:** re-run step 3 and 4. Explain in one line when to use it ("If you changed your Wi-Fi password").
- **Replace camera:** step-by-step for swapping in a spare (unclip, clip, scan). Rarely used, keep it simple.

### 6.6 Settings

Keep every settings screen to one scroll with no nesting deeper than two levels.

- **Business profile:** name, type, logo, brand color, handles. Used to style clips.
- **Posting:** v1 is delivery only: notification time (default 8 AM), channel (SMS, push). Design space for connected accounts and auto-post schedule, marked "Coming soon" but not built.
- **Recording:** hours per day, pause rules, face blur on or off (default on for anyone who is not staff), retention ("Raw footage is deleted after 48 hours. Clips are kept until you delete them."). Retention copy must be visible without tapping into a sub-screen.
- **Team:** add a staff phone number so they can pause and re-frame. No roles beyond owner and staff.
- **Billing:** plan, next charge, cancel. No dark patterns on cancel.

### 6.7 Notifications

Design the actual notification text and preview. These are most of the product for the owner.

| Event | Channel | Copy direction |
|---|---|---|
| Daily clips ready | SMS and push | "3 clips from today. Tap to see." with a thumbnail if the channel supports it |
| Camera offline 10 min | Push | "Camera lost internet. Buffering footage. If your Wi-Fi changed, re-scan." |
| Camera offline 2 hours | SMS | Same plus our number |
| Camera moved | Push | "Camera may have moved. Check the shot." with a before and after still |
| Paused reminder | Push | "Camera paused. Resumes at 3:00 PM." |
| Weekly summary (P1) | Push | Clips delivered, clips shared, one best-performing clip |

---

## 7. Priorities

**P0 (design before engineering starts)**
- Wall app: all states in 5.2, recording indicator
- Owner app: sign in, onboarding steps 1 to 7, Home, Clip detail, Camera status, Pause, Re-scan QR, Framing
- Notifications: daily clips, offline, moved
- The card in the box

**P1**
- Settings screens in full
- Team
- Weekly summary
- Skip feedback reasons

**P2 (leave room in the layout, do not design yet)**
- Connected accounts and auto-post schedule
- Approve queue for auto-post ("post these unless I say no by 6 PM")
- Multi-location switcher
- Motorized camera controls (pan, tilt, follow)

---

## 8. Privacy and consent requirements

These are not optional and should be visible in the design, not buried.

- Recording hours are set by the owner and shown plainly in Settings and on the Camera screen.
- Pause is two taps from anywhere.
- Face blur defaults on for non-staff. Staff faces can be allowed per person.
- Retention statement is visible on the Recording settings screen without tapping deeper.
- Delete forever on any clip removes the clip and its source segment. Confirmation shows what is being deleted.
- We provide a printable "This area is recorded for social content" sign as a PDF from Settings. Design the sign.
- Nothing in the app should suggest the camera is a security or surveillance product. It films work, not people.

---

## 9. Constraints for the designer

- **No em dashes** anywhere in copy. Use commas, periods, or "to" for ranges.
- Owner app must work as mobile web in Safari and Chrome. Native later; do not rely on native-only patterns.
- Wall app screens must be legible at 8 feet at minimum brightness. Test on an actual iPhone dimmed to minimum.
- Assume one-handed use for the owner app, thumb reach for primary actions.
- Portrait only on both apps.
- Support the largest iOS text size without breaking layouts on the owner app.
- Dark mode is the default for the wall app. Owner app: light default, dark supported.

---

## 10. Deliverables

1. User flows for onboarding, daily clip review, pause, and re-scan (one diagram each).
2. High-fidelity screens for everything in P0, iPhone 15 frame for the owner app, iPhone 12 frame for the wall app.
3. All wall app states as a single board so engineering can see them side by side.
4. Notification mockups as they would appear on a locked iPhone.
5. The unboxing card and the printable recording sign.
6. A small component set: buttons, clip card, status card, input, toast. Nothing more.
7. Copy for every screen and notification in a shared doc (design owns copy in v1).

Working file in Figma. Share with edit access to Abenezer.

---

## 11. Open questions

| Question | Who answers | Blocking? |
|---|---|---|
| Product name and logo | Abenezer | No, use placeholder |
| Can the owner's browser pre-fill the Wi-Fi network name? | Engineering | No |
| Does the wall phone show any status the customer can see, or only the edge light? | Design proposes, Abenezer decides | Yes for wall app board |
| Should staff be able to delete clips? | Abenezer | No |
| Do we show clip performance (views, likes) in v1 if the owner shares manually? | Abenezer | No, assume not |

---

## 12. What success looks like

An owner who has never seen the product mounts the phone, completes setup in under five minutes without help, and the next morning taps a notification, watches three clips, and shares at least one, all in under a minute. If any of those steps takes longer or needs a call to us, the design is not done.
