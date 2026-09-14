import { useCallback, useRef, useState } from 'react';
import { api } from '../api/index';
import { errorMessage, type CameraStatus, type Clip, type ClipsResponse } from '../api/types';
import { Button } from '../components/Button';
import { ClipCard } from '../components/ClipCard';
import { StatusDot } from '../components/StatusDot';
import { StripedPanel } from '../components/StripedPanel';
import { useShopTimezone } from '../hooks/useSession';
import { useToast } from '../hooks/useToast';
import { usePolling } from '../hooks/usePolling';
import { dayTitle, dayWord, spanLabel, timeOfDay, todayKey } from '../lib/format';
import { useClipShare } from '../hooks/useClipShare';
import { statusView } from '../lib/status';
import { S_ERROR, S_SCROLL, STRIPES, st } from '../lib/style';
import { R, navigate } from '../router';

const OLDER_ROW = 'display:flex;align-items:center;justify-content:space-between;padding:12px 0 8px;border-top:1px solid rgba(23,22,20,.08);width:100%;background:none;border-left:0;border-right:0;border-bottom:0;text-align:left';

export function Home() {
  const tz = useShopTimezone();
  const sharing = useClipShare();
  const toast = useToast();
  const [date, setDate] = useState<string | undefined>(undefined);
  const [data, setData] = useState<ClipsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<CameraStatus | null>(null);

  const request = useRef(0);
  const pickDate = (day?: string) => { request.current++; setData(null); setError(null); setDate(day); };

  const load = useCallback(async (d?: string) => {
    const version = ++request.current;
    try {
      const result = await api.clips(d);
      if (version !== request.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (version !== request.current) return;
      setError(errorMessage(err, "Couldn't load your clips. Check your connection and try again."));
    }
  }, []);

  usePolling(() => load(date), 30_000, true, date);

  usePolling(async () => { try { setStatus(await api.cameraStatus()); } catch { /* retain last truthful status */ } }, 30_000);

  const now = new Date();
  const view = status ? statusView(status, now) : null;
  const isToday = !date || data?.date === todayKey(tz, now);
  const title = date && !isToday ? dayTitle(date, tz, now) : 'Today';
  const clips = data?.clips ?? [];

  const skip = (clip: Clip) => {
    setData((d) => (d ? { ...d, clips: d.clips.filter((c) => c.id !== clip.id) } : d));
    toast("Skipped.");
    api.clipEvent(clip.id, 'skip').catch(() => undefined);
  };

  const seenAt = status?.last_seen_at ? timeOfDay(status.last_seen_at, tz) : null;
  const recorded = status?.recording_seconds_today !== undefined ? `The camera has recorded ${spanLabel(status.recording_seconds_today * 1000)} so far.` : null;

  return (
    <div style={st(S_SCROLL)}>
      <div style={st('padding:var(--top-list) 20px 12px;display:flex;flex-direction:column;gap:6px')}>
        {!isToday && (
          <Button variant="back" onClick={() => pickDate(undefined)} style={{ alignSelf: 'flex-start' }}>
            Back
          </Button>
        )}
        <div style={st('font-size:28px;font-weight:600;line-height:1.1')}>{title}</div>
        <button onClick={() => navigate(R.camera)} style={st('display:flex;align-items:center;gap:8px;background:none;border:0;padding:0;font-size:15px;color:#6F6B64;text-align:left;min-height:20px')}>
          {view && (
            <>
              <StatusDot color={view.color} size={9} />
              {view.short}
            </>
          )}
        </button>
      </div>

      {error && !data && <div style={{ ...st(S_ERROR), padding: '8px 20px' }}>{error}</div>}

      {data && clips.length === 0 && (
        <div style={st('padding:8px 20px 24px;display:flex;flex-direction:column;gap:14px')}>
          <div style={{ ...st('aspect-ratio:9/12;border-radius:20px;position:relative;display:flex;align-items:flex-end;padding:18px;box-sizing:border-box;overflow:hidden'), background: STRIPES[0] }}>
            {status?.last_thumb_url ? (
              <img src={status.last_thumb_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <StripedPanel stripe={STRIPES[0]} label={`still: what the camera saw${seenAt ? ` at ${seenAt}` : ''}`} labelPadding="0 24px" />
            )}
            {status?.last_seen_at && (
              <div style={st('color:#F2EFE9;font-size:14px;background:rgba(0,0,0,.45);padding:6px 10px;border-radius:8px;position:relative')}>
                Seen {dayWord(status.last_seen_at, tz, now)}, {seenAt}
              </div>
            )}
          </div>
          <div style={st('font-size:20px;font-weight:600')}>No clips yet</div>
          <div style={st('color:#6F6B64;font-size:16px;line-height:1.45;text-wrap:pretty')}>
            {recorded ? `${recorded} ` : ''}Clips appear here after footage is captured and processed. Check Camera for its current status.
          </div>
        </div>
      )}

      {data && clips.length > 0 && (
        <div style={st('padding:8px 20px 24px;display:flex;flex-direction:column;gap:28px')}>
          {clips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} onOpen={() => navigate(R.clip(clip.id))} onShare={() => void sharing.share(clip)} shareLabel={sharing.label(clip.id)} shareDisabled={sharing.busy} onSkip={() => skip(clip)} onMediaError={() => void load(date)} />
          ))}
          <OlderRows older={data.older} tz={tz} now={now} onPick={pickDate} />
        </div>
      )}

      {data && clips.length === 0 && data.older.length > 0 && (
        <div style={st('padding:0 20px 24px;display:flex;flex-direction:column')}>
          <OlderRows older={data.older} tz={tz} now={now} onPick={pickDate} />
        </div>
      )}
    </div>
  );
}

// "Yesterday, 2 clips" rows. Tapping one loads that date.
function OlderRows({ older, tz, now, onPick }: { older: ClipsResponse['older']; tz: string; now: Date; onPick: (date: string) => void }) {
  return (
    <>
      {older.map((o) => (
        <button key={o.date} onClick={() => onPick(o.date)} style={st(OLDER_ROW)}>
          <div style={st('color:#6F6B64;font-size:15px')}>{dayTitle(o.date, tz, now)}</div>
          <div style={st('font-size:15px;font-weight:500')}>
            {o.count} {o.count === 1 ? 'clip' : 'clips'}
          </div>
        </button>
      ))}
    </>
  );
}
