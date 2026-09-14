import { useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { api } from '../api/index';
import { errorMessage, type Clip } from '../api/types';
import { Button } from '../components/Button';
import { placeholderLabel } from '../components/ClipCard';
import { Sheet } from '../components/Sheet';
import { StripedPanel } from '../components/StripedPanel';
import { useToast } from '../hooks/useToast';
import { fmtDuration } from '../lib/format';
import { downloadClip, shareClip } from '../lib/share';
import { st, stripeFor } from '../lib/style';
import { R, navigate, replace } from '../router';

const REASONS: { label: string; code: string }[] = [
  { label: 'Wrong moment', code: 'wrong_moment' },
  { label: 'Bad crop', code: 'bad_crop' },
  { label: "Shouldn't have been filmed", code: 'should_not_have_been_filmed' },
];

export function ClipDetail({ id }: { id: string }) {
  const toast = useToast();
  const [clip, setClip] = useState<Clip | null>(null);
  const [caption, setCaption] = useState('');
  const [sheet, setSheet] = useState<'delete' | 'report' | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const refreshedMediaUrl = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .clip(id)
      .then((c) => {
        if (!live) return;
        setClip(c);
        setCaption(c.caption);
        api.clipEvent(id, 'open').catch(() => undefined);
      })
      .catch((err) => {
        if (!live) return;
        toast(errorMessage(err, 'That clip is gone.'));
        replace(R.home);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const url = clip?.video_url ?? '';
  useEffect(() => {
    const v = video.current;
    if (!v || !url) return;
    v.play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }, [url]);

  const toggle = () => {
    const v = video.current;
    if (!v || !url) return;
    if (v.paused) v.play().catch(() => undefined);
    else v.pause();
  };

  const onTime = (e: SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (v.duration > 0) setProgress(Math.min(100, (v.currentTime / v.duration) * 100));
  };

  const refreshMedia = async () => {
    if (!clip?.video_url || refreshedMediaUrl.current === clip.video_url) return;
    refreshedMediaUrl.current = clip.video_url;
    try { setClip(await api.clip(clip.id)); }
    catch (err) { toast(errorMessage(err, "Couldn't refresh this clip. Try again.")); }
  };

  const saveCaption = async () => {
    if (!clip) return;
    const next = caption.trim();
    if (!next || next === clip.caption) {
      setCaption(clip.caption);
      return;
    }
    try {
      const updated = await api.updateCaption(clip.id, next);
      setClip(updated);
      setCaption(updated.caption);
      toast('Caption saved.');
    } catch (err) {
      toast(errorMessage(err, "Couldn't save the caption. Try again."));
    }
  };

  const onCaptionKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  const share = async () => {
    if (!clip) return;
    const result = await shareClip(clip);
    if (result === 'unavailable') toast('Share sheet opens: Instagram, TikTok, Save');
    if (result === 'shared') api.clipEvent(clip.id, 'share').catch(() => undefined);
  };

  const download = async () => {
    if (!clip) return;
    try { if (!(await downloadClip(clip))) toast("Couldn't download the clip. Try again."); }
    catch (err) { toast(errorMessage(err, "Couldn't download the clip. Try again.")); }
  };

  const skip = async () => {
    if (!clip || busy) return;
    setBusy(true);
    await api.clipEvent(clip.id, 'skip').catch(() => undefined);
    navigate(R.home);
    toast("Skipped. We'll show fewer like this.");
  };

  const confirmDelete = async () => {
    if (!clip || busy) return;
    setBusy(true);
    try {
      await api.deleteClip(clip.id);
      setSheet(null);
      navigate(R.home);
      toast('Deleted. Clip and footage are gone.');
    } catch (err) {
      setBusy(false);
      toast(errorMessage(err, "Couldn't delete the clip. Try again."));
    }
  };

  const report = async (code: string) => {
    if (!clip || busy) return;
    setBusy(true);
    await api.clipEvent(clip.id, 'report', code).catch(() => undefined);
    setSheet(null);
    navigate(R.home);
    toast("Thanks. We'll take a look.");
  };

  const stripe = clip ? stripeFor(clip.id) : undefined;

  return (
    <div style={st('flex:1;display:flex;flex-direction:column;background:#0E0D0C;color:#F2EFE9')}>
      <div onClick={toggle} style={{ ...st('position:relative;flex:1;overflow:hidden'), background: stripe }}>
        {clip &&
          (url ? (
            <video
              ref={video}
              src={url}
              poster={clip.thumb_url || undefined}
              playsInline
              loop
              preload="auto"
              onTimeUpdate={onTime}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => void refreshMedia()}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <StripedPanel stripe={stripe} label={`${placeholderLabel(clip)}, playing with sound on`} />
          ))}
        {url && !playing && (
          <div style={st('position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;pointer-events:none')}>
            <div style={st('width:0;height:0;border-left:20px solid #F2EFE9;border-top:12px solid transparent;border-bottom:12px solid transparent;margin-left:5px')} />
          </div>
        )}
        <div style={st('position:absolute;top:var(--top-list);left:20px;right:20px;display:flex;justify-content:space-between;align-items:center')}>
          <Button
            variant="backDark"
            onClick={(e) => {
              e.stopPropagation();
              navigate(R.home);
            }}
            style={{ background: 'rgba(255,255,255,.14)' }}
          >
            Back
          </Button>
          <div style={st('font-size:13px;color:rgba(242,239,233,.7);font-variant-numeric:tabular-nums')}>{clip ? fmtDuration(clip.duration_s) : ''}</div>
        </div>
        <div style={st('position:absolute;left:20px;right:20px;bottom:16px;height:3px;border-radius:2px;background:rgba(255,255,255,.25)')}>
          <div style={{ width: `${url ? progress : 38}%`, height: '100%', borderRadius: 2, background: '#E08A2E' }} />
        </div>
      </div>
      <div style={st('padding:16px 20px var(--bottom-dark);display:flex;flex-direction:column;gap:14px;background:#0E0D0C;flex:none')}>
        <div style={st('display:flex;flex-direction:column;gap:6px')}>
          <div style={st('font-size:12px;color:rgba(242,239,233,.55);font-weight:500;letter-spacing:.04em')}>CAPTION, TAP TO EDIT</div>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={() => void saveCaption()}
            onKeyDown={onCaptionKey}
            enterKeyHint="done"
            aria-label="Caption"
            style={st('height:48px;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:0 14px;background:rgba(255,255,255,.06);color:#F2EFE9;font:400 16px Outfit,system-ui,sans-serif;width:100%')}
          />
        </div>
        <Button variant="primaryAmber" onClick={() => void share()}>
          Share
        </Button>
        <div style={st('display:flex;gap:8px')}>
          <Button variant="ghostDark" onClick={() => void download()}>
            Download
          </Button>
          <Button variant="ghostDark" onClick={() => void skip()}>
            Skip
          </Button>
          <Button variant="ghostDark" onClick={() => setSheet('delete')}>
            Delete
          </Button>
          <Button variant="ghostDark" onClick={() => setSheet('report')}>
            Report
          </Button>
        </div>
      </div>

      {sheet === 'delete' && (
        <Sheet onClose={() => setSheet(null)}>
          <div style={st('display:flex;flex-direction:column;gap:6px')}>
            <div style={st('font-size:22px;font-weight:600')}>Delete forever?</div>
            <div style={st('font-size:15px;color:#3F3C37;line-height:1.45')}>
              This removes the clip and the {clip?.source_seconds ?? 0} seconds of footage it came from. It can't be recovered.
            </div>
          </div>
          <Button variant="danger" onClick={() => void confirmDelete()} disabled={busy}>
            Delete clip and footage
          </Button>
          <Button variant="cancel" onClick={() => setSheet(null)}>
            Keep it
          </Button>
        </Sheet>
      )}

      {sheet === 'report' && (
        <Sheet onClose={() => setSheet(null)} gap={10}>
          <div style={st('font-size:22px;font-weight:600;margin-bottom:4px')}>What's wrong with it?</div>
          {REASONS.map((r) => (
            <Button key={r.code} variant="report" onClick={() => void report(r.code)} disabled={busy}>
              {r.label}
            </Button>
          ))}
          <Button variant="cancel" onClick={() => setSheet(null)}>
            Cancel
          </Button>
        </Sheet>
      )}
    </div>
  );
}
