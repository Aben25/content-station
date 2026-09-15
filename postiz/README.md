# Self-hosted Postiz for ContentStation

ContentStation publishes owner-approved clips through [Postiz](https://github.com/gitroomhq/postiz-app), an open-source social publishing service, run as a separate service with one Postiz organization per shop. This directory holds the pinned deployment definition and the operating notes. The ContentStation API integration lives in `firebase-api/src/postiz.ts` and `firebase-api/src/publishing.ts`.

## Pin

| Item | Value |
| --- | --- |
| Release | `v2.23.0` (2026-08-04), commit `1e4c8dd5c4f70c4d0abd01e23cc42d5b533d1ab9` |
| Image | `ghcr.io/gitroomhq/postiz-app:v2.23.0@sha256:785f97312f66a347fb96cdccc4ded5a33ced69a672c89a9adc8054e7d6a21dc5` (multi-arch index; arm64 and amd64) |
| Companions | `postgres:17-alpine`, `redis:7.2`, `temporalio/auto-setup:1.28.1`, `postgres:16-alpine` (Temporal store), `elasticsearch:7.17.27` (Temporal visibility), `temporalio/ui:2.34.0` (optional, `--profile debug`) |
| License | Postiz is AGPL-3.0. This stack runs the unmodified upstream image as a separate network service; the upstream repository is the source for that image. Review the license before modifying or redistributing Postiz itself. Nothing here changes the ContentStation code's own licensing. |

The tag and digest are pinned together in `docker-compose.yml`. Elasticsearch is not optional: Postiz registers custom Temporal search attributes of type Text, and Temporal's SQL visibility store refuses more than three, so the backend fails at startup without Elasticsearch (observed locally: `cannot have more than 3 search attribute of type Text`).

## Local use

```sh
node scripts/postiz-local.mjs setup    # writes postiz/.env and postiz/postiz.env with random secrets (ignored by Git)
node scripts/postiz-local.mjs up       # docker compose up -d, waits for the API (first start takes a few minutes)
node scripts/postiz-local.mjs verify   # two-organization isolation check against the running instance
node scripts/postiz-local.mjs down     # stop; add --wipe to delete the data volumes
```

Docker is required. On a Mac without Docker Desktop, `brew install colima docker docker-compose` and `colima start --cpu 4 --memory 8` work; the compose plugin needs `cliPluginsExtraDirs` in `~/.docker/config.json` pointing at `/opt/homebrew/lib/docker/cli-plugins`.

The API entry point is `http://127.0.0.1:4007/api` (nginx inside the container proxies `/api/` to the backend, serves `/uploads/` and the web app). Point the ContentStation API at it with:

```sh
POSTIZ_URL=http://127.0.0.1:4007/api
POSTIZ_JWT_SECRET=<JWT_SECRET from postiz/postiz.env>
PUBLISHING_SECRET=<any 32+ character secret>
```

`postiz.env.example` enables `DISABLE_SSRF_PROTECTION` and `NOT_SECURED` because the local ContentStation API sits on a loopback address and the stack has no TLS. Both must stay unset on a hosted instance.

`verify` provisions two throwaway organizations, uploads a PNG and a locally generated MP4 to each, inserts clearly labelled fake channel rows straight into the local database, stores drafts, and checks that organization A's key cannot read, post to, delete or list anything of organization B, then restarts the application container and checks the data survives. Drafts never start a publishing workflow, and no social platform is contacted. The fake channels are a fixture for access checks only. See `docs/reports/postiz-local-verification.md` for the recorded run.

## How ContentStation uses Postiz

| Need | Route on the pinned release | Notes |
| --- | --- | --- |
| Create a shop's organization | `POST /enterprise/create-user` with `{ params: JWT }` | JWT signed with the instance `JWT_SECRET`; payload `{ id, name, saasName, email }`. Returns `{ id, apiKey }`. A repeated email returns `{ create: false }` and no key, so the API records its attempt before calling and uses a new synthetic email per attempt. |
| Start a channel connection | `POST /enterprise/url` with `{ params: JWT }` | Payload `{ apiKey, provider, redirectUrl, webhookUrl, refreshId? }`. Returns the platform login URL. After the login (and the page picker for Facebook/Instagram), Postiz calls `webhookUrl` with `{ params: JWT{ apiKey } }` and sends the browser to `redirectUrl?added=<provider>&msg=...`. No Postiz login is involved. |
| List, remove channels | `GET /public/v1/integrations`, `DELETE /public/v1/integrations/:id` | Organization API key in the `Authorization` header (no `Bearer`). |
| Upload media | `POST /public/v1/upload` (multipart `file`) | MP4 up to 1 GB; the type is sniffed from the bytes. The stored file is served publicly at `{FRONTEND_URL}/uploads/...`, which the platforms fetch. |
| Publish or schedule | `POST /public/v1/posts` | `type: schedule` with an explicit `date`; one entry per channel; `settings.__type` = provider (`facebook` needs nothing extra, `instagram` needs `post_type: post`). Returns `[{ postId, integration }]`. There is no idempotency key. |
| Outcome | `GET /public/v1/posts?startDate&endDate` | Returns `state` (`QUEUE`, `PUBLISHED`, `ERROR`) and `releaseURL` per post. Failure text is not exposed here. |
| Cancel | `DELETE /public/v1/posts/:id` | Removes the whole group. |

Because post creation is not idempotent, the ContentStation API stores each publication before sending, gives it an exact scheduled second that is unique per publication, and on an unanswered send looks the posts up by time and channel before sending again. Postiz's organization webhooks are unsigned and can only be configured through the Postiz web UI, so they are not used; the API polls instead, and the maintenance tick reconciles due records.

Provider credentials (`FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET`, optionally `INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET`) come from a Meta developer app whose OAuth redirect URIs are `{FRONTEND_URL}/integrations/social/facebook` and `{FRONTEND_URL}/integrations/social/instagram`. Without them the connect flow returns an error and the providers are effectively unavailable. See `docs/HOSTED-SETUP.md` for the hosted plan; no hosted Postiz has been provisioned yet.

## Known limits of the pinned release

- The public API has no route to delete media. Media copied into a shop's organization stays in that organization's library until removed in the Postiz UI or by a server-side cleanup. The owner app says so when deleting a clip.
- Per-post failure reasons are not returned by the public list route; the owner sees a generic failure with a reconnect hint.
- If the platform login fails or is cancelled, Postiz shows its own error page and does not redirect back; the owner uses the browser's Back button (the accounts screen explains this).
- `API_LIMIT` is a global per-client-IP hourly budget for the whole backend. It is set high because the ContentStation API polls from one address.
- `DISABLE_REGISTRATION=true` still permits the first web registration on an empty instance; shop organizations are created through the enterprise route regardless.

## Data, backups, upgrades

Volumes: `postiz-postgres` (organizations, channels, tokens, posts), `postiz-uploads` (media served to platforms), `postiz-redis` (OAuth state, throttling), `postiz-config`, `temporal-postgres` and `temporal-elasticsearch` (workflow state for scheduled posts).

Backup, with the stack running:

```sh
cd postiz
docker compose exec -T postiz-postgres pg_dump -U postiz -d postiz -Fc > backups/postiz-$(date +%F).dump
docker run --rm -v contentstation-postiz_postiz-uploads:/data -v "$PWD/backups":/out alpine tar czf /out/uploads-$(date +%F).tgz -C /data .
```

Restore into an empty stack: `docker compose up -d postiz-postgres`, `pg_restore -U postiz -d postiz --clean --if-exists` from the dump, untar the uploads archive into the uploads volume, then `docker compose up -d`. Scheduled posts that were in flight during the outage are re-pushed by Postiz's missing-post sweep once the workflow state is back; verify them in the owner app. `backups/` is ignored by Git.

Upgrade: read the upstream release notes, change the tag and digest together in `docker-compose.yml`, `docker compose pull`, take a backup, `docker compose up -d`. The image applies its own database migrations on start. Re-run `node scripts/postiz-local.mjs verify` and the API tests, and recheck the routes in the table above against the new source before relying on them.
