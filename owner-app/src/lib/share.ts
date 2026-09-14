import type { Clip } from '../api/types';

export type ShareResult = 'shared' | 'opened' | 'cancelled' | 'unavailable';

type NavigatorShare = Navigator & { canShare?: (data: ShareData) => boolean };

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

function fileName(clip: Clip): string {
  return `clip-${clip.id}.mp4`;
}

// navigator.share with the clip file when the browser can share files,
// otherwise share the signed URL, otherwise open it.
export async function shareClip(clip: Clip): Promise<ShareResult> {
  const url = clip.video_url;
  if (!url) return 'unavailable';
  const nav = navigator as NavigatorShare;
  if (typeof nav.share === 'function') {
    if (typeof nav.canShare === 'function') {
      try {
        const res = await fetch(url);
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
  window.open(url, '_blank', 'noopener');
  return 'opened';
}

// Anchor with the download attribute on the signed URL.
export function downloadClip(clip: Clip): boolean {
  if (!clip.video_url) return false;
  const a = document.createElement('a');
  a.href = clip.video_url;
  a.download = fileName(clip);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}
