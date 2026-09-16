# Owner web UI

The current React/Vite app for phone sign-in, shop setup, camera pairing, clip review, caption editing, sharing and configured Postiz publishing. Routes and screens live in `src/router.ts` and `src/screens/`; Firebase access lives in `src/api/`. The running app source is the UI reference.

## Run with the local backend

From the repository root, follow [local setup](../README.md#run-locally):

```sh
npm run setup
npm run dev
```

The owner UI runs at `http://127.0.0.1:4311/`, the API at port 4310, and Firebase emulators provide local authentication, storage and data. Setup generates ignored `.env.local` with public browser configuration. Backend secrets belong in the API environment, never in Vite variables.

To configure an existing backend, use the fields in [.env.example](.env.example) and run `npm --prefix owner-app run dev`. Missing configuration shows a setup screen. See [hosted setup](../docs/HOSTED-SETUP.md) before building for deployment.

## UI preview without services

From the repository root:

```sh
npm --prefix owner-app ci
VITE_DEMO_MODE=true npm --prefix owner-app run dev -- --host 127.0.0.1 --port 4311
```

This explicit demo uses sample data and shows a **DEMO DATA** label. It is useful for UI work and does not prove real login, camera capture or publishing. Query options include `?mock=fresh` for onboarding and `?mock=offline`, `attention`, `paused` or `empty` for alternate states.

## Checks

```sh
npm --prefix owner-app test
npm --prefix owner-app run typecheck
npm --prefix owner-app run build
```

Tests live beside the source. The [Firebase contract](../docs/FIREBASE-CONTRACT.md) describes the active API; the [architecture map](../docs/ARCHITECTURE.md#owner-website-owner-appsrc) explains the files. For uploading a local video directly to the clipping engine, use [Clip Lab](../scripts/clip-lab/README.md).
