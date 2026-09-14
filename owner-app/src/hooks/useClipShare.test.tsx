// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useClipShare } from './useClipShare';
const { refresh, event, toast, prepare, nativeShare } = vi.hoisted(() => ({ refresh: vi.fn(), event: vi.fn(async () => {}), toast: vi.fn(), prepare: vi.fn(), nativeShare: vi.fn() }));
vi.mock('../api/index', () => ({ api: { clip: refresh, clipEvent: event } }));
vi.mock('./useToast', () => ({ useToast: () => toast }));
vi.mock('../lib/share', () => ({ prepareClipShare: prepare, shareClip: nativeShare }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it('requires a second gesture after preparation and records only successful native shares', async () => {
  const clip = { id: 'one', caption: 'Caption' } as any;
  let finish!: (value: any) => void;
  prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  nativeShare.mockResolvedValueOnce('cancelled').mockRejectedValueOnce(new Error('Share denied')).mockResolvedValueOnce('shared');
  const node = document.createElement('div'); const root = createRoot(node);
  function Screen() { const sharing = useClipShare(); return <button disabled={sharing.busy} onClick={() => void sharing.share(clip)}>{sharing.label(clip.id)}</button>; }
  const click = () => act(async () => node.querySelector('button')!.click());
  try {
    await act(async () => root.render(<Screen />));
    expect(node.textContent).toBe('Share');
    await click(); expect(node.textContent).toBe('Preparing…'); expect(nativeShare).not.toHaveBeenCalled();
    const staged = { clip, file: {} };
    await act(async () => finish(staged));
    expect(node.textContent).toBe('Share now'); expect(nativeShare).not.toHaveBeenCalled();
    await click(); expect(nativeShare).toHaveBeenCalledOnce(); expect(event).not.toHaveBeenCalled();
    prepare.mockResolvedValue(staged);
    await click(); await click(); expect(toast).toHaveBeenCalledWith('Share denied'); expect(event).not.toHaveBeenCalled();
    await click(); await click(); expect(event).toHaveBeenCalledExactlyOnceWith('one', 'share');
  } finally { await act(async () => root.unmount()); }
});
