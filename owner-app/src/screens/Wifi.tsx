import { useState } from 'react';
import { api } from '../api/index';
import { errorMessage } from '../api/types';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { pending } from '../lib/state';
import { S_ERROR, S_H1, S_PAGE, S_STEP, st } from '../lib/style';
import { knownNetworkName } from '../lib/wifi';
import { R, navigate } from '../router';

export type WifiFlow = 'onboarding' | 'rescan';

export function Wifi({ flow }: { flow: WifiFlow }) {
  const known = knownNetworkName();
  const [ssid, setSsid] = useState(known ?? '');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = async () => {
    if (busy) return;
    if (!ssid.trim()) {
      setError('Enter the Wi-Fi network name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      pending.pair = await api.createPairToken(ssid.trim(), password);
      navigate(flow === 'rescan' ? R.rescanQr : R.qr);
    } catch (err) {
      setError(errorMessage(err, "Couldn't start pairing. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={st(S_PAGE)}>
      <div style={st('display:flex;justify-content:space-between;align-items:center')}>
        <Button variant="back" onClick={() => navigate(flow === 'rescan' ? R.rescan : R.shop)}>
          Back
        </Button>
        <div style={st(S_STEP)}>{flow === 'rescan' ? 'Re-scan, 1 of 2' : 'Step 3 of 7'}</div>
      </div>
      <div style={st('display:flex;flex-direction:column;gap:8px')}>
        <div style={st(S_H1)}>Shop Wi-Fi</div>
        <div style={st('color:#6F6B64')}>{known ? 'The camera joins this network. We found the one your phone is on.' : 'The camera joins this network.'}</div>
      </div>
      <Input label="Network" value={ssid} onChange={(e) => setSsid(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="off" enterKeyHint="next" />
      <Input
        label="Password"
        type={show ? 'text' : 'password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        enterKeyHint="done"
        onKeyDown={(e) => {
          if (e.key === 'Enter') void next();
        }}
        right={
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            style={st('position:absolute;right:8px;top:8px;height:40px;padding:0 12px;border:0;border-radius:10px;background:#F1EFEA;font-size:14px;font-weight:500;color:#171614')}
          >
            {show ? 'Hide' : 'Show'}
          </button>
        }
      />
      {error && <div style={st(S_ERROR)}>{error}</div>}
      <div style={st('flex:1')} />
      <Button onClick={next} disabled={busy}>
        Next
      </Button>
    </div>
  );
}
