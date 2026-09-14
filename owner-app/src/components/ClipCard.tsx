import { useEffect, useRef } from 'react';
import type { Clip } from '../api/types';
import { fmtDuration } from '../lib/format';
import { st, stripeFor } from '../lib/style';
import { StripedPanel } from './StripedPanel';
import { Button } from './Button';

interface Props {
  clip: Clip;
  onOpen: () => void;
  onShare: () => void;
  shareLabel?: string;
  shareDisabled?: boolean;
  onSkip: () => void;
  onMediaError?: () => void;
}

export function placeholderLabel(clip: Clip): string {
  return clip.footage ?? `footage: ${clip.caption.replace(/\.$/, '').toLowerCase()}`;
}

// 9:16 card. The video plays while at least 60% of it is on screen and pauses otherwise.
export function ClipCard({ clip, onOpen, onShare, onSkip, onMediaError, shareLabel = 'Share', shareDisabled }: Props) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = video.current;
    if (!v || !clip.video_url || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e) return;
        if (e.isIntersecting && e.intersectionRatio >= 0.6) v.play().catch(() => undefined);
        else v.pause();
      },
      { threshold: [0, 0.6, 1] },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [clip.video_url]);

  return (
    <div style={st('display:flex;flex-direction:column;gap:12px')}>
      <button
        onClick={onOpen}
        aria-label={clip.caption}
        style={{ ...st('position:relative;padding:0;border:0;aspect-ratio:9/16;border-radius:20px;overflow:hidden;text-align:left;display:block;width:100%'), background: stripeFor(clip.id) }}
      >
        {clip.video_url ? (
          <video
            ref={video}
            src={clip.video_url}
            poster={clip.thumb_url || undefined}
            playsInline
            muted
            loop
            preload="metadata"
            onError={onMediaError}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <StripedPanel stripe={stripeFor(clip.id)} label={placeholderLabel(clip)} />
        )}
        <div style={st('position:absolute;left:14px;bottom:14px;padding:5px 9px;border-radius:8px;background:rgba(0,0,0,.55);color:#F2EFE9;font-size:13px;font-weight:500;font-variant-numeric:tabular-nums')}>
          {fmtDuration(clip.duration_s)}
        </div>
        <div style={st('position:absolute;right:14px;bottom:14px;width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center')}>
          <div style={st('width:0;height:0;border-left:12px solid #F2EFE9;border-top:7px solid transparent;border-bottom:7px solid transparent;margin-left:3px')} />
        </div>
      </button>
      <div style={st('font-size:16px;line-height:1.35;color:#171614')}>{clip.caption}</div>
      <div style={st('display:flex;gap:10px')}>
        <Button variant="secondaryFilled" onClick={onShare} disabled={shareDisabled} style={{ flex: 1 }}>
          {shareLabel}
        </Button>
        <Button variant="secondary" onClick={onSkip} style={{ flex: 1 }}>
          Skip
        </Button>
      </div>
    </div>
  );
}
