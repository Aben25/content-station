# Content Station — Developer Handoff

**Date:** 2026-07-21  
**Repo:** https://github.com/Aben25/content-station  
**Branch:** `main` (pushed, no remote secrets)  
**Author context:** The user is Abenezer (Bethesda, MD), communicates tersely, no Homebrew/Docker on this Mac.

---

## What this thing is

Content Station turns a mounted iPhone into a social-content camera. A staff member taps **Capture Moment** on the station app, the backend processes the video, generates branded content via Hermes AI, and creates a Postiz draft. The owner reviews from a Next.js dashboard and approves.

```
iPhone (SwiftUI/AVFoundation) → Backend (Fastify + whisper + Hermes) → Postiz → TikTok/IG/FB
                        ↘ Owner Dashboard (Next.js) /
```

Parts are all in this repo:
- `apps/station/` — mounted iPhone app (SwiftUI)
- `apps/backend/` — Fastify API + video pipeline + Postiz integration
- `apps/dashboard/` — Next.js owner dashboard
- `tools/bin/` — static ffmpeg, ffprobe, cloudflared
- `tools/models/` — **NOT checked in** (141 MB Whisper model; download fresh)
- `infra/` — macOS launchd plists for boot persistence

---

## Current working state (as of this handoff)

### ✅ Working end-to-end
- SwiftUI station app builds and installs on iPhone (`xcrun devicectl device install app`)
- Backend: upload endpoint → ffmpeg probe → whisper.cpp transcription → Hermes content plan → branded 9:16 render
- Real Postiz cloud API integration; `POST /drafts/:id/review` with `approve` creates a **live Postiz draft**
- Rally brand profile wired into `.env` (prohibited-claims guard active)
- Hermes proxy wired to Nous Portal (no API keys hardcoded elsewhere)

### ✅ Completed tonight
- **Sutway** App Store Connect listing created (id `6793229212`)
- IPA (0.1.0 build 1) uploaded to App Store Connect — build was **Processing** at time of save; check TestFlight → it may now be **Ready to Test**
- iPhone app updated to use a public HTTPS upload endpoint (tunnel URL in `apps/station/ContentStation/UploadQueue.swift`)

### 🔜 Not yet built
- Named Cloudflare tunnel (stable domain + launch service) — was in progress; cert.pem was not written before this session ended, and the custom domain was not configured
- Cloudflare Tunnel DNS route / launch service — not yet created
- Station pairing flow (6-char code → API URL + station token)
- Dashboard auth (Supabase)
- Per-workspace brand profile + Postiz keys (multi-tenancy)
- Instagram/Facebook integrations in Postiz (only TikTok is configured now)

---

## How to run this

### Prerequisites
- macOS with Xcode (`xcodebuild -version` passes; 15+ recommended)
- Node.js 22; the project uses `/Users/abeniforjesus/.hermes/node/bin/node`
- Python 3.11 + pip (for `PyJWT` and scripts)

### Terminal 1 — Hermes AI proxy
```bash
hermes proxy start --provider nous
# Confirm with: curl http://127.0.0.1:8645/v1/chat/completions ...
```

### Terminal 2 — Backend
```bash
cd ~/Projects/content-station/apps/backend
cp .env.example .env          # see Environment below
npx tsx watch src/index.ts
# → http://127.0.0.1:3000
# Health:  curl http://localhost:3000/health
```

### Terminal 3 — Dashboard
```bash
cd ~/Projects/content-station/apps/dashboard
npm install  # if needed
PORT=3001 npm run dev
# → http://localhost:3001
```

### iPhone — station app
```bash
cd ~/Projects/content-station/apps/station
python3 generate_project.py     # regenerates .xcodeproj
open ContentStation.xcodeproj
# Select ContentStation scheme + your iPhone → ⌘R
# Or install IPA: xcrun devicectl device install app --device <id> <ipa>
```

### LLM availability
The project reuses the locally-running Hermes proxy. If you want a non-Hermes fallback, set `CONTENT_LLM_API_KEY` in `.env` and point `CONTENT_LLM_API_BASE` to an OpenAI-compatible endpoint.

---

## Environment variables (`apps/backend/.env`)

### Core
- `PORT=3000`
- `CORS_ORIGIN=http://localhost:3001`
- `STORAGE_DIR=./storage`
- `UPLOAD_DIR=./storage/uploads`
- `RENDER_DIR=./storage/renders`
- `FFMPEG_PATH=./tools/bin/ffmpeg`
- `FFPROBE_PATH=./tools/bin/ffprobe`
- `WHISPER_BIN=/tmp/whisper.cpp/build/bin/whisper-cli`
- `WHISPER_MODEL=./tools/models/ggml-base.en.bin`
- `WHISPER_THREADS=4`

### LLM / content intelligence
- `CONTENT_LLM_API_BASE=http://127.0.0.1:8645/v1`
- `CONTENT_LLM_MODEL=auto`
- Optional fallback: `CONTENT_LLM_API_KEY` + direct provider base URL

### Postiz (public SaaS)
- `POSTIZ_API_KEY=<redacted>` — see Memory/secure notes; do NOT commit
- `POSTIZ_BASE_URL=https://api.postiz.com/public/v1`
- `POSTIZ_TIKTOK_INTEGRATION_ID=cmrtohebd082tqj0yo15u3q4f`

### Brand profile
- `BRAND_NAME=Rally`
- `BUSINESS_NAME=Rally`
- `TARGET_AUDIENCE=People building consistent workout habits`
- `BRAND_VOICE=Direct, motivating, evidence-based. Short sentences.`
- `DEFAULT_CTA=Download Rally — show up. prove it.`
- `LOCATION=Bethesda, MD`
- `TIMEZONE=America/New_York`
- `PROHIBITED_CLAIMS=guaranteed results, lose weight fast, medical claims, body-shaming`

**Never commit `.env`.**

---

## Key API routes

### `POST /upload`
Accepts a raw MP4. Returns `captureId` + status. Triggers the pipeline: probe → transcript → plan → render.

### `GET /drafts`
Returns drafts. Frontend uses it for the dashboard home + review queues.

### `POST /drafts/:id/review`
Body examples:
- `{"action":"approve","captions":{"tiktok":"..."},"platforms":["tiktok"]}` → uploads branded MP4, creates Postiz post/draft
- `{"action":"reject"}` → deletes draft and generated files

### `DELETE /drafts/:id`
Deletes the record and associated files from disk.

### `GET /station/health`
Last activity, pending uploads, version.

---

## Postiz integration detail

File: `apps/backend/src/postiz.ts`

Approval flow:
1. `POST /public/v1/upload` — multipart body with `image` files; returns `{ id }`
2. `POST /public/v1/posts` — body:
   - `image: [{ id, path }]`
   - `integrations: [{ id, ...platformSettings }]`
   - TikTok:
     - `id: POSTIZ_TIKTOK_INTEGRATION_ID`
     - `__type: "tiktok"`
     - `privacy_level: "PUBLIC_TO_EVERYONE"`
     - `autoAddMusic: "no"`     ← **string, not boolean**
     - `comment: true`
     - `duet: false`
     - `stitch: false`

Backend only holds Postiz credentials. The iPhone app must never.

---

## Cloudflare tunnel

### Current state
- A quick tunnel was started once; its URL has since died (ephemeral)
- A named/tunnel login was started but `cert.pem` did not land before the session ended
- The phone's upload URL is still set to a dead hostname in `UploadQueue.swift`

### What the next dev must do
1. Make sure `cloudflared` is logged in and `~/.cloudflared/cert.pem` exists
2. Create a tunnel: `cloudflared tunnel create content-station-api`
3. Write a tunnel config (`~/.cloudflared/config.yml`)
4. Route DNS via Cloudflare to a real domain (bring an API token scoped for `Cloudflare Tunnel:Edit` + `DNS:Edit`)
5. Start the tunnel and create a macOS launchd service (plist in `infra/` has a template)
6. Set a stable URL in `apps/station/ContentStation/UploadQueue.swift`

---

## iPhone app build notes

- Xcode project is **generated** (`generate_project.py`). Do not hand-edit `ContentStation.xcodeproj`.
- Current app icon is a minimal camera glyph (added during the handoff session). If you change the icon, update `Assets.xcassets/AppIcon.appiconset/Contents.json`.
- Bundle ID: `com.contentstation.station`
- Team ID: `HP284BJ924`

---

## What to build next (short version)

1. **Named Cloudflare tunnel** on a real domain + launch service — makes remote uploads stable
2. **Pairing flow** — staff enters a code, backend issues station token, app gets the upload URL
3. **Renew dead tunnel URL** in `UploadQueue.swift` once a permanent hostname exists
4. **Dashboard auth** — Supabase Auth (backend already has user tables; add protected routes)
5. **Workspace model** — separate brand profiles + Postiz accounts per business
6. **Postiz Instagram/Facebook** — add IDs to `.env`, extend `postiz.ts`

---

## Handoff checklist (for the person picking this up)

- [ ] Verify the repo builds locally: backend, dashboard, iPhone install
- [ ] Download `ggml-base.en.bin` from the HuggingFace Whisper repo and put it in `tools/models/`
- [ ] Complete a test capture end-to-end: upload → transcript → plan → render → dashboard draft
- [ ] Complete the Cloudflare tunnel setup (cert.pem + named tunnel + DNS + launchd)
- [ ] Update the upload URL in the station app and rebuild for TestFlight if needed
- [ ] Test with one real local business before adding new features

This repo is public at https://github.com/Aben25/content-station. All active code is in `main`.
