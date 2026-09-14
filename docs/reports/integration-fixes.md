# Final Firebase and owner review fixes

All three findings in `review-firebase-owner.md` are addressed. This report supersedes the earlier owner report's single-tap sharing description.

Pair claim resolves the prior device transactionally from the current pairing or saved replacement context. It inherits the reference path and revision only from a device owned by the same shop, assigns a distinct new device ID (preserving queued-footage privacy), invalidates the prior same-shop device, and clears the consumed replacement context. New config signs the inherited reference for the new device. Real Storage emulator retrieval returns the original JPEG bytes through this new capability. A foreign-shop reference in replacement context is neither inherited nor revoked.

Owner Share preserves its initial label, dimensions and existing styling. The first tap refreshes clip metadata/capabilities, streams a private file while showing Preparing…, then shows Share now. The second tap calls native sharing synchronously before any await or network request. A shared hook retains only one prepared file per screen, limits response size to 128 MiB both from declared length and actual streamed bytes, drops the file on replacement/completion/unmount, surfaces preparation/share failures, and records only successful native shares. Cancellation and browser fallback do not record a share. No automatic external posting exists. Native URL sharing remains the fallback when file sharing is unsupported; browsers without native sharing open the refreshed URL from the final gesture.

Home immediately restarts polling for a selected date and Back. Selecting a date clears prior clips immediately and invalidates existing requests; sequence checks ignore superseded success and failure responses. The older-date heading and Back control remain usable while the response loads.

Also added the requested `FIRESTORE_DATABASE_ID` environment fallback, with an explicit options override taking precedence so isolated emulator tests remain isolated. Local default is unchanged. The backend README documents the optional hosted database selection.

## Verification on 2026-09-14

- TDD: the two new real-emulator framing tests first failed because reference revisions were null. After implementation, both retrieve the inherited JPEG through the new capability and pass. Additional foreign-shop replacement-context isolation regression passes.
- TDD: Home DOM regression first failed because the older-day tap had only requested `undefined` (Today). It now verifies immediate older-day and Back requests, old content removal, fresh Today rendering, and rejection of a late older-day response.
- TDD: synchronous native-share regression first failed with zero native calls because the old implementation was awaiting a never-resolving download. It now verifies native file sharing occurs before the call returns and no fetch occurs. Preparation tests cover refreshed capability use and oversized-response rejection. Hook DOM coverage verifies Preparing… → Share now, no native call after preparation alone, explicit second tap, cancellation, visible share rejection, and successful-share-only events.
- `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 npm --prefix firebase-api test`: **15/15 passed**. Main tests use named `backend-tests`; retention tests use their existing isolated emulator project.
- `npm --prefix owner-app test`: **14/14 passed across 5 files**.
- `npm --prefix owner-app run typecheck`: passed.
- `npm --prefix owner-app run build`: passed, 128 modules transformed.
- `npm --prefix firebase-api run build`: passed.

Physical mobile native-share behavior remains a hardware/browser verification item; automated DOM tests and dependency-level gesture ordering do not claim an actual handset share sheet. No hosted deployment, production mutation, SMS, paid model call or external post was performed.

## Settings truthfulness follow-up

The design prototype explicitly limits full settings to later scope. Retained the same five summary rows, spacing, typography, colors and view-only scope. Settings now shows the actual business profile and saved clip schedule, summarizes saved recording hours only when present, and says when recording hours are unset. Removed unsupported blur, push notification, team-size and billing-date claims. Team and billing summaries clearly state their controls/details are unavailable; the footer now says “These settings are view-only.” No settings implementation or new notification service was introduced.

The new rendered Settings regression failed first on the prototype's unsupported claims and then passed after these copy/data changes. It also verifies that absent recording hours do not turn into the formatting helper's fictional default schedule. Final owner checks: **15/15 tests passed across 6 files**, TypeScript passed, production build passed (128 modules). Backend code was unchanged in this follow-up.
