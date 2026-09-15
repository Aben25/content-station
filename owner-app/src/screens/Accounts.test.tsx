// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { Accounts } from './Accounts';
const { api, toast, openExternal, replace, navigate } = vi.hoisted(() => ({
  api: { publishingAccounts: vi.fn(), connectAccount: vi.fn(), reconnectAccount: vi.fn(), disconnectAccount: vi.fn() },
  toast: vi.fn(), openExternal: vi.fn(), replace: vi.fn(), navigate: vi.fn(),
}));
vi.mock('../api/index', () => ({ api }));
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }));
vi.mock('../lib/navigation', () => ({ openExternal }));
vi.mock('../router', async (original) => ({ ...(await original<typeof import('../router')>()), replace, navigate }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const fb = { id: 'acct-fb', provider: 'facebook', provider_label: 'Facebook Page', name: 'Fade Society', profile: null, picture: null, disabled: false };
const configured = (accounts: any[] = []) => ({ configured: true, providers: [{ id: 'facebook', label: 'Facebook Page' }, { id: 'instagram', label: 'Instagram' }], accounts });
const mount = async () => {
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  await act(async () => root.render(<Accounts />));
  return { node, unmount: async () => { await act(async () => root.unmount()); node.remove(); } };
};
const button = (node: HTMLElement, text: string) => [...node.querySelectorAll('button')].find((b) => b.textContent === text);
beforeEach(() => { vi.resetAllMocks(); location.hash = '#/accounts'; });

it('tells the owner when the server has no publishing service', async () => {
  api.publishingAccounts.mockResolvedValue({ configured: false, providers: [], accounts: [] });
  const { node, unmount } = await mount();
  try {
    expect(node.textContent).toContain('Publishing is not set up yet');
    expect([...node.querySelectorAll('button')].some((b) => b.textContent?.startsWith('Connect'))).toBe(false);
  } finally { await unmount(); }
});

it('starts one connection per tap, then leaves for the platform login', async () => {
  api.publishingAccounts.mockResolvedValue(configured());
  let finish!: (v: unknown) => void; api.connectAccount.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { node, unmount } = await mount();
  try {
    expect(node.textContent).toContain('No account is connected');
    const connect = button(node, 'Connect Facebook Page')!;
    await act(async () => { connect.click(); connect.click(); });
    expect(api.connectAccount).toHaveBeenCalledExactlyOnceWith('facebook');
    expect(connect.disabled).toBe(true);
    expect(connect.textContent).toBe('Opening…');
    expect(button(node, 'Connect Instagram')!.disabled).toBe(true);
    await act(async () => finish({ url: 'https://platform.example/oauth?state=abc', provider: 'facebook' }));
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://platform.example/oauth?state=abc');
  } finally { await unmount(); }
});

it('keeps the screen usable when the connection cannot start', async () => {
  api.publishingAccounts.mockResolvedValue(configured());
  api.connectAccount.mockRejectedValue(new Error('Publishing is temporarily unavailable. Try again shortly.'));
  const { node, unmount } = await mount();
  try {
    await act(async () => button(node, 'Connect Instagram')!.click());
    expect(node.textContent).toContain('temporarily unavailable');
    expect(button(node, 'Connect Instagram')!.disabled).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  } finally { await unmount(); }
});

it('confirms and refreshes after returning from the platform', async () => {
  location.hash = '#/accounts?added=facebook&msg=Channel%20Added';
  api.publishingAccounts.mockResolvedValue(configured([fb]));
  const { node, unmount } = await mount();
  try {
    expect(toast).toHaveBeenCalledWith('Account connected.');
    expect(replace).toHaveBeenCalledWith('/accounts');
    expect(api.publishingAccounts.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(node.textContent).toContain('Fade Society');
  } finally { await unmount(); }
});

it('recovers when the platform returns within the same document', async () => {
  api.publishingAccounts.mockResolvedValueOnce(configured()).mockResolvedValue(configured([fb]));
  api.connectAccount.mockResolvedValue({ url: 'http://localhost/#/accounts?added=facebook', provider: 'facebook' });
  const { node, unmount } = await mount();
  try {
    await act(async () => button(node, 'Connect Facebook Page')!.click());
    expect(button(node, 'Opening…')!.disabled).toBe(true);
    location.hash = '#/accounts?added=facebook';
    await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(toast).toHaveBeenCalledWith('Account connected.');
    expect(button(node, 'Connect Facebook Page')!.disabled).toBe(false);
    expect(node.textContent).toContain('Fade Society');
  } finally { await unmount(); }
});

it('removes an account only after confirmation and explains what happens to posts', async () => {
  api.publishingAccounts.mockResolvedValueOnce(configured([fb])).mockResolvedValue(configured([]));
  api.disconnectAccount.mockResolvedValue(undefined);
  const { node, unmount } = await mount();
  try {
    await act(async () => button(node, 'Remove')!.click());
    expect(api.disconnectAccount).not.toHaveBeenCalled();
    expect(node.textContent).toContain('Remove Fade Society?');
    expect(node.textContent).toContain('Scheduled posts to this account are cancelled');
    await act(async () => button(node, 'Remove account')!.click());
    expect(api.disconnectAccount).toHaveBeenCalledExactlyOnceWith('acct-fb');
    expect(node.textContent).toContain('No account is connected');
    expect(toast).toHaveBeenCalledWith('Account removed. Scheduled posts to it were cancelled.');
  } finally { await unmount(); }
});

it('offers reconnecting for an account whose authorization expired', async () => {
  api.publishingAccounts.mockResolvedValue(configured([{ ...fb, disabled: true }]));
  api.reconnectAccount.mockResolvedValue({ url: 'https://platform.example/oauth?state=again', provider: 'facebook' });
  const { node, unmount } = await mount();
  try {
    expect(node.textContent).toContain('Needs reconnecting');
    await act(async () => button(node, 'Reconnect')!.click());
    expect(api.reconnectAccount).toHaveBeenCalledExactlyOnceWith('acct-fb', 'facebook');
    expect(openExternal).toHaveBeenCalledWith('https://platform.example/oauth?state=again');
  } finally { await unmount(); }
});
