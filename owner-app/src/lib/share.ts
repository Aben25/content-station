import type { Clip } from '../api/types';

export type ShareResult = 'shared' | 'opened' | 'cancelled' | 'unavailable';

type NavigatorShare = { share?: (data?: ShareData) => Promise<void>; canShare?: (data?: ShareData) => boolean };
interface ShareDeps { file?: File; navigator?: NavigatorShare; open?: (url?: string | URL, target?: string, features?: string) => unknown; }
interface DownloadDeps { fetch?: typeof fetch; createObjectURL?: (blob: Blob) => string; revokeObjectURL?: (url: string) => void; createAnchor?: () => Pick<HTMLAnchorElement, 'href' | 'download' | 'click'>; }

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

function fileName(clip: Clip): string {
  return `clip-${clip.id.replace(/[^a-z0-9_-]/gi, '-')}.mp4`;
}

export interface PreparedShare { clip: Clip; file: File; }

// Refresh the capability and stage at most 128 MiB before asking for a fresh gesture.
export async function prepareClipShare(clip: Clip, deps: { refresh: (id: string) => Promise<Clip>; fetch?: typeof fetch }): Promise<PreparedShare> {
  const fresh = await deps.refresh(clip.id);
  if (!fresh.video_url) throw new Error('This clip has no video to share.');
  const response = await (deps.fetch ?? fetch)(fresh.video_url);
  if (!response.ok || !response.body) throw new Error("Couldn't prepare this clip. Try again.");
  const limit = 128 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body.cancel();
    throw new Error('This clip is too large to prepare for sharing.');
  }
  const reader = response.body.getReader();
  const parts: ArrayBuffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('This clip is too large to prepare for sharing.'); }
      parts.push(value.slice().buffer);
    }
  } finally { reader.releaseLock(); }
  return { clip: fresh, file: new File(parts, fileName(fresh), { type: 'video/mp4' }) };
}

// Called directly by the final click. No network request or await precedes native sharing.
export async function shareClip(clip: Clip, deps: ShareDeps = {}): Promise<ShareResult> {
  const url = clip.video_url;
  if (!url) return 'unavailable';
  const nav = deps.navigator ?? navigator;
  if (typeof nav.share === 'function') {
    const data = deps.file && nav.canShare?.({ files: [deps.file] })
      ? { files: [deps.file], text: clip.caption }
      : { url, text: clip.caption };
    try {
      await nav.share(data);
      return 'shared';
    } catch (e) {
      if (isAbort(e)) return 'cancelled';
      throw e;
    }
  }
  const opened = (deps.open ?? window.open)(url, '_blank', 'noopener,noreferrer');
  return opened === null ? 'unavailable' : 'opened';
}

// Anchor with the download attribute on the signed URL.
export async function downloadClip(clip: Clip, deps: DownloadDeps = {}): Promise<boolean> {
  if (!clip.video_url) return false;
  const response = await (deps.fetch ?? fetch)(clip.video_url);
  if (!response.ok) return false;
  const createUrl = deps.createObjectURL ?? URL.createObjectURL.bind(URL);
  const revokeUrl = deps.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);
  const objectUrl = createUrl(await response.blob());
  const a = deps.createAnchor?.() ?? document.createElement('a');
  a.href = objectUrl;
  a.download = fileName(clip);
  a.click();
  setTimeout(() => revokeUrl(objectUrl), 1_000);
  return true;
}
