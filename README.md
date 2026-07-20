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

## Next up (Phase 3 — Review & publishing)

- Next.js owner dashboard: draft review cards, video preview, hook picker,
  caption editing, approve/reject
- Postiz media upload + draft creation on approve
