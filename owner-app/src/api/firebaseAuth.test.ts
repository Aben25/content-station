import { beforeEach, expect, it, vi } from 'vitest';
import { createFirebaseAuthAdapter, phoneAuthErrorMessage } from './firebaseAuth';
const { send, clear, createVerifier, auth } = vi.hoisted(() => ({ send: vi.fn(), clear: vi.fn(), createVerifier: vi.fn(), auth: { currentUser: null, authStateReady: vi.fn(), signOut: vi.fn() } }));
vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/auth', () => ({ getAuth: () => auth, connectAuthEmulator: vi.fn(), signInWithPhoneNumber: send, RecaptchaVerifier: class { clear = clear; constructor(...args: unknown[]) { createVerifier(...args); } } }));
const config = { mode: 'firebase', firebase: {}, apiBaseUrl: 'https://api.example' } as any;
beforeEach(() => vi.resetAllMocks());
it('reuses one persistent invisible verifier across successful and failed resends', async () => {
  const adapter = createFirebaseAuthAdapter(config);
  send.mockResolvedValueOnce({ confirm: vi.fn() }).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ confirm: vi.fn() });
  await adapter.sendOtp('+15551234567');
  await expect(adapter.sendOtp('+15551234567')).rejects.toThrow('network');
  await adapter.sendOtp('+15551234567');
  expect(createVerifier).toHaveBeenCalledExactlyOnceWith(auth, 'firebase-recaptcha', { size: 'invisible' });
  expect(clear).not.toHaveBeenCalled();
  expect(send.mock.calls.every(call => call[2] === send.mock.calls[0][2])).toBe(true);
});
it('rejects overlapping sends and verification without issuing another Firebase request', async () => {
  const adapter = createFirebaseAuthAdapter(config); let finish!: (value: any) => void;
  send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = adapter.sendOtp('+15551234567');
  await expect(adapter.sendOtp('+15551234567')).rejects.toMatchObject({ code: 'auth/operation-in-progress' });
  await expect(adapter.verifyOtp('123456')).rejects.toMatchObject({ code: 'auth/operation-in-progress' });
  expect(send).toHaveBeenCalledOnce(); finish({ confirm: vi.fn() }); await pending;
});
it('uses the latest confirmation, blocks duplicate confirmation, and clears it after success', async () => {
  const adapter = createFirebaseAuthAdapter(config); let finish!: (value: any) => void;
  const first = vi.fn(), second = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  send.mockResolvedValueOnce({ confirm: first }).mockResolvedValueOnce({ confirm: second });
  await adapter.sendOtp('+15551234567'); await adapter.sendOtp('+15551234567');
  const pending = adapter.verifyOtp('123456');
  await expect(adapter.verifyOtp('123456')).rejects.toMatchObject({ code: 'auth/operation-in-progress' });
  await expect(adapter.sendOtp('+15551234567')).rejects.toMatchObject({ code: 'auth/operation-in-progress' });
  finish({ user: { uid: 'owner' } }); expect(await pending).toEqual({ uid: 'owner' });
  expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
  await expect(adapter.verifyOtp('123456')).rejects.toMatchObject({ code: 'auth/missing-verification-id' });
});
it('keeps confirmation after an invalid code for retry but removes it when a new send fails', async () => {
  const adapter = createFirebaseAuthAdapter(config); const confirm = vi.fn().mockRejectedValueOnce({ code: 'auth/invalid-verification-code' }).mockResolvedValueOnce({ user: { uid: 'owner' } });
  send.mockResolvedValue({ confirm }); await adapter.sendOtp('+15551234567');
  await expect(adapter.verifyOtp('000000')).rejects.toMatchObject({ code: 'auth/invalid-verification-code' });
  expect(await adapter.verifyOtp('123456')).toEqual({ uid: 'owner' });
  await adapter.sendOtp('+15551234567'); send.mockRejectedValueOnce(new Error('network'));
  await expect(adapter.sendOtp('+15557654321')).rejects.toThrow();
  await expect(adapter.verifyOtp('123456')).rejects.toMatchObject({ code: 'auth/missing-verification-id' });
});
it('distinguishes wrong code, expired session, throttling and network failure', () => {
  expect(phoneAuthErrorMessage({ code: 'auth/invalid-verification-code' })).toContain("didn't match");
  expect(phoneAuthErrorMessage({ code: 'auth/code-expired' })).toContain('expired');
  expect(phoneAuthErrorMessage({ code: 'auth/network-request-failed' })).toContain('connection');
  expect(phoneAuthErrorMessage({ code: 'auth/too-many-requests' })).toContain('Wait');
  expect(phoneAuthErrorMessage(new Error('unexpected'))).not.toContain("didn't match");
});
