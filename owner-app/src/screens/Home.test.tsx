// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Home } from './Home';
const { clips } = vi.hoisted(() => ({ clips: vi.fn() }));
vi.mock('../api/index', () => ({ api: { clips, cameraStatus: async () => ({}) } }));
vi.mock('../hooks/useSession', () => ({ useShopTimezone: () => 'UTC' }));
vi.mock('../hooks/useToast', () => ({ useToast: () => vi.fn() }));
vi.mock('../lib/status', () => ({ statusView: () => null, deliveryLabel: () => 'later' }));
vi.mock('../components/ClipCard', () => ({ ClipCard: ({ clip }: any) => <div>{clip.caption}</div> }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it('requests older day and Back immediately and ignores superseded responses', async () => {
  const response = (date: string, caption: string) => ({ date, clips: [{ id: caption, caption }], older: [{ date: '2020-01-01', count: 1 }] });
  let resolveOld!: (data: unknown) => void;
  clips.mockResolvedValueOnce(response('2026-09-14', 'current clips')).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(response('2026-09-14', 'fresh today'));
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  try {
    await act(async () => root.render(<Home />));
    const click = async (text: string) => act(async () => { const b = [...node.querySelectorAll('button')].find(b => b.textContent?.includes(text)); expect(b).toBeTruthy(); b!.click(); });
    await click('1 clip');
    expect(clips).toHaveBeenLastCalledWith('2020-01-01');
    expect(node.textContent).not.toContain('current clips');
    await click('Back');
    expect(clips).toHaveBeenLastCalledWith(undefined);
    expect(node.textContent).toContain('fresh today');
    await act(async () => resolveOld(response('2020-01-01', 'stale older clips')));
    expect(node.textContent).toContain('fresh today');
    expect(node.textContent).not.toContain('stale older clips');
  } finally { await act(async () => root.unmount()); node.remove(); }
});
