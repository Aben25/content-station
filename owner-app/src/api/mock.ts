import type { Api } from './Api';
import {
  ApiError,
  type CameraStatus,
  type Clip,
  type ClipEventType,
  type ClipsResponse,
  type DeviceStatus,
  type FramingStart,
  type HoursSuggestion,
  type Me,
  type OnboardingStep,
  type PairStatus,
  type PairToken,
  type PauseMode,
  type PauseUntil,
  type Preview,
  type Publication,
  type PublishInput,
  type PublishingAccount,
  type PublishingOverview,
  type ReferenceFrame,
  type Session,
  type Shop,
  type ShopInput,
  type ShopPatch,
  type ShopType,
} from './types';
import product from '../product.json';
import { DEFAULT_HOURS, DEFAULT_TIMEZONE, addDays, browserTimezone, isValidPhone, keyAtTime, nextOpening, todayKey } from '../lib/format';

// In memory backend that reproduces the prototype's data and timing.
// ?mock=offline|attention|paused|empty selects the board's alternate states.
// ?mock=fresh starts with no shop so the whole onboarding can be clicked through.
export type MockVariant = 'default' | 'offline' | 'attention' | 'paused' | 'empty' | 'fresh';

const VARIANTS: MockVariant[] = ['default', 'offline', 'attention', 'paused', 'empty', 'fresh'];

export function mockVariantFromLocation(): MockVariant {
  try {
    const v = new URLSearchParams(location.search).get('mock') as MockVariant | null;
    if (v && VARIANTS.includes(v)) return v;
  } catch {
    // ignore
  }
  return 'default';
}

export const MOCK_PHONE = '(415) 555-0198';
export const MOCK_CODE = '428428';
const MOCK_SSID = 'FadeSociety_5G';

export function mockNetworkName(): string {
  return MOCK_SSID;
}

const SESSION_KEY = 'cs.mock.session';
const PHONE_KEY = 'cs.mock.phone';
const TZ = DEFAULT_TIMEZONE;
const LATENCY = 120;
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function base64(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function randomToken(): string {
  const out: string[] = [];
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  buf.forEach((b) => out.push(TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]));
  return out.join('');
}

interface MockClip extends Clip {
  day: 'today' | 'yesterday';
  deleted: boolean;
}

interface MockDevice {
  id: string;
  status: DeviceStatus;
  reference: boolean;
}

function fadeSociety(): Shop {
  return {
    id: 'shop-1',
    name: 'Fade Society',
    type: 'barbershop',
    instagram: '@fadesociety',
    timezone: TZ,
    hours: { ...DEFAULT_HOURS },
    workstation: 'chair 1',
    delivery_hour: product.deliveryHourLocal,
  };
}

function seedClips(empty: boolean): MockClip[] {
  const today = todayKey(TZ);
  const yesterday = addDays(today, -1);
  const at = (key: string, hhmm: string) => keyAtTime(key, hhmm, TZ).toISOString();
  const mk = (id: string, day: 'today' | 'yesterday', time: string, caption: string, duration_s: number, footage: string, source_seconds: number): MockClip => ({
    id,
    caption,
    duration_s,
    status: 'new',
    created_at: at(day === 'today' ? today : yesterday, time),
    delivered_at: null,
    video_url: '',
    thumb_url: '',
    source_seconds,
    footage,
    day,
    deleted: false,
  });
  if (empty) return [];
  return [
    mk('clip-2', 'today', '10:12', 'Clean skin fade, start to finish.', 14, 'footage: skin fade at chair 1, clippers to finish', 42),
    mk('clip-3', 'today', '11:48', 'Beard lineup with the straight razor.', 9, 'footage: beard lineup, close on the razor', 31),
    mk('clip-4', 'today', '13:05', 'Hot towel. The best part of the cut.', 11, 'footage: hot towel finish, client in the chair', 36),
    mk('clip-5', 'yesterday', '10:40', 'Taper and a clean edge up.', 12, 'footage: taper at chair 1', 38),
    mk('clip-6', 'yesterday', '16:20', 'Fresh cut, fresh start.', 8, 'footage: quick lineup before close', 27),
  ];
}

export class MockApi implements Api {
  private variant: MockVariant;
  private signedIn: boolean;
  private phone: string;
  private shop: Shop | null;
  private device: MockDevice | null;
  private pauseState: { mode: PauseMode; until: string | null } = { mode: 'none', until: null };
  private framingUntil: number | null = null;
  private pair: { token: string; started: number; ssid: string } | null = null;
  private store: MockClip[];
  private bootedAt = Date.now();
  // Sample publishing data. Nothing here reaches a social platform.
  private accounts: PublishingAccount[] = [];
  private publications: Publication[] = [];

  constructor(variant: MockVariant) {
    this.variant = variant;
    this.signedIn = this.read(SESSION_KEY) === '1';
    this.phone = this.read(PHONE_KEY) ?? MOCK_PHONE;
    if (variant === 'fresh') {
      this.shop = null;
      this.device = null;
    } else {
      this.shop = fadeSociety();
      this.device = { id: 'device-1', status: this.baseStatus(), reference: true };
    }
    if (variant === 'paused') {
      this.pauseState = { mode: '1h', until: new Date(Date.now() + 3_600_000).toISOString() };
    }
    this.store = seedClips(variant === 'empty');
    if (variant !== 'fresh' && variant !== 'empty') {
      this.accounts = [{ id: 'acct-fb', provider: 'facebook', provider_label: 'Facebook Page', name: 'Fade Society', profile: null, picture: null, disabled: false }];
    }
  }

  private read(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string | null): void {
    try {
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }

  private baseStatus(): DeviceStatus {
    if (this.variant === 'offline') return 'nointernet';
    if (this.variant === 'attention') return 'reframe';
    return 'recording';
  }

  private requireSession(): void {
    if (!this.signedIn) throw new ApiError('not_signed_in', 'Sign in to continue.', 401);
  }

  private step(): OnboardingStep {
    if (!this.shop) return 'shop';
    if (!this.device || this.device.status === 'waiting') return 'wifi';
    if (!this.device.reference) return 'frame';
    if (!this.shop.hours) return 'hours';
    return 'done';
  }

  private tz(): string {
    return this.shop?.timezone ?? TZ;
  }

  async sendOtp(phone: string): Promise<void> {
    await delay(LATENCY);
    if (!isValidPhone(phone)) throw new ApiError('invalid_phone', 'Enter a mobile number with 10 digits.', 400);
    this.phone = phone;
    this.write(PHONE_KEY, phone);
  }

  async verifyOtp(phone: string, code: string): Promise<Session> {
    await delay(LATENCY);
    if (!/^\d{6}$/.test(code)) throw new ApiError('otp_invalid', "That code didn't match. Try again or text a new one.", 400);
    this.phone = phone || this.phone;
    this.signedIn = true;
    this.write(SESSION_KEY, '1');
    this.write(PHONE_KEY, this.phone);
    return { access_token: 'mock', user_id: 'user-1', phone: this.phone };
  }

  async signOut(): Promise<void> {
    this.signedIn = false;
    this.write(SESSION_KEY, null);
  }

  async getSession(): Promise<Session | null> {
    if (!this.signedIn) return null;
    return { access_token: 'mock', user_id: 'user-1', phone: this.phone };
  }

  async me(): Promise<Me> {
    await delay(LATENCY);
    this.requireSession();
    return {
      user: { id: 'user-1', phone: this.phone, role: 'owner' },
      shop: this.shop ? { ...this.shop } : null,
      device: this.device
        ? {
            id: this.device.id,
            status: this.device.status,
            status_code: null,
            last_seen_at: new Date().toISOString(),
            reference_frame_path: this.device.reference ? 'thumbs/shop-1/device/device-1/reference.jpg' : null,
          }
        : null,
      onboarding_step: this.step(),
    };
  }

  async createShop(input: ShopInput): Promise<Shop> {
    await delay(LATENCY);
    this.requireSession();
    this.shop = {
      id: 'shop-1',
      name: input.name,
      type: input.type,
      instagram: input.instagram ?? null,
      timezone: input.timezone ?? browserTimezone(),
      hours: null,
      workstation: 'chair 1',
      delivery_hour: product.deliveryHourLocal,
    };
    return { ...this.shop };
  }

  async updateShop(patch: ShopPatch): Promise<Shop> {
    await delay(LATENCY);
    this.requireSession();
    if (!this.shop) throw new ApiError('no_shop', 'Add your shop first.', 404);
    this.shop = {
      ...this.shop,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.instagram !== undefined ? { instagram: patch.instagram } : {}),
      ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
      ...(patch.hours !== undefined ? { hours: patch.hours } : {}),
    };
    return { ...this.shop };
  }

  async createPairToken(ssid: string, password: string): Promise<PairToken> {
    await delay(LATENCY);
    this.requireSession();
    if (!this.shop) throw new ApiError('no_shop', 'Add your shop first.', 404);
    const token = randomToken();
    this.pair = { token, started: Date.now(), ssid };
    return {
      pair_token: token,
      qr_payload: base64(JSON.stringify({ v: 1, ssid, password, pair_token: token })),
      expires_at: new Date(Date.now() + product.pairTokenMinutes * 60_000).toISOString(),
    };
  }

  async pairStatus(token: string): Promise<PairStatus> {
    await delay(60);
    this.requireSession();
    if (!this.pair || this.pair.token !== token) return { state: 'expired' };
    const elapsed = Date.now() - this.pair.started;
    if (elapsed < 2500) return { state: 'waiting' };
    if (elapsed < 4500) return { state: 'reading' };
    if (!this.device) this.device = { id: 'device-1', status: this.baseStatus(), reference: false };
    else this.device.status = this.baseStatus();
    return { state: 'connected', device_id: this.device.id };
  }

  async cameraStatus(): Promise<CameraStatus> {
    await delay(LATENCY);
    this.requireSession();
    if (!this.shop) throw new ApiError('no_shop', 'Add your shop first.', 404);
    if (!this.device) throw new ApiError('no_device', 'No camera is connected yet. Re-scan the QR to connect one.', 404);
    const now = Date.now();
    const tz = this.tz();
    const today = todayKey(tz);
    if (this.pauseState.mode !== 'none' && this.pauseState.until && Date.parse(this.pauseState.until) <= now) {
      this.pauseState = { mode: 'none', until: null };
    }
    let status: DeviceStatus = this.device.status;
    if (this.device.status !== 'waiting') {
      if (this.framingUntil && this.framingUntil > now) status = 'framing';
      else if (this.pauseState.mode !== 'none') status = 'paused';
      else status = this.baseStatus();
    }
    const stamp = (hhmm: string) => keyAtTime(today, hhmm, tz).toISOString();
    let statusSince = new Date(this.bootedAt).toISOString();
    let lastSeen = new Date().toISOString();
    if (status === 'recording') statusSince = stamp(this.variant === 'empty' ? '09:40' : '09:02');
    if (status === 'nointernet') {
      statusSince = stamp('14:14');
      lastSeen = stamp('14:14');
    }
    if (this.variant === 'empty') lastSeen = stamp('11:40');
    return {
      device_id: this.device.id,
      status,
      status_code: null,
      status_since: statusSince,
      paused_until: status === 'paused' ? this.pauseState.until : null,
      pause_mode: status === 'paused' ? this.pauseState.mode : 'none',
      last_seen_at: lastSeen,
      wifi: status === 'nointernet' ? 'none' : 'strong',
      thermal: 'nominal',
      battery: 100,
      storage_free_mb: 41230,
      last_thumb_url: '',
      hours: this.shop.hours ?? { ...DEFAULT_HOURS },
      timezone: tz,
      workstation: this.shop.workstation,
      next_delivery_at: keyAtTime(addDays(today, 1), `${String(this.shop.delivery_hour).padStart(2, '0')}:00`, tz).toISOString(),
    };
  }

  async pause(until: PauseUntil): Promise<CameraStatus> {
    await delay(LATENCY);
    this.requireSession();
    const tz = this.tz();
    if (until === '1h') this.pauseState = { mode: '1h', until: new Date(Date.now() + 3_600_000).toISOString() };
    else if (until === 'today') this.pauseState = { mode: 'today', until: nextOpening(this.shop?.hours, tz)?.toISOString() ?? null };
    else this.pauseState = { mode: 'indefinite', until: null };
    return this.cameraStatus();
  }

  async resume(): Promise<CameraStatus> {
    await delay(LATENCY);
    this.requireSession();
    this.pauseState = { mode: 'none', until: null };
    return this.cameraStatus();
  }

  async framingStart(): Promise<FramingStart> {
    await delay(LATENCY);
    this.requireSession();
    this.framingUntil = Date.now() + 10 * 60_000;
    return { framing_until: new Date(this.framingUntil).toISOString() };
  }

  async preview(): Promise<Preview | null> {
    await delay(60);
    this.requireSession();
    // The mock has no camera, so there is never a JPEG. The screen keeps the striped placeholder.
    return null;
  }

  async saveReferenceFrame(): Promise<ReferenceFrame> {
    await delay(LATENCY);
    this.requireSession();
    if (!this.device) throw new ApiError('no_device', 'No camera is connected yet. Re-scan the QR to connect one.', 404);
    this.device.reference = true;
    this.framingUntil = null;
    return { reference_frame_path: 'thumbs/shop-1/device/device-1/reference.jpg' };
  }

  async unpair(): Promise<void> {
    await delay(LATENCY);
    this.requireSession();
    if (this.device) this.device.status = 'waiting';
  }

  private visible(day: 'today' | 'yesterday'): Clip[] {
    return this.store      .filter((c) => c.day === day && !c.deleted && c.status !== 'skipped' && c.status !== 'reported')
      .map((c) => this.strip(c));
  }

  private strip(c: MockClip): Clip {
    const { day: _day, deleted: _deleted, ...clip } = c;
    return clip;
  }

  async clips(date?: string): Promise<ClipsResponse> {
    await delay(LATENCY);
    this.requireSession();
    const tz = this.tz();
    const today = todayKey(tz);
    const yesterday = addDays(today, -1);
    const key = date ?? today;
    if (key === today) {
      const older = this.visible('yesterday').length;
      return { date: key, clips: this.visible('today'), older: older ? [{ date: yesterday, count: older }] : [] };
    }
    if (key === yesterday) return { date: key, clips: this.visible('yesterday'), older: [] };
    return { date: key, clips: [], older: [] };
  }

  private find(id: string): MockClip {
    const c = this.store.find((x) => x.id === id && !x.deleted);
    if (!c) throw new ApiError('not_found', 'That clip is gone.', 404);
    return c;
  }

  async clip(id: string): Promise<Clip> {
    await delay(LATENCY);
    this.requireSession();
    return this.strip(this.find(id));
  }

  async updateCaption(id: string, caption: string): Promise<Clip> {
    await delay(LATENCY);
    this.requireSession();
    const c = this.find(id);
    c.caption = caption;
    return this.strip(c);
  }

  async clipEvent(id: string, type: ClipEventType): Promise<Clip> {
    await delay(LATENCY);
    this.requireSession();
    const c = this.find(id);
    if (type === 'skip') c.status = 'skipped';
    else if (type === 'report') c.status = 'reported';
    else if (type === 'share') c.status = 'shared';
    else if (type === 'open' && c.status === 'new') c.status = 'opened';
    return this.strip(c);
  }

  async deleteClip(id: string): Promise<void> {
    await delay(LATENCY);
    this.requireSession();
    this.find(id).deleted = true;
  }

  async publishingAccounts(): Promise<PublishingOverview> {
    await delay(LATENCY);
    this.requireSession();
    return { configured: true, providers: [{ id: 'facebook', label: 'Facebook Page' }, { id: 'instagram', label: 'Instagram' }], accounts: this.accounts.map((a) => ({ ...a })) };
  }

  // The demo skips the platform login and lands back on the accounts screen as a real connection would.
  async connectAccount(provider: string): Promise<{ url: string; provider: string }> {
    await delay(LATENCY);
    this.requireSession();
    const label = provider === 'instagram' ? 'Instagram' : 'Facebook Page';
    const name = provider === 'instagram' ? '@fadesociety' : 'Fade Society';
    if (!this.accounts.some((a) => a.provider === provider)) this.accounts.push({ id: `acct-${provider}`, provider, provider_label: label, name, profile: null, picture: null, disabled: false });
    for (const a of this.accounts) if (a.provider === provider) a.disabled = false;
    return { url: `${location.origin}${location.pathname}${location.search}#/accounts?added=${provider}&msg=Channel%20Added`, provider };
  }

  async reconnectAccount(id: string, provider: string): Promise<{ url: string; provider: string }> {
    const a = this.accounts.find((x) => x.id === id);
    if (!a) throw new ApiError('account_missing', 'That account is not connected to your shop.', 404);
    return this.connectAccount(provider);
  }

  async disconnectAccount(id: string): Promise<void> {
    await delay(LATENCY);
    this.requireSession();
    if (!this.accounts.some((a) => a.id === id)) throw new ApiError('account_missing', 'That account is not connected to your shop.', 404);
    this.accounts = this.accounts.filter((a) => a.id !== id);
    for (const p of this.publications) for (const c of p.channels) if (c.account_id === id && (c.state === 'queued' || c.state === 'pending')) { c.state = 'cancelled'; c.error = 'The account was disconnected.'; }
  }

  async publishClip(id: string, input: PublishInput): Promise<Publication> {
    await delay(LATENCY);
    this.requireSession();
    const clip = this.find(id);
    const existing = this.publications.find((p) => p.id === `pub-${input.idempotency_key}`);
    if (existing) return structuredClone(existing);
    if (!input.account_ids.length) throw new ApiError('invalid_accounts', 'Choose between one and 5 accounts.', 400);
    const chosen = input.account_ids.map((aid) => {
      const a = this.accounts.find((x) => x.id === aid);
      if (!a) throw new ApiError('account_missing', 'One of the chosen accounts is not connected to your shop.', 404);
      if (a.disabled) throw new ApiError('account_disabled', `${a.name} needs to be reconnected first.`, 409);
      return a;
    });
    const now = new Date().toISOString();
    const when = input.schedule_at ?? new Date(Date.now() + 30_000).toISOString();
    const pub: Publication = {
      id: `pub-${input.idempotency_key}`, clip_id: id, kind: input.schedule_at ? 'schedule' : 'now', scheduled_at: when, requested_at: input.schedule_at ?? null,
      timezone: this.tz(), caption: clip.caption, state: 'queued', late: false, cancel_requested: false, last_error: null, created_at: now, updated_at: now,
      channels: chosen.map((a) => ({ account_id: a.id, provider: a.provider, provider_label: a.provider_label, name: a.name, state: 'queued', live_url: null, error: null, updated_at: now })),
    };
    this.publications.unshift(pub);
    return structuredClone(pub);
  }

  private settle(p: Publication): void {
    if (p.state !== 'queued' || Date.parse(p.scheduled_at) > Date.now()) return;
    // Sample outcome: the post is "published" a few seconds after its time. Not a real platform result.
    const stamp = new Date().toISOString();
    for (const c of p.channels) if (c.state === 'queued') { c.state = 'published'; c.live_url = c.provider === 'instagram' ? 'https://www.instagram.com/' : 'https://www.facebook.com/'; c.updated_at = stamp; }
    const states = p.channels.map((c) => c.state);
    p.state = states.every((x) => x === 'published') ? 'published' : states.some((x) => x === 'published') ? 'partial' : 'cancelled';
    p.updated_at = stamp;
  }

  async clipPublications(id: string): Promise<Publication[]> {
    await delay(60);
    this.requireSession();
    const list = this.publications.filter((p) => p.clip_id === id);
    list.forEach((p) => this.settle(p));
    return structuredClone(list);
  }

  async publication(id: string): Promise<Publication> {
    await delay(60);
    this.requireSession();
    const p = this.publications.find((x) => x.id === id);
    if (!p) throw new ApiError('publication_missing', 'This publication was not found.', 404);
    this.settle(p);
    return structuredClone(p);
  }

  async cancelPublication(id: string): Promise<Publication> {
    await delay(LATENCY);
    const p = await this.publication(id);
    const live = this.publications.find((x) => x.id === id)!;
    if (!live.channels.some((c) => c.state === 'queued' || c.state === 'pending' || c.state === 'uncertain')) throw new ApiError('nothing_to_cancel', p.state === 'published' ? 'This clip was already published.' : 'There is nothing left to cancel.', 409);
    const stamp = new Date().toISOString();
    for (const c of live.channels) if (c.state === 'queued' || c.state === 'pending' || c.state === 'uncertain') { c.state = 'cancelled'; c.updated_at = stamp; }
    live.state = live.channels.some((c) => c.state === 'published') ? 'partial' : 'cancelled';
    live.updated_at = stamp;
    return structuredClone(live);
  }

  async suggestHours(name: string, _type: ShopType): Promise<HoursSuggestion> {
    await delay(LATENCY);
    this.requireSession();
    const source = name.trim().toLowerCase() === 'fade society' ? 'google' : 'default';
    return { hours: { ...DEFAULT_HOURS }, source };
  }
}
