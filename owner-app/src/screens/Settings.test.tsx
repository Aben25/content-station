// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { Settings } from './Settings';
import { SessionProvider, useSessionState } from '../hooks/useSession';
const { api, replace, navigate } = vi.hoisted(() => ({ api: { getSession: vi.fn(), me: vi.fn(), signOut: vi.fn() }, replace: vi.fn(), navigate: vi.fn() }));
vi.mock('../api/index', () => ({ api }));
vi.mock('../router', () => ({ R: { start: '/start', accounts: '/accounts' }, replace, navigate }));
const me = { shop: { name: 'Actual Studio', type: 'barbershop', delivery_hour: 11, hours: null } } as any;
it('shows configured shop facts without inventing settings or enabled services', () => {
  const html = renderToStaticMarkup(<SessionProvider value={{ me } as any}><Settings /></SessionProvider>);
  expect(html).toContain('Actual Studio');
  expect(html).toContain('Download or share clips manually.');
  expect(html).toContain('Recording hours are not set.');
  expect(html).not.toContain('Mon to Sat, 9 to 7');
  expect(html).not.toMatch(/Face blur on|You and 1 staff|Next charge|text and push|Scheduled clip time|P1/);
  expect(html).toContain('Team management is not available yet.');
  expect(html).toContain('Billing details are not available here.');
  expect(html).toContain('Connected accounts');
  expect(html).toContain('Only Connected accounts can be changed here.');
});
it('opens the connected accounts screen from its row', async () => {
  const node = document.createElement('div'); const root = createRoot(node);
  try {
    await act(async () => root.render(<SessionProvider value={{ me } as any}><Settings /></SessionProvider>));
    const row = [...node.querySelectorAll('button')].find(b => b.textContent?.includes('Connected accounts'));
    expect(row).toBeTruthy();
    await act(async () => row!.click());
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/accounts');
  } finally { await act(async () => root.unmount()); }
});
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it('signs out once, clears the session UI and returns to Start after sign out completes', async () => {
  api.getSession.mockResolvedValue({ user_id: 'owner' }); api.me.mockResolvedValue(me);
  let finish!: () => void; api.signOut.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  function Host() { const state = useSessionState(); return <SessionProvider value={state}>{state.status === 'in' ? <Settings /> : <div>Signed out</div>}</SessionProvider>; }
  const node = document.createElement('div'); const root = createRoot(node);
  try {
    await act(async () => root.render(<Host />));
    const button = [...node.querySelectorAll('button')].find(b => b.textContent === 'Sign out');
    expect(button).toBeTruthy();
    await act(async () => { button!.click(); button!.click(); });
    expect(api.signOut).toHaveBeenCalledOnce(); expect(button!.disabled).toBe(true); expect(replace).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(node.textContent).toBe('Signed out'); expect(node.textContent).not.toContain('Actual Studio');
    expect(replace).toHaveBeenCalledExactlyOnceWith('/start');
  } finally { await act(async () => root.unmount()); }
});
