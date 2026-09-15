// JSON shapes from docs/FIREBASE-CONTRACT.md (and the archived docs/archive/SUPABASE-CONTRACT.md sections 2.1 and 3). Keep in sync with the backend.

export type ShopType = 'barbershop' | 'detailing' | 'wrap' | 'tattoo' | 'other';

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface DayHours {
  open: string; // "HH:MM" 24 hour, shop local
  close: string;
}

// null means closed that day
export type Hours = Record<DayKey, DayHours | null>;

export type OnboardingStep = 'shop' | 'wifi' | 'qr' | 'frame' | 'hours' | 'done';

export type DeviceStatus =
  | 'waiting'
  | 'reading'
  | 'connecting'
  | 'framing'
  | 'recording'
  | 'paused'
  | 'nointernet'
  | 'reframe'
  | 'hot'
  | 'fault'
  | 'offline'
  | 'idle';

export type PauseUntil = '1h' | 'today' | 'indefinite';
export type PauseMode = 'none' | '1h' | 'today' | 'indefinite';
export type WifiStrength = 'strong' | 'good' | 'weak' | 'none';
export type Thermal = 'nominal' | 'fair' | 'serious' | 'critical';

export interface User {
  id: string;
  phone: string;
  role?: 'owner' | 'staff';
}

export interface Shop {
  id: string;
  name: string;
  type: ShopType;
  instagram: string | null;
  timezone: string;
  hours: Hours | null;
  workstation: string;
  delivery_hour: number;
}

export interface Device {
  id: string;
  status: DeviceStatus;
  status_code: string | null;
  last_seen_at: string | null;
  reference_frame_path: string | null;
}

export interface Me {
  user: User;
  shop: Shop | null;
  device: Device | null;
  onboarding_step: OnboardingStep;
}

export interface ShopInput {
  name: string;
  type: ShopType;
  instagram?: string | null;
  timezone?: string;
}

export interface ShopPatch {
  name?: string;
  type?: ShopType;
  instagram?: string | null;
  timezone?: string;
  hours?: Hours;
}

export interface PairToken {
  pair_token: string;
  qr_payload: string;
  expires_at: string;
}

export interface PairStatus {
  state: 'waiting' | 'reading' | 'connected' | 'expired';
  device_id?: string;
}

export interface CameraStatus {
  device_id: string;
  status: DeviceStatus;
  status_code: string | null;
  status_since: string;
  paused_until: string | null;
  pause_mode: PauseMode;
  last_seen_at: string | null;
  wifi: WifiStrength;
  thermal: Thermal;
  battery: number;
  storage_free_mb: number;
  last_thumb_url: string;
  hours: Hours;
  timezone: string;
  workstation: string;
  next_delivery_at: string | null;
  recording_seconds_today?: number;
}

export interface FramingStart {
  framing_until: string;
}

export interface Preview {
  url: string;
  captured_at: string;
}

export interface ReferenceFrame {
  reference_frame_path: string;
}

export type ClipStatus = 'new' | 'opened' | 'shared' | 'skipped' | 'reported';

export interface Clip {
  id: string;
  caption: string;
  duration_s: number;
  status: ClipStatus;
  created_at: string;
  delivered_at: string | null;
  video_url: string; // signed, 1 hour. Empty string means no file yet, the UI shows the striped placeholder.
  thumb_url: string;
  source_seconds: number;
  // Mock only. The placeholder label for the striped panel. The server never sends it.
  footage?: string;
}

export interface ClipsResponse {
  date: string; // YYYY-MM-DD shop local
  clips: Clip[];
  older: { date: string; count: number }[];
}

export type ClipEventType = 'open' | 'share' | 'skip' | 'report';

export interface HoursSuggestion {
  hours: Hours;
  source: 'google' | 'default';
}

// Owner-approved social publishing (docs/FIREBASE-CONTRACT.md, publishing section).
export interface PublishingAccount {
  id: string;
  provider: string; // facebook | instagram
  provider_label: string;
  name: string;
  profile: string | null;
  picture: string | null;
  disabled: boolean; // needs reconnecting
}

export interface PublishingOverview {
  configured: boolean; // false when the server has no publishing service
  providers: { id: string; label: string }[];
  accounts: PublishingAccount[];
  connect_completed_at?: string | null;
}

export type PublicationState = 'preparing' | 'sending' | 'queued' | 'uncertain' | 'published' | 'partial' | 'failed' | 'cancelled';
export type ChannelState = 'pending' | 'queued' | 'uncertain' | 'published' | 'failed' | 'cancelled';

export interface PublicationChannel {
  account_id: string;
  provider: string;
  provider_label: string;
  name: string;
  state: ChannelState;
  live_url: string | null;
  error: string | null;
  updated_at: string;
}

export interface Publication {
  id: string;
  clip_id: string;
  kind: 'now' | 'schedule';
  scheduled_at: string; // UTC instant the service will post at
  requested_at: string | null; // the minute the owner chose, for scheduled posts
  timezone: string;
  caption: string; // the caption that is published
  state: PublicationState;
  late: boolean;
  cancel_requested: boolean;
  channels: PublicationChannel[];
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublishInput {
  account_ids: string[];
  schedule_at?: string | null; // ISO instant; omit or null to publish now
  idempotency_key: string; // stable per owner decision so a repeated tap is one publication
}

export interface Session {
  access_token: string;
  user_id: string;
  phone: string | null;
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.message) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
