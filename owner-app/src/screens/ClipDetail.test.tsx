// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import { ClipDetail } from './ClipDetail';
import { ApiError, type Publication } from '../api/types';
const { api, toast, navigate } = vi.hoisted(() => ({
  api: { clip: vi.fn(), clipEvent: vi.fn(), updateCaption: vi.fn(), publishingAccounts: vi.fn(), clipPublications: vi.fn(), publishClip: vi.fn(), cancelPublication: vi.fn() },
  toast: vi.fn(), navigate: vi.fn(),
}));
vi.mock('../api/index', () => ({ api }));
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }));
vi.mock('../hooks/useSession', () => ({ useShopTimezone: () => 'America/Los_Angeles' }));
vi.mock('../hooks/useClipShare', () => ({ useClipShare: () => ({ share: vi.fn(), label: () => 'Share', busy: false }) }));
vi.mock('../lib/share', () => ({ downloadClip: vi.fn() }));
vi.mock('../router', () => ({ R: { home: '/home', accounts: '/accounts', clip: (id: string) => `/clips/${id}` }, navigate, replace: vi.fn() }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const clip = { id: 'clip-1', caption: 'Full detail, start to finish.', duration_s: 12, status: 'new', created_at: '2026-09-15T17:00:00.000Z', delivered_at: null, video_url: '', thumb_url: '', source_seconds: 40 };
const fb = { id: 'acct-fb', provider: 'facebook', provider_label: 'Facebook Page', name: 'Fade Society', profile: null, picture: null, disabled: false };
const ig = { id: 'acct-ig', provider: 'instagram', provider_label: 'Instagram', name: '@fadesociety', profile: null, picture: null, disabled: false };
const overview = (accounts: any[]) => ({ configured: true, providers: [{ id: 'facebook', label: 'Facebook Page' }, { id: 'instagram', label: 'Instagram' }], accounts });
const publication = (patch: Partial<Publication> = {}): Publication => ({
  id: 'pub-1', clip_id: 'clip-1', kind: 'now', scheduled_at: '2026-09-15T17:00:30.000Z', requested_at: null, timezone: 'America/Los_Angeles', caption: clip.caption,
  state: 'queued', late: false, cancel_requested: false, last_error: null, created_at: '2026-09-15T17:00:00.000Z', updated_at: '2026-09-15T17:00:00.000Z',
  channels: [{ account_id: 'acct-fb', provider: 'facebook', provider_label: 'Facebook Page', name: 'Fade Society', state: 'queued', live_url: null, error: null, updated_at: '2026-09-15T17:00:00.000Z' }],
  ...patch,
});
const mount = async () => {
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  await act(async () => root.render(<ClipDetail id="clip-1" />));
  return { node, unmount: async () => { await act(async () => root.unmount()); node.remove(); } };
};
const button = (node: HTMLElement, text: string) => [...node.querySelectorAll('button')].find((b) => b.textContent === text);
beforeEach(() => {
  vi.resetAllMocks();
  api.clip.mockResolvedValue(clip); api.clipEvent.mockResolvedValue(clip); api.clipPublications.mockResolvedValue([]);
});

it('hides publishing when the server has none and points to accounts when none is connected', async () => {
  api.publishingAccounts.mockResolvedValue({ configured: false, providers: [], accounts: [] });
  let mounted = await mount();
  try {
    expect((mounted.node.querySelector('input[aria-label="Caption"]') as HTMLInputElement).value).toBe('Full detail, start to finish.');
    expect(button(mounted.node, 'Publish')).toBeUndefined();
    expect(button(mounted.node, 'Connect an account to publish')).toBeUndefined();
  } finally { await mounted.unmount(); }
  api.publishingAccounts.mockResolvedValue(overview([]));
  mounted = await mount();
  try {
    await act(async () => button(mounted.node, 'Connect an account to publish')!.click());
    expect(navigate).toHaveBeenCalledWith('/accounts');
  } finally { await mounted.unmount(); }
});

it('reviews the saved caption and publishes once for repeated taps with one request key', async () => {
  api.publishingAccounts.mockResolvedValue(overview([fb]));
  let finish!: (v: unknown) => void; api.publishClip.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { node, unmount } = await mount();
  try {
    await act(async () => button(node, 'Publish')!.click());
    expect(node.textContent).toContain('Publish this clip');
    expect(node.textContent).toContain('Posted with the caption you saved');
    const pill = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Facebook Page: Fade Society')!;
    expect(pill.getAttribute('aria-pressed')).toBe('true');
    const go = button(node, 'Publish now')!;
    await act(async () => { go.click(); go.click(); });
    expect(api.publishClip).toHaveBeenCalledOnce();
    const [id, input] = api.publishClip.mock.calls[0];
    expect(id).toBe('clip-1');
    expect(input).toMatchObject({ account_ids: ['acct-fb'], schedule_at: null });
    expect(typeof input.idempotency_key).toBe('string');
    expect(button(node, 'Sending…')!.disabled).toBe(true);
    await act(async () => finish(publication()));
    expect(node.textContent).not.toContain('Publish this clip');
    expect(node.textContent).toContain('Publishing');
    expect(node.textContent).toContain('Facebook Page: Fade Society');
    expect(toast).toHaveBeenCalledWith('Publishing now.');
  } finally { await unmount(); }
});

it('schedules in shop time and can cancel while queued', async () => {
  api.publishingAccounts.mockResolvedValue(overview([fb]));
  api.publishClip.mockResolvedValue(publication({ id: 'pub-2', kind: 'schedule', scheduled_at: '2026-09-16T16:30:17.000Z', requested_at: '2026-09-16T16:30:00.000Z' }));
  api.cancelPublication.mockResolvedValue(publication({ id: 'pub-2', kind: 'schedule', state: 'cancelled', channels: [{ account_id: 'acct-fb', provider: 'facebook', provider_label: 'Facebook Page', name: 'Fade Society', state: 'cancelled', live_url: null, error: null, updated_at: '' }] }));
  const { node, unmount } = await mount();
  try {
    await act(async () => button(node, 'Publish')!.click());
    await act(async () => button(node, 'Pick a time')!.click());
    const input = node.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    await act(async () => Simulate.change(input, { target: { value: '2026-09-16T09:30' } } as any));
    expect(node.textContent).toContain('Shop time (America/Los_Angeles)');
    await act(async () => button(node, 'Schedule')!.click());
    expect(api.publishClip.mock.calls[0][1]).toMatchObject({ account_ids: ['acct-fb'], schedule_at: '2026-09-16T16:30:00.000Z' });
    expect(node.textContent).toContain('Scheduled');
    expect(node.textContent).toContain('9:30 AM');
    await act(async () => button(node, 'Cancel')!.click());
    expect(api.cancelPublication).toHaveBeenCalledExactlyOnceWith('pub-2');
    expect(node.textContent).toContain('Cancelled');
    expect(button(node, 'Cancel')).toBeUndefined();
  } finally { await unmount(); }
});

it('keeps disabled accounts unselectable and shows a rejected publish without closing', async () => {
  api.publishingAccounts.mockResolvedValue(overview([{ ...fb, disabled: true }, ig]));
  api.publishClip.mockRejectedValue(new ApiError('account_disabled', 'Fade Society needs to be reconnected first.', 409));
  const { node, unmount } = await mount();
  try {
    await act(async () => button(node, 'Publish')!.click());
    const disabled = [...node.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Facebook Page: Fade Society'))!;
    expect(disabled.disabled).toBe(true);
    // The only usable account is preselected; deselecting it disables the action.
    const igPill = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Instagram: @fadesociety')!;
    expect(igPill.getAttribute('aria-pressed')).toBe('true');
    await act(async () => igPill.click());
    expect(button(node, 'Publish now')!.disabled).toBe(true);
    await act(async () => igPill.click());
    await act(async () => button(node, 'Publish now')!.click());
    expect(api.publishClip.mock.calls[0][1]).toMatchObject({ account_ids: ['acct-ig'] });
    expect(node.textContent).toContain('needs to be reconnected first');
    expect(node.textContent).toContain('Publish this clip');
  } finally { await unmount(); }
});

it('shows live links, failures and delete consequences from the publication record', async () => {
  api.publishingAccounts.mockResolvedValue(overview([fb, ig]));
  api.clipPublications.mockResolvedValue([publication({
    state: 'partial',
    channels: [
      { account_id: 'acct-fb', provider: 'facebook', provider_label: 'Facebook Page', name: 'Fade Society', state: 'published', live_url: 'https://www.facebook.com/reel/1', error: null, updated_at: '' },
      { account_id: 'acct-ig', provider: 'instagram', provider_label: 'Instagram', name: '@fadesociety', state: 'failed', live_url: null, error: 'The platform did not accept this post.', updated_at: '' },
    ],
  })]);
  const { node, unmount } = await mount();
  try {
    expect(node.textContent).toContain('Partly published');
    expect(node.querySelector('a[href="https://www.facebook.com/reel/1"]')?.textContent).toBe('View post');
    expect(node.textContent).toContain('Failed. The platform did not accept this post.');
    expect(button(node, 'Cancel')).toBeUndefined();
    await act(async () => button(node, 'Delete')!.click());
    expect(node.textContent).toContain('Posts already published stay on your accounts.');
  } finally { await unmount(); }
});
