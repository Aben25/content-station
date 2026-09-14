import { useRef, useState } from 'react';
import { Button } from '../components/Button';
import { errorMessage } from '../api/types';
import { R, replace } from '../router';
import product from '../product.json';
import { useSession } from '../hooks/useSession';
import { hoursShort, typeLabel } from '../lib/format';
import { S_ERROR, S_SCROLL, st } from '../lib/style';

export function Settings() {
  const { me, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const leave = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try { await signOut(); replace(R.start); }
    catch (err) { setError(errorMessage(err, "Couldn't sign out. Please try again.")); }
    finally { pending.current = false; setBusy(false); }
  };
  const shop = me?.shop ?? null;
  const rows: [string, string][] = [
    ['Business profile', shop ? `${shop.name}, ${typeLabel(shop.type)}` : 'Business profile is not available.'],
    ['Sharing', 'Download or share clips manually.'],
    ['Recording', shop?.hours ? `Saved hours: ${hoursShort(shop.hours)}` : 'Recording hours are not set.'],
    ['Team', 'Team management is not available yet.'],
    ['Billing', 'Billing details are not available here.'],
  ];
  return (
    <div style={st(S_SCROLL)}>
      <div style={st('padding:var(--top-list) 20px 12px;font-size:28px;font-weight:600;line-height:1.1')}>Settings</div>
      <div style={st('padding:8px 20px 24px;display:flex;flex-direction:column;gap:16px')}>
        <div style={st('background:#fff;border:1px solid rgba(23,22,20,.08);border-radius:20px;overflow:hidden;display:flex;flex-direction:column')}>
          {rows.map(([name, sub]) => (
            <div key={name} style={st('display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid rgba(23,22,20,.08);gap:12px')}>
              <div style={st('display:flex;flex-direction:column;gap:2px')}>
                <div style={st('font-size:17px;font-weight:600')}>{name}</div>
                <div style={st('font-size:14px;color:#6F6B64')}>{sub}</div>
              </div>
              <div style={st('color:#B8B3AA;font-size:20px')}>›</div>
            </div>
          ))}
        </div>
        <div style={st('font-size:13px;color:#6F6B64;line-height:1.45;padding:0 4px')}>Raw footage is deleted after {product.rawRetentionHours} hours. Clips are kept until you delete them.</div>
        <div style={st('font-size:12px;color:#B8B3AA;padding:0 4px')}>These settings are view-only.</div>
        {error && <div role="alert" style={st(S_ERROR)}>{error}</div>}
        <Button variant="secondary" disabled={busy} onClick={() => void leave()}>{busy ? 'Signing out…' : 'Sign out'}</Button>
      </div>
    </div>
  );
}
