# Self-hosted Postiz: local verification, September 14, 2026 (Pacific)

Scope: the pinned Postiz stack in `postiz/`, the ContentStation API publishing routes, and the owner website publishing screens, all verified locally. No social platform was contacted, no Meta developer app exists yet, and no hosted Postiz has been provisioned. Provider behaviour is covered by a mock in the API tests and by labelled fake channel rows in the real-instance check; neither is evidence that Facebook or Instagram accepted a post.

## Environment

- Mac (Apple silicon), Docker provided by `colima` 0.10.3 with Docker Engine 29.5.2 in a 4 CPU / 8 GiB VM, Docker CLI 29.8.0, Compose 5.5.1, all installed with Homebrew during this session.
- Postiz image `ghcr.io/gitroomhq/postiz-app:v2.23.0`, digest `sha256:785f97312f66a347fb96cdccc4ded5a33ced69a672c89a9adc8054e7d6a21dc5` (5.6 GB, arm64 variant pulled). Source pinned at commit `1e4c8dd5c4f70c4d0abd01e23cc42d5b533d1ab9`; route behaviour in `postiz/README.md` was read from that source, not only from the public docs.
- Companions as in `postiz/docker-compose.yml`. The first attempt without Elasticsearch failed: the Postiz backend exited at startup with `Unable to create search attributes: cannot have more than 3 search attribute of type Text` from Temporal's SQL visibility store. Adding upstream's Elasticsearch visibility service fixed it; the stack was recreated from empty volumes.
- Firebase emulators for the API tests ran on alternate ports (`.runtime/firebase.emulators.json`: auth 19099, Firestore 18080, Storage 19199) because another project's emulators already occupied the defaults on this Mac. OpenJDK 21 was installed with Homebrew at the path `scripts/local.mjs` already expects.

## Real pinned instance: organization isolation

`node scripts/postiz-local.mjs verify` at 2026-09-15 03:26 UTC against `http://127.0.0.1:4007/api`, 17 of 17 checks passed:

| Check | Result |
| --- | --- |
| Unknown API key | 401 `Invalid API key` |
| Organizations A and B created through `POST /enterprise/create-user` with a JWT signed by the instance secret | 201 with `{ id, apiKey }` each |
| Same synthetic email again | `{ create: false }`, no second organization |
| Wrong JWT signature | `{ success: false }` |
| PNG upload per organization | 201, distinct media records (`id, name, originalName, path, thumbnail, alt`; no organization field in the response) |
| Real MP4 generated with FFmpeg (1080×1920, 2 s) uploaded by A | 201, stored as `/uploads/2026/09/15/….mp4` |
| Fake channel rows inserted directly into the local database, one per organization | each key lists only its own channel |
| A reads B's channel settings | 404 |
| A stores a draft on its own channel | 201 `[{ postId, integration }]`; drafts start no workflow |
| B posts to A's channel | 400 `Integration with id … not found` |
| B lists posts | does not include A's draft |
| B deletes A's draft; B deletes A's channel | 500 from Postiz in both cases, A's data unchanged |
| `docker compose restart postiz` | A's key and draft still present |

The report with organization IDs (no keys) is written to `.runtime/postiz-verify.json`, which is ignored by Git. Fixture rows are removed at the end of the run. Postiz answers cross-organization deletes with HTTP 500 rather than 403/404 because its repository update simply finds no row; the data is still protected.

## ContentStation API

`firebase-api/test/publishing.test.ts` runs against the emulators and `firebase-api/test/fake-postiz.ts`, an in-process mock of the routes above with controllable failure modes. All 8 tests pass, and the existing 16 API tests still pass (24 total, `npm --prefix firebase-api test`). Covered:

- Publishing hidden and actions refused when `POSTIZ_URL` is unset.
- One organization per shop; a second connect reuses it; the stored key is encrypted (`api_key_enc`) and never appears in responses; the completion webhook is rejected with another signature and accepted with the instance signature.
- Two-shop denial: foreign clip ID, foreign account ID, foreign publication read/cancel, foreign account removal.
- Duplicate taps: the same idempotency key returns the same publication and sends nothing more; the clip bytes are streamed to the upload route; per-channel outcomes (published with live link, failed) and `nothing_to_cancel` once final.
- Unanswered send after Postiz created the post: record `uncertain`, then adopted by exact time and channel with no second send. Unanswered send with nothing created: sent exactly once more.
- Service rejection (`400` with provider/name/message) becomes a failed channel with that message; a `500` becomes `uncertain` and is reconciled.
- Scheduling keeps the owner's minute, validates past and malformed times, and cancels while queued (the post is deleted in the service).
- Disconnecting an account cancels its queued channel; deleting a clip cancels its publication; the maintenance tick reconciles due records and records the live link.

## Owner website

`npm --prefix owner-app test`: 42 tests pass, including the new `Accounts`, `ClipDetail`, publishing helper and adapter tests. `typecheck` and the production build pass. Covered in jsdom with the API mocked: unconfigured server message, one connection per tap with the platform hand-off, start failure without leaving, return from the platform (`#/accounts?added=…`), remove with confirmation, reconnect for expired authorization, publish review with the saved caption, one request per repeated tap with one idempotency key, shop-time scheduling converted to an instant, cancel while queued, disabled accounts unselectable, rejected publish shown without closing the sheet, live links and failures rendered, and delete copy that mentions already published posts.

### Browser pass (demo data)

The owner website was opened in the in-app browser at a 375×812 viewport with `VITE_DEMO_MODE=true` (sample data, no backend). Signed in with the sample number, Settings showed the Connected accounts row; the Accounts screen listed the sample Facebook Page, "Connect Instagram" went to "Opening…" and, after the demo's same-document return, the account appeared. Clip Detail showed Publish above Share; the sheet showed the saved caption, both accounts as toggles, Now / Pick a time, and a disabled action until an account was chosen. Publishing showed the "Publishing now." toast, a Publishing card with Cancel and "Publishing…" per account, and after the sample outcome settled, "Published" with a View post link per account. The demo return exposed a real gap, fixed in the same pass: the Accounts screen only handled a return on mount, so a hash-only return left it on "Opening…"; it now also handles `hashchange`. This pass proves the screens and flow with sample data only.

## Not verified here

- Any real platform login, page selection or post. Requires a Meta developer app with `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET`, business verification for public use, and a designated test Page/account.
- Hosted Postiz on Google Cloud, HTTPS, backups and restart there. Nothing was provisioned.
- The owner website against the real local Postiz end to end (the API tests use the mock; the real instance was exercised by the verify script). The remaining seam, the API's own HTTP client against the real instance, uses the same routes the verify script called.
