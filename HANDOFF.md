# Content Station — Developer Handoff

**Date:** 2026-07-21  
**Repo:** `~/Projects/content-station` (no remote configured yet — create GitHub repo and run `git remote add origin <url>; git push -u origin main`)  
**Branch:** `main`, linear history, 3 shipped commits plus runtime services.  
**Contact:** The user's identity, Postiz/ASC details, and brand profile are in `MEMORY.md` and `USER.md` in this repo.

---

## What this thing is

Content Station is a four-part system that turns a mounted iPhone into a social-content camera:

```
iPhone → Backend (Fastify) → postiz API → TikTok/IG/FB SaaS
                ↓
         Hermes AI → content plans + captions
```

A staff member taps **Capture Moment** on a mounted iPhone. The backend processes the video, extracts speech via whisper.cpp, generates content via Hermes AI, renders a branded 9:16 MP4, and creates a Postiz draft. The owner reviews from a Next.js dashboard and approves for scheduling.

This repo is the whole thing — station app, backend, dashboard, infra scripts.

---

## Architecture at a glance

| Component | Path | Technology |
|---|---|---|
| Mounted iPhone app | `apps/station/` | SwiftUI + AVFoundation, XcodeGen-generated project |
| Backend API | `apps/backend/` | TypeScript + Fastify |
| Dashboard | `apps/dashboard/` | Next.js 14 (app router) |
| Binary tools | `tools/bin/` | ffmpeg 7.0, ffprobe 7.0, cloudflared |
| AI model | `tools/models/` | ggml-base.en.bin (Whisper base, 141 MB) |
| Whisper binary | `/tmp/whisper.cpp/build/bin/whisper-cli` | compiled whisper.cpp |

**No Homebrew, no Docker** on the host. Everything is either in the repo or statically compiled.

---

## Current working state (as of handoff)

### ✅ Working end-to-end
- SwiftUI station app builds, installs on iPhone via USB (`xcrun devicectl device install app`)
- Rear camera, countdown, 15s recording, local save, upload queue
- Backend receives uploads, runs ffmpeg probe, whisper.cpp transcription
- Hermes AI generates Rally-voiced content plans (prohibited-claims guard active)
- Renders branded 9:16 MP4 (logo + hook + subtitles + end-card CTA)
- Next.js dashboard home + draft review (hook picker, caption edit, platform toggles, approve/reject)
- Real Postiz cloud integration — `POST /drafts/:id/review` with `action: "approve"` creates a **live draft** via Postiz Public API
- Rally brand profile wired into `.env` (see below)
- LLM proxy wired (Hermes → Nous Portal, no API keys in repo)

### ⏳ In progress
- TestFlight build **0.1.0 (1)** uploaded to app record **"Sutway"** (App Store Connect id `6793229212`), status: **Processing** — expected ready ~20-40 min after upload timestamp
- The phone app still points at the **temporary** Cloudflare tunnel URL; the tunnel process is dead, so remote uploads currently would fail until a stable URL is configured
- Cloudflare named tunnel not yet created (login attempted but cert.pem was not written before the process died)

### 🔜 Not yet built
- Station feature: pairing flow (6-char code → backend URL + station token), workspace model for multi-tenancy
- Dashboard auth (Supabase)
- Retention sweeper configurable retention window in UI (backend cron already exists)
- Additional Postiz integrations (Instagram, Facebook — TikTok `cmrtohebd082tqj0yo15u3q4f` is connected)

---

## How to run this locally

### Prerequisites
- macOS with Xcode 15+ (`xcodebuild -version` passes)
- Node.js 22 (Nobrew binary at `/Users/benforjesubenforjesuss/.hermes/node/bin/node`)
- Python 3.11 for whisper scripts

### 1. Backend
```bash
cd ~/Projects/content-station/apps/backend
cp .env.example .env   # see "Environment variables" below
npx tsx watch src/index.ts
# → http://127.0.0.1:3000
```

Health check:
```bash
curl http://localhost:3000/health
# {"status":"ok","service":"content-station-backend",...}
```

### 2. Dashboard
```bash
cd ~/Projects/content-station/apps/dashboard
npm install         # if node_modules missing
PORT=3001 npm run dev
# → http://localhost:3001
```

### 3. LLM proxy (Hermes → Nous Portal)
```bash
hermes proxy start --provider nous
# → http://127.0.0.1:8645/v1
```
This requires a Hermes/Nous subscription token in `~/.hermes/config.yaml`. Confirm with:
```bash
curl http://localhost:8645/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"auto","messages":[{"role":"user","content":"PROXY_OK"}]}'
```

### 4. Station app (iPhone)
```bash
cd ~/Projects/content-station/apps/station
python3 generate_project.py   # regenerates .xcodeproj if needed
open ContentStation.xcodeproj
# Select ContentStation scheme, your iPhone, ⌘R
```
Or install directly:
```bash
xcrun devicectl device install app \
  --device 86847A3A-E2FD-55E2-BA59-46A6647AF8E2 \
  /tmp/ContentStation-export/ContentStation.ipa
```

### 5. Launchd persistence (optional)
Plist files are in `~/Projects/content-station/infra/`:
- `com.contentstation.backend.plist`
- `com.contentstation.dashboard.plist`
- `com.contentstation.llmproxy.plist`

Install to launch agents:
```bash
cp infra/com.contentstation.*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.contentstation.backend.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.contentstation.dashboard.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.contentstation.llmproxy.plist
```
Restart after code changes:
```bash
launchctl kickstart -k gui/$(id -u)/com.contentstation.<name>
```

---

## Environment variables (`apps/backend/.env`)

```env
# Server
PORT=3000
CORS_ORIGIN=http://localhost:3001

# Storage
STORAGE_DIR=./storage        # raw uploads + branded renders
UPLOAD_DIR=./storage/uploads
RENDER_DIR=./storage/renders

# Whisper (local)
WHISPER_MODEL=./tools/models/ggml-base.en.bin
WHISPER_BIN=/tmp/whisper.cpp/build/bin/whisper-cli
WHISPER_THREADS=4

# FFmpeg (static binaries in repo)
FFMPEG_PATH=./tools/bin/ffmpeg
FFPROBE_PATH=./tools/bin/ffprobe

# Hermes AI proxy
CONTENT_LLM_API_BASE=http://127.0.0.1:8645/v1
CONTENT_LLM_MODEL=auto

# Postiz (live SaaS account)
POSTIZ_API_KEY=<redacted — see MEMORY.md>
POSTIZ_BASE_URL=https://api.postiz.com/public/v1
POSTIZ_TIKTOK_INTEGRATION_ID=cmrtohebd082tqj0yo15u3q4f

# Brand profile (Rally)
BRAND_NAME=Rally
BRAND_CATEGORY=Fitness
BUSINESS_NAME=Rally
TARGET_AUDIENCE=People building consistent workout habits
BRAND_VOICE=Direct, motivating, evidence-based. Short sentences.
DEFAULT_CTA=Download Rally — show up. prove it.
LOCATION=Bethesda, MD
TIMEZONE=America/New_York
PROHIBITED_CLAIMS=guaranteed results, lose weight fast, medical claims, body-shaming
```

**Do NOT** commit any new secrets. Use `.env` and add it to `.gitignore`.

---

## Key API routes (`apps/backend/src/index.ts`)

| Route | Method | Purpose |
|---|---|---|
| `/health` | GET | Liveness + queue stats |
| `/upload` | POST | Upload MP4, returns capture record |
| `/captures` | GET | List captures (optionally by workspace) |
| `/drafts` | GET | List draft statuses |
| `/drafts/:id/review` | POST | Approve/reject/regenerate (triggers Postiz upload on approve) |
| `/drafts/:id` | DELETE | Delete + cleanup files |
| `/station/health` | GET | Station connection + last activity |
| `/pair` | POST | Future — issue station token for a pairing code |

---

## Postiz publishing detail

File: `apps/backend/src/postiz.ts`

Approve flow (`action: "approve"`):
1. Uploads branded MP4 via `POST https://api.postiz.com/public/v1/upload`
2. Creates post via `POST https://api.postiz.com/public/v1/posts`
3. TikTok settings: `privacy_level: PUBLIC_TO_EVERYONE`, `autoAddMusic: "no"` (string, not boolean)
4. Other integrations (IG/FB): pass `image: [{ id, path }]` same way

Only the backend holds the Postiz API key — **never store it in the iPhone app**.

---

## Known pitfalls

1. **Cloudflare tunnel URLs are ephemeral.** `trycloudflare.com` URLs die when the cloudflared process exits. The production path is a named tunnel on a real domain (requires a Cloudflare domain + API Token).
2. **No remote = no uploads.** If the tunnel/cert/domain isn't set up, the phone app's upload URL is a dead hostname. Always verify `curl https://<tunnel-url>/health` from your iPhone before testing remote uploads.
3. **Whisper binary path.** The binary lives at `/tmp/whisper.cpp/build/bin/whisper-cli` after local compilation. Acceptable alternatives: put it in `tools/bin/whisper-cli` and update `.env`.
4. **TestFlight build.** The current build is signed for distribution only — not Ad Hoc. TestFlight delivery is the supported path. App Store Connect record id: `6793229212`. Re-upload key is in `~/.appstoreconnect/private_keys/AuthKey_6SKGBY9A8S.p8`.
5. **Backend API shape.** Postiz's `/upload` endpoint returns `{ id }`, not the nested object — the current code uses this correctly. The `/posts` endpoint takes `{ caption, integrations[], image: [{id, path}], ... }` — already wired for TikTok; IG/FB paths are similar but untested.
6. **iPad/multitasking.** The station app is iPhone-only in this build. The current architecture is designed for a fixed-angle mounted iPhone, not iPad.

---

## File layout

```
apps/
  backend/
    src/
      index.ts        — Fastify server + routes
      config.ts       — env loader
      store.ts        — CaptureRecord store (SQLite? no — see code, currently in-memory / filesystem)
      pipeline.ts     — probe → transcript → plan → render queue
      hermes.ts       — Hermes AI content plan generation
      postiz.ts       — Postiz upload + draft creation
      housekeeping.ts — retention sweeper + pending upload requeue
    .env
  dashboard/
    app/
      page.tsx              — station health card
      review/[id]/ReviewClient.tsx — draft review UI
  station/
    ContentStation/
      ContentStationApp.swift
      CaptureScreen.swift
      UploadQueue.swift
      PreviewScreen.swift
      Assets.xcassets/
    generate_project.py     — XcodeGen-style .xcodeproj generator
    ContentStation.xcodeproj/
infra/
  com.contentstation.backend.plist
  com.contentstation.dashboard.plist
  com.contentstation.llmproxy.plist
tools/
  bin/ffmpeg, ffprobe, cloudflared
  models/ggml-base.en.bin
logs/
storage/          (gitignored — create with mkdir -p storage/uploads storage/renders)
```

---

## What to build next

### Short term (next ~3 commits)
1. **Named Cloudflare tunnel.** You need a domain on Cloudflare + an API Token (`Cloudflare Tunnel: Edit` + `DNS: Edit` scopes). With those, I can create a persistent `station-api.<yourdomain>` and wire it as a launch service — no more ephemeral URLs.
2. **Pairing flow.** The spec already requires it: staff opens the app → enters a 6-char code → gets the API URL + station token. Backend endpoint: `POST /pair`, frontend: a simple text-entry screen. Token stored in SwiftData/SQLite.
3. **Renew expired quick tunnel URL** in `UploadQueue.swift` as soon as a stable URL exists.

### Medium term
4. Dashboard authentication (Supabase Auth)
5. Per-workspace brand profile + Postiz keys (multi-tenancy)
6. Instagram/Facebook Postiz integrations (add IDs to `.env`, extend `postiz.ts`)
7. Retention policy UI in dashboard (backend cron already exists)

---

## Running the full loop from zero

```bash
# Terminal 1: Hermes proxy
hermes proxy start --provider nous

# Terminal 2: Backend
cd ~/Projects/content-station/apps/backend
npx tsx watch src/index.ts

# Terminal 3: Dashboard
cd ~/Projects/content-station/apps/dashboard
PORT=3001 npm run dev

# iPhone: tap Capture → watch upload → approve on dashboard → Postiz draft created
```

Confirm with:
```bash
curl -s http://localhost:3000/health
```

---

## Notes for the next dev

- The user communicates tersely — "yes", "continue", "ok" — and expects me to choose defaults and move fast without check-ins.
- No Homebrew, no Docker, no npx-installed CLIs. Everything is either Node-in-repo, `/tmp`, or static binaries under `tools/bin/`.
- Xcode project is **generated**, not hand-edited. Always edit `generate_project.py` and re-run it. Don't touch `ContentStation.xcodeproj` by hand.
- Brand profile + secrets are in `.env` (which is gitignored). Brand context is also in `USER.md` / `MEMORY.md`.
- Posts must never auto-publish without owner approval — the Postiz flow only creates drafts.
- iPhone capture should not hold Postiz credentials — only the backend does.
- TestFlight distribution requires re-upload; the most recent key is `AuthKey_6SKGBY9A8S.p8`. If it expires, generate a new one in App Store Connect → Users and Access → Keys and update `exportUpload.plist`.
- The GitHub repo needs to be created manually and this `main` branch pushed. The user doesn't have a remote configured yet.
