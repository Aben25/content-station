import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index';
import { Button } from '../components/Button';
import { QRCode } from '../components/QRCode';
import { StatusDot } from '../components/StatusDot';
import { usePolling } from '../hooks/usePolling';
import { useSession } from '../hooks/useSession';
import { useToast } from '../hooks/useToast';
import { pending } from '../lib/state';
import { S_STEP, STRIPE_LIGHT, st } from '../lib/style';
import { R, navigate, replace } from '../router';
import type { WifiFlow } from './Wifi';

type PairState = 'waiting' | 'reading' | 'connected';
const LABEL: Record<PairState, string> = { waiting: 'Waiting', reading: 'Reading', connected: 'Connected' };
const ADVANCE_MS = 1300;

export function Qr({ flow }: { flow: WifiFlow }) {
  const pair = pending.pair;
  const { refresh } = useSession();
  const toast = useToast();
  const [state, setState] = useState<PairState>('waiting');
  const done = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const wifiRoute = flow === 'rescan' ? R.rescanWifi : R.wifi;

  // No payload in memory (reload, deep link) means the Wi-Fi step has to run again.
  // Skipped once pairing finished, because the payload is cleared right before leaving this screen.
  useEffect(() => {
    if (!pair && !done.current) replace(wifiRoute);
  }, [pair, wifiRoute]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  usePolling(
    async () => {
      if (!pair || done.current) return;
      const s = await api.pairStatus(pair.pair_token);
      if (done.current) return;
      if (s.state === 'expired') {
        done.current = true;
        pending.pair = null;
        toast('That code expired. Enter the Wi-Fi again.');
        replace(wifiRoute);
        return;
      }
      setState(s.state);
      if (s.state === 'connected') {
        done.current = true;
        timer.current = window.setTimeout(async () => {
          await refresh();
          if (flow === 'rescan') {
            navigate(R.camera);
            toast('Camera reconnected');
          } else {
            navigate(R.frame);
          }
          pending.pair = null;
        }, ADVANCE_MS);
      }
    },
    1000,
    !!pair && state !== 'connected',
  );

  if (!pair) return null;
  const connected = state === 'connected';

  return (
    <div style={st('flex:1;display:flex;flex-direction:column;padding:var(--top-page) 24px var(--bottom-page);gap:20px;align-items:center;overflow-y:auto')}>
      <div style={st('display:flex;justify-content:space-between;align-items:center;width:100%')}>
        <Button variant="back" onClick={() => navigate(wifiRoute)}>
          Back
        </Button>
        <div style={st(S_STEP)}>{flow === 'rescan' ? 'Re-scan, 2 of 2' : 'Step 4 of 7'}</div>
      </div>
      <div style={st('font-size:28px;font-weight:600;line-height:1.15;text-align:center;text-wrap:balance')}>Hold this up to the camera</div>
      <QRCode value={pair.qr_payload} />
      <div style={st('display:flex;align-items:center;gap:10px;height:44px;padding:0 18px;border-radius:22px;background:#fff;border:1px solid rgba(23,22,20,.1);flex:none')}>
        <StatusDot color={connected ? '#2F8F5B' : '#E08A2E'} size={10} pulse={!connected} />
        <div style={st('font-size:15px;font-weight:500')}>{LABEL[state]}</div>
      </div>
      <div
        style={{
          ...st('width:100%;height:120px;border-radius:14px;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 24px;font:12px ui-monospace,Menlo,monospace;color:#6F6B64;box-sizing:border-box;flex:none'),
          background: STRIPE_LIGHT,
        }}
      >
        illustration: person on the shop floor holding a phone up toward a corner-mounted camera
      </div>
      <div style={st('flex:1')} />
      <div style={st('text-align:center;color:#6F6B64;font-size:15px;text-wrap:balance')}>Stand 6 to 8 feet from the camera. This screen moves on by itself.</div>
    </div>
  );
}
