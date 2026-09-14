import type { Clip } from '../api/types';

export type ShareResult = 'shared' | 'opened' | 'cancelled' | 'unavailable';

type NavigatorShare = { share?: (data?: ShareData) => Promise<void>; canShare?: (data?: ShareData) => boolean };
interface ShareDeps { fetch?: typeof fetch; navigator?: NavigatorShare; open?: (url?: string | URL, target?: string, features?: string) => unknown; }
interface DownloadDeps { fetch?: typeof fetch; createObjectURL?: (blob: Blob) => string; revokeObjectURL?: (url: string) => void; createAnchor?: () => Pick<HTMLAnchorElement, 'href' | 'download' | 'click'>; }

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

function fileName(clip: Clip): string {
  return `clip-${clip.id.replace(/[^a-z0-9_-]/gi, '-')}.mp4`;
}

// navigator.share with the clip file when the browser can share files,
// otherwise share the signed URL, otherwise open it.
export async function shareClip(clip: Clip, deps: ShareDeps = {}): Promise<ShareResult> {
  const url = clip.video_url;
  if (!url) return 'unavailable';
  const nav = deps.navigator ?? navigator;
  if (typeof nav.share === 'function') {
    if (typeof nav.canShare === 'function') {
      try {
        const res = await (deps.fetch ?? fetch)(url);
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], fileName(clip), { type: blob.type || 'video/mp4' });
          if (nav.canShare({ files: [file] })) {
            await nav.share({ files: [file], text: clip.caption });
            return 'shared';
          }
        }
      } catch (e) {
        if (isAbort(e)) return 'cancelled';
      }
    }
    try {
      await nav.share({ url, text: clip.caption });
      return 'shared';
    } catch (e) {
      if (isAbort(e)) return 'cancelled';
    }
  }
  (deps.open ?? window.open)(url, '_blank', 'noopener,noreferrer');
  return 'opened';
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
