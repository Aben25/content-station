# Content Station

> The mounted iPhone captures. Hermes thinks. The owner decides. Postiz distributes.

Monorepo for the Content Station product. Full spec: [`docs/content-station-app-structure.md`](docs/content-station-app-structure.md).

## Structure

```
apps/
  station/    SwiftUI + AVFoundation mounted iPhone camera station
  backend/    TypeScript + Fastify API (uploads, processing, approvals)
  dashboard/  Next.js owner review dashboard (Phase 3 — placeholder)
docs/         Product spec
infra/        Deployment config (later)
```

## Phase 1 status — Camera proof ✅

**Station** (`apps/station`):
- Rear-camera live preview with 9:16 capture-zone guide
- 3-2-1 countdown → 15s recording with red indicator + timer + Stop
- Recording stops automatically if the app is interrupted or backgrounded
- Videos saved locally in Documents/Captures before any upload
- Upload queue: auto-upload to backend, retry on failure, local file
  deleted only after server confirms, pending uploads restored on relaunch

Build:

```bash
cd apps/station
python3 generate_project.py   # only if .xcodeproj is missing
xcodebuild -scheme ContentStation -destination 'generic/platform=iOS Simulator' build
```

Or open `ContentStation.xcodeproj` in Xcode and run on a device (camera
requires a physical iPhone; simulator builds but shows no preview).

**Backend** (`apps/backend`):

```bash
cd apps/backend
npm install
npm run dev        # http://localhost:3000
```

Endpoints:
- `GET /health` — liveness
- `POST /upload` — multipart video upload → stores under `uploads/<captureId>/raw.mp4`
- `GET /captures` — list stored captures (dashboard stub)

## Phase 2 status — AI draft ✅

Pipeline (auto-runs after each upload): probe → thumbnail → whisper
transcript → Hermes content plan → branded 9:16 render → `needs_review`.

New endpoints:
- `GET /drafts` / `GET /drafts/:id` — draft list + full record (plan, transcript, probe)
- `POST /drafts/:id/review` `{action: "approve"|"reject"}` — owner decision
- `GET /media/:id/raw|thumb|branded` — media streaming for the dashboard

Tools (installed locally, no Homebrew):
- `tools/bin/ffmpeg`, `tools/bin/ffprobe` (static arm64 builds)
- whisper.cpp `whisper-cli` (built from source) + `tools/models/ggml-base.en.bin`

Hermes plans use a deterministic fallback until you set:
`CONTENT_LLM_BASE_URL`, `CONTENT_LLM_API_KEY`, `CONTENT_LLM_MODEL`
(any OpenAI-compatible endpoint).

## Phase 3 status — Review & publishing ✅

**Dashboard** (`apps/dashboard`, Next.js on :3001):

```bash
cd apps/dashboard
npm install
npm run dev   # http://localhost:3001
```

- Home: today stats (captured / ready / posted) + draft cards with thumbnails
- Review screen: branded video preview, 3-hook picker, caption + CTA editing,
  platform toggles, warnings panel, Approve to Postiz / Reject

**Postiz** (`apps/backend/src/postiz.ts`): approve → upload branded MP4 →
create Postiz draft. Config-gated — set `POSTIZ_API_URL`, `POSTIZ_API_KEY`,
`POSTIZ_INTEGRATION_IDS` to go live. Until then, approvals record a stub
draft ID so the flow is fully testable.

## Phase 4 status — Pilot hardening ✅

- **Real Hermes LLM plans**: backend talks to `hermes proxy` (Nous Portal)
  by default — `hermes proxy start --provider nous` must be running.
  Hooks/captions now come from the transcript, not templates.
- **Prohibited claims**: set `PROHIBITED_CLAIMS="phrase1,phrase2"` — the LLM
  is instructed to avoid them and a post-check scrubs any that slip through.
- **Duplicate-publish prevention**: SHA-256 of the raw file blocks
  re-approving identical footage (409 with the original capture ID).
- **Privacy**: `DELETE /drafts/:id` removes everything; raw video is purged
  after `RAW_RETENTION_DAYS` (default 7, spec range 1–30).
- **Station health**: `GET /station/health` (online, last seen, uploads,
  retention) shown on the dashboard home.

## Remaining before the pilot

- Test the station app on a physical iPhone (open
  `apps/station/ContentStation.xcodeproj` in Xcode, sign with your Apple ID,
  run on device — it uploads to `http://10.0.0.230:3000`)
- Set `BUSINESS_NAME`, `BUSINESS_CATEGORY`, `DEFAULT_CTA` etc. for the real business
- Set `POSTIZ_API_URL`, `POSTIZ_API_KEY`, `POSTIZ_INTEGRATION_IDS` for live drafts
- Seven-day real-business pilot
