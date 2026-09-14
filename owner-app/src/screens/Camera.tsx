import { useState } from 'react';
import { api } from '../api/index';
import { errorMessage, type CameraStatus, type PauseUntil } from '../api/types';
import product from '../product.json';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { StatusDot } from '../components/StatusDot';
import { usePolling } from '../hooks/usePolling';
import { useSession, useShopTimezone } from '../hooks/useSession';
import { useToast } from '../hooks/useToast';
import { nextOpening, timeOfDay, whenLabel } from '../lib/format';
import { statusView } from '../lib/status';
import { S_ERROR, S_ROW, S_SCROLL, STRIPE_SMALL, st } from '../lib/style';
import { R, navigate } from '../router';

const ROW_TITLE = 'font-size:17px;font-weight:600';
const ROW_SUB = 'font-size:14px;color:#6F6B64';
const CHEVRON = 'color:#B8B3AA;font-size:20px';
const KV = 'display:flex;justify-content:space-between';

export function Camera() {
  const { me } = useSession();
  const shopTz = useShopTimezone();
  const toast = useToast();
  const [status, setStatus] = useState<CameraStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);

  usePolling(async () => {
    try {
      setStatus(await api.cameraStatus());
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Couldn't reach the camera. Check your connection and try again."));
    }
  }, 15000);

  const now = new Date();
  const tz = status?.timezone ?? shopTz;
  const hours = status?.hours ?? me?.shop?.hours;
  const view = status ? statusView(status, now) : null;
  const workstation = status?.workstation ?? me?.shop?.workstation ?? 'chair 1';
  const oneHour = new Date(now.getTime() + 3_600_000);
  const nextOpen = nextOpening(hours, tz, now);

  const pause = async (until: PauseUntil) => {
    if (busy) return;
    setBusy(true);
    try {
      const s = await api.pause(until);
      setStatus(s);
      setSheet(false);
      if (until === '1h') toast(`Paused. Resumes ${whenLabel(s.paused_until ?? oneHour, s.timezone, { at: true, now })}.`);
      else if (until === 'today') toast(`Paused. Resumes ${whenLabel(s.paused_until ?? nextOpen ?? oneHour, s.timezone, { at: true, now })}.`);
      else toast('Paused until you resume.');
    } catch (err) {
      toast(errorMessage(err, "Couldn't pause. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setStatus(await api.resume());
      toast('Recording again.');
    } catch (err) {
      toast(errorMessage(err, "Couldn't resume. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const replaceCamera = () => navigate(R.replace);

  return (
    <div style={st(S_SCROLL)}>
      <div style={st('padding:var(--top-list) 20px 12px;font-size:28px;font-weight:600;line-height:1.1')}>Camera</div>
      <div style={st('padding:8px 20px 24px;display:flex;flex-direction:column;gap:16px')}>
        {view && status && (
          <div style={{ ...st('border-radius:20px;padding:20px;display:flex;flex-direction:column;gap:14px;color:#171614'), background: view.bg }}>
            <div style={st('display:flex;align-items:center;gap:10px')}>
              <StatusDot color={view.color} size={12} />
              <div style={st('font-size:22px;font-weight:600;line-height:1.15')}>{view.title}</div>
            </div>
            <div style={st('font-size:15px;color:#3F3C37;line-height:1.4')}>{view.sub}</div>
            {view.isPaused && (
              <Button variant="secondaryFilled" onClick={() => void resume()} disabled={busy}>
                Resume now
              </Button>
            )}
            <div style={st('display:flex;gap:14px;align-items:center')}>
              <div style={{ ...st('width:72px;height:96px;border-radius:10px;flex:none;overflow:hidden;position:relative'), background: STRIPE_SMALL }}>
                {status.last_thumb_url && <img src={status.last_thumb_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>
              <div style={st('display:flex;flex-direction:column;gap:6px;font-size:15px;flex:1')}>
                <div style={st(KV)}>
                  <span style={st('color:#6F6B64')}>Wi-Fi</span>
                  <span style={st('font-weight:500')}>{view.wifi}</span>
                </div>
                <div style={st(KV)}>
                  <span style={st('color:#6F6B64')}>Temperature</span>
                  <span style={st('font-weight:500')}>{view.thermal}</span>
                </div>
                <div style={st(KV)}>
                  <span style={st('color:#6F6B64')}>Last seen</span>
                  <span style={st('font-weight:500')}>{view.seen}</span>
                </div>
                <div style={st(KV)}>
                  <span style={st('color:#6F6B64')}>Records</span>
                  <span style={st('font-weight:500')}>{view.records}</span>
                </div>
              </div>
            </div>
          </div>
        )}
        {!status && error && <div style={st(S_ERROR)}>{error}</div>}

        <div style={st('background:#fff;border:1px solid rgba(23,22,20,.08);border-radius:20px;overflow:hidden;display:flex;flex-direction:column')}>
          <button onClick={() => setSheet(true)} style={st(S_ROW)}>
            <div style={st('display:flex;flex-direction:column;gap:2px')}>
              <div style={st(ROW_TITLE)}>{view?.isPaused ? 'Change pause' : 'Pause recording'}</div>
              <div style={st(ROW_SUB)}>For an hour, the rest of today, or until you say</div>
            </div>
            <div style={st(CHEVRON)}>›</div>
          </button>
          <button onClick={() => navigate(R.cameraFrame)} style={st(S_ROW)}>
            <div style={st('display:flex;flex-direction:column;gap:2px')}>
              <div style={st(ROW_TITLE)}>Check the shot</div>
              <div style={st(ROW_SUB)}>Live preview and framing guide</div>
            </div>
            <div style={st(CHEVRON)}>›</div>
          </button>
          <button onClick={() => navigate(R.rescan)} style={st(S_ROW)}>
            <div style={st('display:flex;flex-direction:column;gap:2px')}>
              <div style={st(ROW_TITLE)}>Re-scan QR</div>
              <div style={st(ROW_SUB)}>If you changed your Wi-Fi password</div>
            </div>
            <div style={st(CHEVRON)}>›</div>
          </button>
          <button onClick={replaceCamera} style={{ ...st(S_ROW), borderBottom: 0 }}>
            <div style={st('display:flex;flex-direction:column;gap:2px')}>
              <div style={st(ROW_TITLE)}>Replace camera</div>
              <div style={st(ROW_SUB)}>Swap in a spare phone</div>
            </div>
            <div style={st(CHEVRON)}>›</div>
          </button>
        </div>
        <div style={st('font-size:13px;color:#6F6B64;line-height:1.45;padding:0 4px')}>
          This camera films the work at {workstation}. Check clips for people and private details before sharing. Raw footage is deleted after {product.rawRetentionHours} hours.
        </div>
      </div>

      {sheet && (
        <Sheet onClose={() => setSheet(false)} overlay="rgba(23,22,20,.4)" shadow>
          <div style={st('display:flex;flex-direction:column;gap:4px')}>
            <div style={st('font-size:22px;font-weight:600')}>Pause recording</div>
            <div style={st('font-size:15px;color:#6F6B64')}>Nothing is filmed while paused. It's now {timeOfDay(now, tz)}.</div>
          </div>
          <Button variant="sheet" onClick={() => void pause('1h')} disabled={busy}>
            <span>1 hour</span>
            <span style={st('color:#6F6B64;font-size:15px')}>Resumes {whenLabel(oneHour, tz, { now })}</span>
          </Button>
          <Button variant="sheet" onClick={() => void pause('today')} disabled={busy}>
            <span>Rest of today</span>
            <span style={st('color:#6F6B64;font-size:15px')}>{nextOpen ? `Resumes ${whenLabel(nextOpen, tz, { now })}` : 'Resumes tomorrow'}</span>
          </Button>
          <Button variant="sheet" onClick={() => void pause('indefinite')} disabled={busy}>
            <span>Until I resume</span>
            <span style={st('color:#6F6B64;font-size:15px')}>We'll remind you daily</span>
          </Button>
          <Button variant="cancel" onClick={() => setSheet(false)}>
            Cancel
          </Button>
        </Sheet>
      )}
    </div>
  );
}
