import { describe, expect, it, vi } from 'vitest';
import type { Clip } from '../api/types';
import { downloadClip, shareClip } from './share';

const clip: Clip = {
  id: 'clip/one', caption: 'A clean fade.', duration_s: 8, status: 'new', created_at: '', delivered_at: null,
  video_url: 'https://media.example/video', thumb_url: '', source_seconds: 20,
};

describe('real media actions', () => {
  it('reports a share only after the native share promise succeeds', async () => {
    const fetch = vi.fn(async () => new Response(new Blob(['video']), { status: 200 }));
    const share = vi.fn(async () => undefined);
    expect(await shareClip(clip, { fetch, navigator: { share, canShare: () => true } })).toBe('shared');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: expect.any(Array) }));
  });

  it('does not count opening a fallback as a successful share', async () => {
    const open = vi.fn();
    expect(await shareClip(clip, { navigator: {}, open })).toBe('opened');
    expect(open).toHaveBeenCalledWith(clip.video_url, '_blank', 'noopener,noreferrer');
  });

  it('downloads a fetched blob so cross-origin signed URLs work', async () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const revokeObjectURL = vi.fn();
    const result = await downloadClip(clip, {
      fetch: async () => new Response(new Blob(['video']), { status: 200 }),
      createObjectURL: () => 'blob:clip', revokeObjectURL,
      createAnchor: () => ({ click, href: '', download: '' }),
    });
    expect(result).toBe(true);
    expect(click).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:clip');
    vi.useRealTimers();
  });
});
