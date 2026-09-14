import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Api } from './Api';
import {
  ApiError,
  type CameraStatus,
  type Clip,
  type ClipEventType,
  type ClipsResponse,
  type FramingStart,
  type HoursSuggestion,
  type Me,
  type PairStatus,
  type PairToken,
  type PauseUntil,
  type Preview,
  type ReferenceFrame,
  type Session,
  type Shop,
  type ShopInput,
  type ShopPatch,
  type ShopType,
} from './types';
import { normalizePhone } from '../lib/format';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const NETWORK_MESSAGE = "Couldn't reach the server. Check your connection and try again.";

export class SupabaseApi implements Api {
  private client: SupabaseClient;
  private base: string;
  private anonKey: string;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    this.base = `${url.replace(/\/+$/, '')}/functions/v1/api`;
    this.anonKey = anonKey;
  }

  async sendOtp(phone: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({ phone: normalizePhone(phone) });
    if (error) throw new ApiError('otp_send_failed', error.message, error.status ?? 400);
  }

  async verifyOtp(phone: string, code: string): Promise<Session> {
    const { data, error } = await this.client.auth.verifyOtp({ phone: normalizePhone(phone), token: code, type: 'sms' });
    if (error || !data.session) throw new ApiError('otp_invalid', error?.message ?? "That code didn't match. Try again or text a new one.", error?.status ?? 400);
    return { access_token: data.session.access_token, user_id: data.session.user.id, phone: data.session.user.phone ?? null };
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  async getSession(): Promise<Session | null> {
    const { data } = await this.client.auth.getSession();
    const s = data.session;
    if (!s) return null;
    return { access_token: s.access_token, user_id: s.user.id, phone: s.user.phone ?? null };
  }

  me(): Promise<Me> {
    return this.request<Me>('GET', '/me');
  }

  async createShop(input: ShopInput): Promise<Shop> {
    const r = await this.request<{ shop: Shop }>('POST', '/shops', input);
    return r.shop;
  }

  async updateShop(patch: ShopPatch): Promise<Shop> {
    const r = await this.request<{ shop: Shop }>('PATCH', '/shops/current', patch);
    return r.shop;
  }

  createPairToken(ssid: string, password: string): Promise<PairToken> {
    return this.request<PairToken>('POST', '/pair/token', { ssid, password });
  }

  pairStatus(token: string): Promise<PairStatus> {
    return this.request<PairStatus>('GET', `/pair/status?pair_token=${encodeURIComponent(token)}`);
  }

  cameraStatus(): Promise<CameraStatus> {
    return this.request<CameraStatus>('GET', '/camera/status');
  }

  pause(until: PauseUntil): Promise<CameraStatus> {
    return this.request<CameraStatus>('POST', '/camera/pause', { until });
  }

  resume(): Promise<CameraStatus> {
    return this.request<CameraStatus>('POST', '/camera/resume');
  }

  framingStart(): Promise<FramingStart> {
    return this.request<FramingStart>('POST', '/camera/framing/start');
  }

  preview(): Promise<Preview | null> {
    return this.request<Preview | null>('GET', '/camera/preview');
  }

  saveReferenceFrame(): Promise<ReferenceFrame> {
    return this.request<ReferenceFrame>('POST', '/camera/reference-frame');
  }

  async unpair(): Promise<void> {
    await this.request<{ ok: true }>('POST', '/camera/unpair');
  }

  clips(date?: string): Promise<ClipsResponse> {
    return this.request<ClipsResponse>('GET', date ? `/clips?date=${encodeURIComponent(date)}` : '/clips');
  }

  clip(id: string): Promise<Clip> {
    return this.request<Clip>('GET', `/clips/${encodeURIComponent(id)}`);
  }

  updateCaption(id: string, caption: string): Promise<Clip> {
    return this.request<Clip>('PATCH', `/clips/${encodeURIComponent(id)}`, { caption });
  }

  clipEvent(id: string, type: ClipEventType, reason?: string): Promise<Clip> {
    return this.request<Clip>('POST', `/clips/${encodeURIComponent(id)}/event`, reason ? { type, reason } : { type });
  }

  async deleteClip(id: string): Promise<void> {
    await this.request<{ ok: true }>('DELETE', `/clips/${encodeURIComponent(id)}`);
  }

  suggestHours(name: string, type: ShopType): Promise<HoursSuggestion> {
    return this.request<HoursSuggestion>('GET', `/shop/hours/suggest?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`);
  }

  private async request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const { data } = await this.client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new ApiError('not_signed_in', 'Sign in to continue.', 401);
    const headers: Record<string, string> = {
      apikey: this.anonKey,
      Authorization: `Bearer ${token}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError('network', NETWORK_MESSAGE, 0);
    }
    if (res.status === 204) return null as T;
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const envelope = json as { error?: { code?: string; message?: string } } | null;
      const code = envelope?.error?.code ?? `http_${res.status}`;
      const message = envelope?.error?.message ?? 'Something went wrong. Try again.';
      throw new ApiError(code, message, res.status);
    }
    return json as T;
  }
}
