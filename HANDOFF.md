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
- `tools/whisper/` — whisper-cli + its dylibs (checked in; no longer in `/tmp`)
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
- **Token auth on every route except `/health`** (see Auth below)
- Verified end to end after the auth change: station-token upload → transcript → plan → `branded.mp4` → `needs_review`

### ✅ Completed in the auth/pipeline session
- Two-token auth: `STATION_TOKEN` (upload + ping only) and `OWNER_TOKEN` (everything). Backend refuses to start without both
- Dashboard proxies the backend through its own route handlers — the owner token never reaches the browser
- Station app takes its backend URL + token from a one-time setup sheet (UserDefaults), not a hardcoded URL. The dead quick-tunnel URL is gone
- Whisper model restored to `tools/models/`; `whisper-cli` + dylibs moved out of `/tmp` into `tools/whisper/`
- Fixed: unquoted `BRAND_COLOR=#FFFFFF` was read by dotenv as a comment, so **every branded render was failing** with an empty ffmpeg `fontcolor`

### ✅ Earlier
- **Sutway** App Store Connect listing created (id `6793229212`)
- IPA (0.1.0 build 1) uploaded to App Store Connect. That build predates the auth work — it points at the dead tunnel and has no setup sheet, so it needs a rebuild before it is useful

### 🔜 Not yet built
- Named Cloudflare tunnel (stable domain + launch service) — cert.pem was never written; `~/.cloudflared/` is empty
- launchd services not loaded — `infra/*.plist` exist but nothing survives a reboot yet
- Station pairing flow (6-char code → API URL + station token, replacing manual entry in the setup sheet)
- Dashboard auth (Supabase). The dashboard itself is unauthenticated, so **do not expose port 3001 publicly** — keep it on localhost/LAN
- Pipeline failures are invisible: a capture that errors shows nothing to staff and nothing to the owner
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
npm install                 # if needed
cp .env.example .env.local  # set BACKEND_URL + OWNER_TOKEN (same value as the backend's)
npx next dev -p 3001
# → http://localhost:3001
```

### Whisper
`whisper-cli` and its dylibs are checked in at `tools/whisper/`. Only the model
is missing from git (141 MB):

```bash
curl -L -o tools/models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

### iPhone — station app
On first launch the app shows **Station Setup**: enter the backend URL (https,
or localhost on the LAN) and the `STATION_TOKEN`. It is stored in UserDefaults
and reachable afterwards from the footer button. Captures still record and queue
on disk while unconfigured — they upload once a token is set.

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

### Auth (required — the backend will not start without these)
- `STATION_TOKEN=cs_stn_…` — goes in the iPhone app's setup sheet
- `OWNER_TOKEN=cs_own_…` — goes in `apps/dashboard/.env.local`, server-side only
- Generate: `node -e 'console.log("cs_stn_"+require("crypto").randomBytes(24).toString("hex"))'`
- Rotating means regenerating both and re-entering them in the app and the dashboard env

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
- `BRAND_COLOR="#FFFFFF"` — **quote it**; unquoted, dotenv reads `#` as a comment and renders break
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

## Auth

Every route except `GET /health` requires a token, sent as
`Authorization: Bearer <token>` (or `X-Station-Token`). Enforced by an
`onRequest` hook in `apps/backend/src/auth.ts`, so a newly added route is
owner-only by default.

| Token | May call | Used by |
|---|---|---|
| `STATION_TOKEN` | `POST /upload`, `POST /station/ping` | the mounted iPhone |
| `OWNER_TOKEN` | everything | the dashboard server |

The browser never sees `OWNER_TOKEN` — the dashboard calls the backend from
`lib/backend.ts` (server components) and proxies the two browser-initiated
calls through `app/api/media/[id]/[kind]` and `app/api/drafts/[id]/review`.

Expected responses: no token → 401, wrong token → 401, station token on an
owner route → 403.

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

Goal for the next stretch: one real business runs this for a week unattended.

**P0 — before any pilot**
1. ~~Restore whisper + auth~~ — done
2. **Named Cloudflare tunnel** on a real domain + DNS route. Expose the backend only, never the dashboard
3. **launchd services** — load `infra/*.plist` so backend, dashboard and tunnel survive a reboot
4. **Rebuild the TestFlight build** — the uploaded 0.1.0(1) predates auth and the setup sheet

**P1 — survivable unattended**
5. **Pairing flow** — staff enters a 6-char code, backend issues the station token and URL
6. **Failure visibility** — surface `status: "error"` captures to the owner; today they fail silently
7. **Confirm retention actually sweeps** — `housekeeping.ts` exists; verify `RAW_RETENTION_DAYS` is enforced

**P2 — second customer**
8. **Dashboard auth** — Supabase Auth
9. **Workspace model** — separate brand profiles + Postiz accounts per business; replaces the single `.env`
10. **Postgres** in place of the JSON-file store
11. **Postiz Instagram/Facebook** — add IDs to `.env`, extend `postiz.ts`

---

## Handoff checklist (for the person picking this up)

- [ ] Verify the repo builds locally: backend, dashboard, iPhone install
- [ ] Download `ggml-base.en.bin` from the HuggingFace Whisper repo and put it in `tools/models/`
- [ ] Generate `STATION_TOKEN` + `OWNER_TOKEN`, put them in `apps/backend/.env` and `apps/dashboard/.env.local`
- [ ] Complete a test capture end-to-end: upload → transcript → plan → render → dashboard draft
- [ ] Complete the Cloudflare tunnel setup (cert.pem + named tunnel + DNS + launchd)
- [ ] Enter the tunnel URL + station token in the app's setup sheet, then rebuild for TestFlight
- [ ] Test with one real local business before adding new features

This repo is public at https://github.com/Aben25/content-station. All active code is in `main`.
