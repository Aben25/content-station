import type { Api } from './Api';
import { ApiError, type CameraStatus, type Clip, type ClipEventType, type ClipsResponse, type FramingStart, type HoursSuggestion, type Me, type PairStatus, type PairToken, type PauseUntil, type Preview, type ReferenceFrame, type Session, type Shop, type ShopInput, type ShopPatch, type ShopType } from './types';
import { normalizePhone } from '../lib/format';
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export interface AuthUserAdapter { uid: string; phoneNumber: string | null; getIdToken(forceRefresh?: boolean): Promise<string>; }
export interface AuthAdapter { readonly currentUser: AuthUserAdapter | null; waitUntilReady(): Promise<void>; sendOtp(phone: string): Promise<void>; verifyOtp(code: string): Promise<AuthUserAdapter>; signOut(): Promise<void>; }
export class FirebaseApi implements Api {
  private fetcher: typeof fetch;
  constructor(private auth: AuthAdapter, private base: string, fetcher?: typeof fetch) {
    this.fetcher = fetcher ?? ((input, init) => fetch(input, init));
  }
  sendOtp(phone: string) { return this.auth.sendOtp(normalizePhone(phone)); }
  async verifyOtp(_phone: string, code: string): Promise<Session> { return this.session(await this.auth.verifyOtp(code)); }
  signOut() { return this.auth.signOut(); }
  async getSession(): Promise<Session | null> { await this.auth.waitUntilReady(); return this.auth.currentUser ? this.session(this.auth.currentUser) : null; }
  me() { return this.request<Me>('GET', '/me'); }
  async createShop(input: ShopInput) { return (await this.request<{ shop: Shop }>('POST', '/shops', input)).shop; }
  async updateShop(patch: ShopPatch) { return (await this.request<{ shop: Shop }>('PATCH', '/shops/current', patch)).shop; }
  createPairToken(ssid: string, password: string) { return this.request<PairToken>('POST', '/pair/token', { ssid, password }); }
  pairStatus(token: string) { return this.request<PairStatus>('GET', `/pair/status?pair_token=${encodeURIComponent(token)}`); }
  cameraStatus() { return this.request<CameraStatus>('GET', '/camera/status'); }
  pause(until: PauseUntil) { return this.request<CameraStatus>('POST', '/camera/pause', { until }); }
  resume() { return this.request<CameraStatus>('POST', '/camera/resume'); }
  framingStart() { return this.request<FramingStart>('POST', '/camera/framing/start'); }
  preview() { return this.request<Preview | null>('GET', '/camera/preview'); }
  saveReferenceFrame() { return this.request<ReferenceFrame>('POST', '/camera/reference-frame'); }
  async unpair() { await this.request<{ ok: true }>('POST', '/camera/unpair'); }
  clips(date?: string) { return this.request<ClipsResponse>('GET', date ? `/clips?date=${encodeURIComponent(date)}` : '/clips'); }
  clip(id: string) { return this.request<Clip>('GET', `/clips/${encodeURIComponent(id)}`); }
  updateCaption(id: string, caption: string) { return this.request<Clip>('PATCH', `/clips/${encodeURIComponent(id)}`, { caption }); }
  clipEvent(id: string, type: ClipEventType, reason?: string) { return this.request<Clip>('POST', `/clips/${encodeURIComponent(id)}/event`, reason ? { type, reason } : { type }); }
  async deleteClip(id: string) { await this.request<{ ok: true }>('DELETE', `/clips/${encodeURIComponent(id)}`); }
  suggestHours(name: string, type: ShopType) { return this.request<HoursSuggestion>('GET', `/shop/hours/suggest?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`); }
  private async session(user: AuthUserAdapter): Promise<Session> { return { access_token: await user.getIdToken(false), user_id: user.uid, phone: user.phoneNumber }; }
  private async request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    await this.auth.waitUntilReady(); const user = this.auth.currentUser;
    if (!user) throw new ApiError('not_signed_in', 'Sign in to continue.', 401);
    let response: Response;
    const perform = async (forceRefresh: boolean) => {
      const headers: Record<string, string> = { Authorization: `Bearer ${await user.getIdToken(forceRefresh)}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      return this.fetcher(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    };
    try {
      response = await perform(false);
      if (response.status === 401) response = await perform(true);
    } catch { throw new ApiError('network', "Couldn't reach the server. Check your connection and try again.", 0); }
    if (response.status === 204) return null as T;
    const text = await response.text(); let json: unknown = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!response.ok) { const envelope = json as { error?: { code?: string; message?: string } } | null; throw new ApiError(envelope?.error?.code ?? `http_${response.status}`, envelope?.error?.message ?? 'Something went wrong. Try again.', response.status); }
    return json as T;
  }
}
