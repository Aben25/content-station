# Owner app Firebase integration

## Result

The supplied owner prototype remains the visual source. Its Supabase client was replaced with Firebase phone authentication and bearer-authenticated requests to `VITE_API_BASE_URL` (the local integration API uses `http://127.0.0.1:4310`). Firebase restores persisted sessions, renews ID tokens through `getIdToken`, force-refreshes and retries once after an API 401, uses invisible reCAPTCHA for phone OTP, and optionally connects Auth to `VITE_FIREBASE_AUTH_EMULATOR_URL`.

Demo data now requires the exact setting `VITE_DEMO_MODE=true` and displays a persistent **DEMO DATA** label. Missing real configuration renders a setup page naming the missing settings instead of entering the mock.

Owner clips and camera status refresh every 30 seconds while visible. A failed video load fetches a new clip response so expired signed media URLs are replaced. Empty-state recording time appears only when the API supplies `recording_seconds_today`; the former fictional two-hour fallback is gone.

Sharing fetches the private video as a file for browsers that support file sharing, falls back to a native URL share, and records a share event only after the native share promise succeeds. Opening a browser fallback is not counted as a share. Downloads fetch the signed cross-origin response, create a same-origin blob URL, invoke the download from the owner's click, then release the blob URL. Delete errors remain on the clip screen and show the backend's message. The existing unpair-first replacement flow is preserved, so framing and hours stay server-owned while the old device is released before the new QR flow.

## Configuration

- `VITE_API_BASE_URL`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- Optional: `VITE_FIREBASE_AUTH_EMULATOR_URL`
- Demo only: `VITE_DEMO_MODE=true`

The local Auth emulator does not require a real SMS delivery or reCAPTCHA challenge. Hosted phone sign-in still requires its Firebase project's authorized domains, phone provider, and reCAPTCHA configuration.

## Verification

- `npm test`: 9 focused tests passed (configuration selection, renewed auth token/request behavior including the 401 retry, delete failures, successful versus fallback sharing, and blob downloads).
- `npm run build`: production bundle built successfully.
- `npm run typecheck`: TypeScript completed without errors.

No deployment, production data change, SMS, or external message was performed.
