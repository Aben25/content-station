# ContentStation backend

Supabase: Postgres, Storage, Auth (phone OTP), one Edge Function named `api`, pg_cron tick. Everything the wall app and owner app talk to is in `docs/CONTRACT.md`.

## Layout

```
supabase/
  config.toml                 local stack config, phone OTP test code, api function with verify_jwt off
  migrations/0001_init.sql    schema, RLS, buckets
  migrations/0002_cron.sql    minute tick (pg_cron + pg_net)
  migrations/0003_engine_claim.sql  atomic job claim for the engine
  functions/_shared/          env, router, auth, jwt, crypto, hours, storage, sms, config builders
  functions/api/index.ts      entrypoint, mounts every route
  functions/api/routes/       auth, shops, pair, device, camera, clips, engine, cron
  .env.example                secrets the function needs
```

## Local

Docker is required for `supabase start`. Then:

```bash
npx supabase start
npx supabase db reset
npx supabase functions serve api --env-file supabase/.env --no-verify-jwt
```

Test OTP: phone `(415) 555-0198` accepts code `428428` (see `[auth.sms.test_otp]` in config.toml). Texts are dry run until Twilio secrets are set.

Type check without Docker:

```bash
cd supabase/functions/api && deno check index.ts && deno lint
```

## Deploy

```bash
npx supabase link --project-ref <ref>
npx supabase db push
npx supabase secrets set --env-file supabase/.env
npx supabase functions deploy api --no-verify-jwt
```

Then point the cron tick at the function (once, in the SQL editor):

```sql
alter database postgres set app.settings.api_url = 'https://<ref>.supabase.co/functions/v1/api';
alter database postgres set app.settings.cron_secret = '<CRON_SECRET>';
```

Do not run `npx supabase config push` while `[auth.sms.test_otp]` is set in config.toml. It would let anyone sign in as that test number on the hosted project.

Hosted auth: enable the Twilio SMS provider in the dashboard (or flip `enabled = true` under `[auth.sms.twilio]` and `npx supabase config push`). Set the Twilio inbound webhook for the START number to `POST {api_url}/sms/inbound`.

## Rules kept from the handoff

- Wi-Fi password is AES-GCM encrypted in `pair_tokens.password_enc`, blanked on claim, and the row is deleted an hour after expiry.
- Pair tokens are single use and expire after `pairTokenMinutes`.
- Nothing logs a Wi-Fi password, pair token, or device JWT.
- Device routes are idempotent on `path` and tolerate retries and out of order arrival.
- Raw segments are deleted after `rawRetentionHours` by the tick. Clips stay until the owner deletes them.
- Only owners can delete clips (staff get a 403). Open question in the handoff, this is the prototype's assumption.
