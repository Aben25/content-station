# ContentStation

A phone mounted on a shop wall films the work. A pipeline cuts the best moments into short vertical clips and texts them to the owner every morning. The owner mounts the phone once and never touches it again.

Working name. The product name, support number, and start URL live in `product.json`. Edit that one file and run `scripts/sync-product.sh` to rename everywhere.

## Pieces

| Piece | Path | Stack | Verify |
|---|---|---|---|
| Wall app | `wall-app/` | Swift, SwiftUI, AVFoundation, XcodeGen | `cd wall-app && xcodegen generate && xcodebuild -project ContentStationWall.xcodeproj -scheme ContentStationWall -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build` |
| Owner app | `owner-app/` | Vite, React, TypeScript, mobile web | `cd owner-app && npm install && npm run typecheck && npm run build` |
| Backend | `supabase/` | Supabase Postgres, Storage, phone OTP auth, one Edge Function, pg_cron | `cd supabase/functions/api && deno check index.ts && deno lint` |

## Read in this order

1. `docs/handoff/HANDOFF.md`, the coding agent handoff. Behavior and architecture decisions.
2. `docs/CONTRACT.md`, the seams between the three pieces. API, Config, QR payload, state machine, capture rules.
3. `docs/handoff/design/project/*.dc.html`, the design prototypes. Visuals and copy win over everything else.

## Status against the handoff build order

- M1 wall app capture: written, compiles for the simulator. Needs a supervised iPhone, an MDM profile, and a real Wi-Fi network to finish. See `wall-app/README.md`.
- M2 backend: written, type checked. Needs a Supabase project, secrets, and `db push`. See `supabase/README.md`.
- M3 owner app P0: written, builds. Runs against an in memory mock with no env vars, or the real backend with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- M4 engine wiring: the job queue, claim, done, and failed routes exist. The engine's real input format is still an open question.
- M5 first install: not started.

## Open questions carried from the handoff

See `docs/handoff/HANDOFF.md` section 12. Assumptions taken meanwhile are listed in `docs/CONTRACT.md` and the three READMEs.
