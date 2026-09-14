import { describe, expect, it, vi } from 'vitest';
import { FirebaseApi, type AuthAdapter } from './firebase';

describe('FirebaseApi requests', () => {
  const auth = (getIdToken = vi.fn(async () => 'fresh-token')): AuthAdapter => ({
    currentUser: { uid: 'u1', phoneNumber: '+14155550142', getIdToken }, waitUntilReady: async () => undefined,
    sendOtp: async () => undefined, verifyOtp: async () => ({ uid: 'u1', phoneNumber: '+14155550142', getIdToken }), signOut: async () => undefined,
  });

  it('gets a current Firebase ID token for every API request', async () => {
    const getIdToken = vi.fn(async () => 'fresh-token');
    const fetch = vi.fn(async () => new Response(JSON.stringify({ user: {}, shop: null, device: null, onboarding_step: 'shop' }), { status: 200 }));
    await new FirebaseApi(auth(getIdToken), 'http://127.0.0.1:4310', fetch).me();
    expect(getIdToken).toHaveBeenCalledWith(false);
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:4310/me', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }) }));
  });

  it('uses DELETE and preserves a backend deletion failure for the UI', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'delete_failed', message: 'Storage is unavailable.' } }), { status: 503 }));
    const request = new FirebaseApi(auth(), 'http://127.0.0.1:4310', fetch).deleteClip('clip/one');
    await expect(request).rejects.toMatchObject({ code: 'delete_failed', message: 'Storage is unavailable.', status: 503 });
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:4310/clips/clip%2Fone', expect.objectContaining({ method: 'DELETE' }));
  });

  it('force-refreshes a rejected token once and retries the request', async () => {
    const getIdToken = vi.fn(async (force?: boolean) => force ? 'renewed-token' : 'expired-token');
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'unauthorized' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: {}, shop: null, device: null, onboarding_step: 'shop' }), { status: 200 }));
    await new FirebaseApi(auth(getIdToken), 'http://127.0.0.1:4310', fetch).me();
    expect(getIdToken.mock.calls).toEqual([[false], [true]]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ headers: expect.objectContaining({ Authorization: 'Bearer renewed-token' }) });
  });

  it('calls the browser fetch function without using the API instance as its receiver', async () => {
    const browserFetch = vi.fn(function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response(JSON.stringify({ user: {}, shop: null, device: null, onboarding_step: 'shop' }), { status: 200 }));
    });
    vi.stubGlobal('fetch', browserFetch);
    try {
      await new FirebaseApi(auth(), 'http://127.0.0.1:4310').me();
      expect(browserFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
