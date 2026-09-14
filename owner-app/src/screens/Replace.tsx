import { useState } from 'react';
import { api } from '../api/index';
import { errorMessage } from '../api/types';
import { Button } from '../components/Button';
import { useToast } from '../hooks/useToast';
import { S_H1, S_PAGE, st } from '../lib/style';
import { R, navigate } from '../router';

const STEPS = [
  'Unclip the old phone from the mount. Nothing else to do on it.',
  'Clip in the spare and plug it in. Wait for the code to show.',
  'Tap Next and hold your phone up to it. Your framing and hours carry over.',
];

export function Replace() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // The old device drops to waiting, then the rescan flow pairs the spare.
  const next = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.unpair();
      navigate(R.rescanWifi);
    } catch (err) {
      toast(errorMessage(err, "Couldn't release the old camera. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={st(S_PAGE)}>
      <Button variant="back" onClick={() => navigate(R.camera)} style={{ alignSelf: 'flex-start' }}>
        Back
      </Button>
      <div style={st(S_H1)}>Replace camera</div>
      <div style={st('display:flex;flex-direction:column;gap:14px')}>
        {STEPS.map((t, i) => (
          <div key={i} style={st('display:flex;gap:14px;align-items:baseline')}>
            <div style={st('font-size:22px;font-weight:600;color:#E08A2E;width:24px;flex:none')}>{i + 1}</div>
            <div style={st('font-size:17px;line-height:1.4')}>{t}</div>
          </div>
        ))}
      </div>
      <div style={st('flex:1')} />
      <Button onClick={() => void next()} disabled={busy}>
        Next
      </Button>
    </div>
  );
}
