-- ContentStation backend schema. See docs/CONTRACT.md section 3.
create extension if not exists pgcrypto;

-- Enums ---------------------------------------------------------------------
create type public.shop_type as enum ('barbershop', 'detailing', 'wrap', 'tattoo', 'other');
create type public.user_role as enum ('owner', 'staff');
create type public.device_status as enum (
  'waiting', 'reading', 'connecting', 'framing', 'recording', 'paused',
  'nointernet', 'reframe', 'hot', 'fault', 'offline', 'idle'
);
create type public.pause_mode as enum ('none', '1h', 'today', 'indefinite');
create type public.segment_status as enum ('uploaded', 'processing', 'done', 'deleted', 'failed');
create type public.clip_status as enum ('new', 'shared', 'skipped', 'deleted', 'reported');
create type public.clip_event_type as enum ('open', 'share', 'skip', 'delete', 'report');
create type public.job_status as enum ('queued', 'running', 'done', 'failed');
create type public.notification_channel as enum ('sms', 'push', 'ops');

-- Tables --------------------------------------------------------------------
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type public.shop_type not null default 'other',
  instagram text,
  phone text,
  timezone text not null default 'America/Los_Angeles',
  hours jsonb,
  workstation text,
  delivery_hour smallint not null default 8,
  plan text not null default 'trial',
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text,
  shop_id uuid references public.shops (id) on delete set null,
  role public.user_role not null default 'owner',
  created_at timestamptz not null default now()
);
create index users_shop_idx on public.users (shop_id);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  serial text not null,
  model text,
  app_version text,
  status public.device_status not null default 'connecting',
  status_code text,
  status_since timestamptz not null default now(),
  pause_mode public.pause_mode not null default 'none',
  paused_until timestamptz,
  framing_until timestamptz,
  reference_frame_path text,
  last_thumb_path text,
  last_seen_at timestamptz,
  wifi_strength text,
  battery smallint,
  thermal text,
  storage_free_mb integer,
  recording_seconds_today integer not null default 0,
  config_updated_at timestamptz not null default now(),
  paired_at timestamptz not null default now(),
  unpaired_at timestamptz,
  created_at timestamptz not null default now()
);
create index devices_shop_idx on public.devices (shop_id);
create unique index devices_serial_active_idx on public.devices (serial) where unpaired_at is null;

create table public.pair_tokens (
  token text primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  ssid text not null,
  password_enc text not null,
  created_by uuid references public.users (id) on delete set null,
  state text not null default 'waiting',
  device_id uuid references public.devices (id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index pair_tokens_shop_idx on public.pair_tokens (shop_id);

create table public.heartbeats (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.devices (id) on delete cascade,
  at timestamptz not null default now(),
  battery smallint,
  thermal text,
  wifi text,
  storage_free_mb integer,
  state text,
  thumb_path text
);
create index heartbeats_device_at_idx on public.heartbeats (device_id, at desc);

create table public.segments (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  path text not null unique,
  start_ts timestamptz not null,
  end_ts timestamptz not null,
  bytes bigint not null default 0,
  width integer,
  height integer,
  fps integer,
  status public.segment_status not null default 'uploaded',
  delete_after timestamptz not null,
  created_at timestamptz not null default now()
);
create index segments_shop_start_idx on public.segments (shop_id, start_ts desc);
create index segments_delete_after_idx on public.segments (delete_after) where status <> 'deleted';

create table public.engine_jobs (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.segments (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  status public.job_status not null default 'queued',
  attempts integer not null default 0,
  worker text,
  last_error text,
  claimed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index engine_jobs_status_idx on public.engine_jobs (status, created_at);

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  segment_id uuid references public.segments (id) on delete set null,
  path text not null,
  thumb_path text,
  duration_s numeric(6, 2) not null default 0,
  caption text not null default '',
  source_start_s numeric(8, 2),
  source_end_s numeric(8, 2),
  status public.clip_status not null default 'new',
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index clips_shop_created_idx on public.clips (shop_id, created_at desc);

create table public.clip_events (
  id bigint generated always as identity primary key,
  clip_id uuid not null references public.clips (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  type public.clip_event_type not null,
  reason text,
  at timestamptz not null default now()
);
create index clip_events_clip_idx on public.clip_events (clip_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shops (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  type text not null,
  channel public.notification_channel not null,
  body text,
  meta jsonb,
  sent_at timestamptz not null default now(),
  opened_at timestamptz
);
create index notifications_shop_type_idx on public.notifications (shop_id, type, sent_at desc);

-- Helpers -------------------------------------------------------------------
create or replace function public.auth_shop_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select shop_id from public.users where id = auth.uid()
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, phone)
  values (new.id, new.phone)
  on conflict (id) do update set phone = excluded.phone;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of phone on auth.users
  for each row execute function public.handle_new_auth_user();

-- Any change to shop hours, timezone, or workstation must reach the wall app.
create or replace function public.bump_device_config()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.devices set config_updated_at = now()
  where shop_id = new.id and unpaired_at is null;
  return new;
end
$$;

create trigger shops_bump_device_config
  after update of hours, timezone, workstation, delivery_hour on public.shops
  for each row execute function public.bump_device_config();

-- Row level security ----------------------------------------------------------
-- Owners and staff read their own shop. All writes that matter go through the
-- api Edge Function with the service role, except the few owner edits below.
alter table public.shops enable row level security;
alter table public.users enable row level security;
alter table public.devices enable row level security;
alter table public.pair_tokens enable row level security;
alter table public.heartbeats enable row level security;
alter table public.segments enable row level security;
alter table public.engine_jobs enable row level security;
alter table public.clips enable row level security;
alter table public.clip_events enable row level security;
alter table public.notifications enable row level security;

create policy "shop members read their shop" on public.shops
  for select to authenticated using (id = public.auth_shop_id());
create policy "shop members update their shop" on public.shops
  for update to authenticated using (id = public.auth_shop_id()) with check (id = public.auth_shop_id());

create policy "users read themselves and shop mates" on public.users
  for select to authenticated using (id = auth.uid() or shop_id = public.auth_shop_id());
create policy "users update themselves" on public.users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "shop members read devices" on public.devices
  for select to authenticated using (shop_id = public.auth_shop_id());

create policy "shop members read clips" on public.clips
  for select to authenticated using (shop_id = public.auth_shop_id() and status <> 'deleted');
create policy "shop members edit clip captions" on public.clips
  for update to authenticated using (shop_id = public.auth_shop_id()) with check (shop_id = public.auth_shop_id());

create policy "shop members read clip events" on public.clip_events
  for select to authenticated using (exists (select 1 from public.clips c where c.id = clip_id and c.shop_id = public.auth_shop_id()));
create policy "shop members add clip events" on public.clip_events
  for insert to authenticated with check (exists (select 1 from public.clips c where c.id = clip_id and c.shop_id = public.auth_shop_id()));

create policy "shop members read notifications" on public.notifications
  for select to authenticated using (shop_id = public.auth_shop_id() and channel <> 'ops');

-- pair_tokens, heartbeats, segments, engine_jobs: no client policies. Service role only.

-- Storage --------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('segments', 'segments', false, 1073741824, array['video/mp4']),
  ('clips', 'clips', false, 524288000, array['video/mp4']),
  ('thumbs', 'thumbs', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

create policy "shop members read clips and thumbs" on storage.objects
  for select to authenticated
  using (bucket_id in ('clips', 'thumbs') and (storage.foldername(name))[1] = public.auth_shop_id()::text);
