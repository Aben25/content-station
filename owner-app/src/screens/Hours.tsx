import { useEffect, useState } from 'react';
import { api } from '../api/index';
import { errorMessage, type DayKey, type Hours as HoursMap, type HoursSuggestion } from '../api/types';
import product from '../product.json';
import { Button } from '../components/Button';
import { useSession } from '../hooks/useSession';
import { DAY_KEYS, DEFAULT_HOURS, dayLabel, hoursSummary, typeNoun } from '../lib/format';
import { S_ERROR, S_H1, S_STEP, st } from '../lib/style';
import { R, navigate } from '../router';

const TIME = 'height:40px;border:1px solid rgba(23,22,20,.14);border-radius:10px;padding:0 10px;font:500 15px Outfit,system-ui,sans-serif;background:#fff;color:#171614;flex:1;min-width:0';
const CLOSED_PILL = 'height:32px;padding:0 12px;border-radius:16px;font-size:13px;font-weight:500;flex:none';

export function Hours() {
  const { me, refresh } = useSession();
  const shop = me?.shop ?? null;
  const [suggestion, setSuggestion] = useState<HoursSuggestion | null>(null);
  const [hours, setHours] = useState<HoursMap>(shop?.hours ?? DEFAULT_HOURS);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shopId = shop?.id;
  const shopHasHours = !!shop?.hours;

  useEffect(() => {
    if (!shop) return;
    let live = true;
    api
      .suggestHours(shop.name, shop.type)
      .then((s) => {
        if (!live) return;
        setSuggestion(s);
        if (!shopHasHours) setHours(s.hours);
      })
      .catch(() => {
        if (live) setSuggestion({ hours: DEFAULT_HOURS, source: 'default' });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId]);

  const summary = hoursSummary(hours);
  const label = !suggestion ? '' : suggestion.source === 'google' ? `Hours we found for ${shop?.name ?? ''}` : `Typical hours for a ${typeNoun(shop?.type)}`;

  const setDay = (k: DayKey, patch: { open?: string; close?: string } | null) => {
    setHours((h) => ({ ...h, [k]: patch === null ? null : { ...(h[k] ?? { open: '09:00', close: '19:00' }), ...patch } }));
  };

  const use = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateShop({ hours });
      await refresh();
      navigate(R.done);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save your hours. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={st('flex:1;display:flex;flex-direction:column;padding:var(--top-page) 24px var(--bottom-page);gap:22px;overflow-y:auto')}>
      <div style={st('display:flex;justify-content:space-between;align-items:center')}>
        <Button variant="back" onClick={() => navigate(R.frame)}>
          Back
        </Button>
        <div style={st(S_STEP)}>Step 6 of 7</div>
      </div>
      <div style={st(S_H1)}>When should the camera record?</div>
      <div style={st('background:#fff;border:1px solid rgba(23,22,20,.1);border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:6px')}>
        <div style={st('font-size:13px;color:#6F6B64;min-height:18px')}>{label}</div>
        <div style={st('font-size:20px;font-weight:600')}>{summary.line}</div>
        {summary.closed && <div style={st('font-size:15px;color:#6F6B64')}>{summary.closed}</div>}
      </div>
      {custom ? (
        <div style={st('background:#fff;border:1px solid rgba(23,22,20,.1);border-radius:16px;overflow:hidden;display:flex;flex-direction:column')}>
          {DAY_KEYS.map((k, i) => {
            const dh = hours[k];
            return (
              <div key={k} style={{ ...st('display:flex;align-items:center;gap:8px;padding:10px 14px'), borderBottom: i < DAY_KEYS.length - 1 ? '1px solid rgba(23,22,20,.08)' : 0 }}>
                <div style={st('width:36px;font-size:15px;font-weight:600;flex:none')}>{dayLabel(k)}</div>
                {dh ? (
                  <>
                    <input type="time" value={dh.open} onChange={(e) => setDay(k, { open: e.target.value })} aria-label={`${dayLabel(k, 'long')} opens`} style={st(TIME)} />
                    <div style={st('font-size:13px;color:#6F6B64;flex:none')}>to</div>
                    <input type="time" value={dh.close} onChange={(e) => setDay(k, { close: e.target.value })} aria-label={`${dayLabel(k, 'long')} closes`} style={st(TIME)} />
                  </>
                ) : (
                  <div style={st('flex:1;font-size:15px;color:#6F6B64')}>Closed</div>
                )}
                <Button variant="pill" selected={!dh} onClick={() => setDay(k, dh ? null : {})} aria-pressed={!dh} style={st(CLOSED_PILL)}>
                  Closed
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setCustom(true)}>
          Set my own hours
        </Button>
      )}
      {error && <div style={st(S_ERROR)}>{error}</div>}
      <div style={st('flex:1')} />
      <div style={st('display:flex;flex-direction:column;gap:8px;padding:16px;border-radius:14px;background:#F1EFEA')}>
        <div style={st('font-weight:600;font-size:15px')}>Good to know</div>
        <div style={st('font-size:15px;color:#3F3C37;line-height:1.45')}>
          The camera records only during these hours. Faces of anyone who isn't staff are blurred. Pause any time from the Camera tab, two taps. Raw footage is deleted after {product.rawRetentionHours} hours.
        </div>
      </div>
      <Button onClick={use} disabled={busy}>
        Use these hours
      </Button>
    </div>
  );
}
