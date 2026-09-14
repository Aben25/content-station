// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import { Code } from './Code';
const { send, verify, refresh } = vi.hoisted(() => ({ send: vi.fn(), verify: vi.fn(), refresh: vi.fn() }));
vi.mock('../api/index', () => ({ api: { sendOtp: send, verifyOtp: verify } }));
vi.mock('../hooks/useSession', () => ({ useSession: () => ({ refresh }) }));
vi.mock('../hooks/useToast', () => ({ useToast: () => vi.fn() }));
vi.mock('../lib/state', () => ({ getPendingPhone: () => '+15551234567' }));
vi.mock('../router', () => ({ R: { start: '/', home: '/home' }, navigate: vi.fn(), replace: vi.fn(), stepRoute: vi.fn() }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => vi.resetAllMocks());
it('blocks repeated resend clicks and code submission while a send is pending', async () => {
  let finish!: () => void; send.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const node = document.createElement('div'); const root = createRoot(node);
  try {
    await act(async () => root.render(<Code />));
    const resend = [...node.querySelectorAll('button')].find(b => b.textContent === 'Text it again')!;
    await act(async () => { resend.click(); resend.click(); });
    expect(send).toHaveBeenCalledOnce(); expect(resend.disabled).toBe(true);
    expect(node.querySelector('input')!.disabled).toBe(true);
    expect(verify).not.toHaveBeenCalled();
    await act(async () => finish()); expect(resend.disabled).toBe(false);
  } finally { await act(async () => root.unmount()); }
});
it('shows network failure rather than claiming the entered code mismatched', async () => {
  verify.mockRejectedValue({ code: 'auth/network-request-failed' });
  const node = document.createElement('div'); const root = createRoot(node);
  try {
    await act(async () => root.render(<Code />));
    await act(async () => Simulate.change(node.querySelector('input')!, { target: { value: '123456' } } as any));
    expect(verify).toHaveBeenCalledExactlyOnceWith('+15551234567', '123456');
    expect(node.textContent).toContain('Check your connection');
    expect(node.textContent).not.toContain("didn't match");
  } finally { await act(async () => root.unmount()); }
});
