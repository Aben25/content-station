import { useMemo, useRef, useState } from 'react';
import { api } from '../api/index';
import { errorMessage, type Clip, type Publication, type PublishingOverview } from '../api/types';
import { canCancel, channelLine, inputValueToIso, localInputValue, makeIdempotencyKey, publicationTitle } from '../lib/publishing';
import { whenLabel } from '../lib/format';
import { st } from '../lib/style';
import { Button } from './Button';
import { Sheet } from './Sheet';

const PILL_ON = 'height:44px;padding:0 16px;border-radius:22px;font-size:16px;font-weight:500;border:1px solid #171614;background:#171614;color:#fff';
const PILL_OFF = 'height:44px;padding:0 16px;border-radius:22px;font-size:16px;font-weight:500;border:1px solid rgba(23,22,20,.14);background:#fff;color:#171614';
const PILL_DISABLED = 'height:44px;padding:0 16px;border-radius:22px;font-size:16px;font-weight:500;border:1px dashed rgba(23,22,20,.2);background:none;color:#6F6B64';

interface SheetProps {
  clip: Clip;
  overview: PublishingOverview;
  timezone: string;
  onClose: () => void;
  onPublished: (p: Publication) => void;
  onConnect: () => void;
}

// Review, choose accounts, then publish now or at a shop-local time.
export function PublishSheet({ clip, overview, timezone, onClose, onPublished, onConnect }: SheetProps) {
  const usable = overview.accounts.filter((a) => !a.disabled);
  const [chosen, setChosen] = useState<string[]>(usable.length === 1 ? [usable[0].id] : []);
  const [mode, setMode] = useState<'now' | 'schedule'>('now');
  const [when, setWhen] = useState(() => localInputValue(Date.now() + 60 * 60_000, timezone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  // One key per opened sheet: a retry after a failed request stays one decision.
  const key = useMemo(makeIdempotencyKey, []);
  const minValue = localInputValue(Date.now() + 5 * 60_000, timezone);
  const scheduleIso = mode === 'schedule' ? inputValueToIso(when, timezone) : null;
  const scheduleInvalid = mode === 'schedule' && (!scheduleIso || Date.parse(scheduleIso) < Date.now() + 2 * 60_000);

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const submit = async () => {
    if (pending.current || !chosen.length || scheduleInvalid) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const p = await api.publishClip(clip.id, { account_ids: chosen, schedule_at: scheduleIso, idempotency_key: key });
      onPublished(p);
    } catch (err) {
      setError(errorMessage(err, "Couldn't publish. Try again."));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={busy ? () => undefined : onClose} gap={16}>
      <div style={st('display:flex;flex-direction:column;gap:6px')}>
        <div style={st('font-size:22px;font-weight:600')}>Publish this clip</div>
        <div style={st('font-size:15px;color:#3F3C37;line-height:1.45')}>Posted with the caption you saved. Close this sheet to change it first.</div>
      </div>
      <div style={st('border:1px solid rgba(23,22,20,.1);border-radius:14px;padding:12px 14px;font-size:15px;line-height:1.4;background:#fff')}>{clip.caption}</div>
      {overview.accounts.length === 0 ? (
        <div style={st('display:flex;flex-direction:column;gap:12px')}>
          <div style={st('font-size:15px;color:#3F3C37;line-height:1.45')}>No account is connected yet.</div>
          <Button variant="secondaryFilled" onClick={onConnect}>Connect an account</Button>
        </div>
      ) : (
        <div style={st('display:flex;flex-direction:column;gap:10px')}>
          <div style={st('font-size:13px;font-weight:500;color:#6F6B64')}>POST TO</div>
          <div style={st('display:flex;flex-wrap:wrap;gap:8px')}>
            {overview.accounts.map((a) =>
              a.disabled ? (
                <button key={a.id} type="button" disabled style={st(PILL_DISABLED)} aria-label={`${a.provider_label} ${a.name}, needs reconnecting`}>
                  {a.provider_label}: {a.name} (reconnect first)
                </button>
              ) : (
                <button key={a.id} type="button" aria-pressed={chosen.includes(a.id)} onClick={() => toggle(a.id)} style={st(chosen.includes(a.id) ? PILL_ON : PILL_OFF)}>
                  {a.provider_label}: {a.name}
                </button>
              ),
            )}
          </div>
        </div>
      )}
      {overview.accounts.length > 0 && (
        <div style={st('display:flex;flex-direction:column;gap:10px')}>
          <div style={st('font-size:13px;font-weight:500;color:#6F6B64')}>WHEN</div>
          <div style={st('display:flex;gap:8px')}>
            <button type="button" aria-pressed={mode === 'now'} onClick={() => setMode('now')} style={st(mode === 'now' ? PILL_ON : PILL_OFF)}>Now</button>
            <button type="button" aria-pressed={mode === 'schedule'} onClick={() => setMode('schedule')} style={st(mode === 'schedule' ? PILL_ON : PILL_OFF)}>Pick a time</button>
          </div>
          {mode === 'schedule' && (
            <div style={st('display:flex;flex-direction:column;gap:6px')}>
              <input
                type="datetime-local"
                aria-label="Publish time"
                value={when}
                min={minValue}
                onChange={(e) => setWhen(e.target.value)}
                style={st('height:48px;border:1px solid rgba(23,22,20,.14);border-radius:12px;padding:0 14px;font:500 16px Outfit,system-ui,sans-serif;background:#fff;color:#171614;width:100%')}
              />
              <div style={st('font-size:13px;color:#6F6B64')}>Shop time ({timezone}).{scheduleInvalid ? ' Choose a time at least a few minutes from now.' : scheduleIso ? ` Posts ${whenLabel(scheduleIso, timezone, { at: true })}.` : ''}</div>
            </div>
          )}
        </div>
      )}
      {error && <div role="alert" style={st('font-size:15px;color:#C94B32;line-height:1.4')}>{error}</div>}
      {overview.accounts.length > 0 && (
        <Button onClick={() => void submit()} disabled={busy || !chosen.length || scheduleInvalid}>
          {busy ? 'Sending…' : mode === 'now' ? 'Publish now' : 'Schedule'}
        </Button>
      )}
      <Button variant="cancel" onClick={onClose} disabled={busy}>Cancel</Button>
    </Sheet>
  );
}

interface ListProps {
  publications: Publication[];
  timezone: string;
  cancelling: string | null;
  onCancel: (p: Publication) => void;
}

// Outcome per publication and per account, shown under the clip.
export function PublicationList({ publications, timezone, cancelling, onCancel }: ListProps) {
  if (!publications.length) return null;
  const now = new Date();
  return (
    <div style={st('display:flex;flex-direction:column;gap:10px')}>
      <div style={st('font-size:12px;color:rgba(242,239,233,.55);font-weight:500;letter-spacing:.04em')}>PUBLISHING</div>
      {publications.map((p) => (
        <div key={p.id} style={st('border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;background:rgba(255,255,255,.04)')}>
          <div style={st('display:flex;justify-content:space-between;align-items:center;gap:10px')}>
            <div style={st('font-size:15px;font-weight:600')}>{publicationTitle(p)}</div>
            {canCancel(p) && (
              <button type="button" onClick={() => onCancel(p)} disabled={cancelling === p.id} style={st('background:none;border:0;padding:0;font-size:14px;color:#E08A2E;text-decoration:underline')}>
                {cancelling === p.id ? 'Cancelling…' : 'Cancel'}
              </button>
            )}
          </div>
          {p.channels.map((c) => (
            <div key={c.account_id} style={st('display:flex;flex-direction:column;gap:2px;font-size:14px;line-height:1.4')}>
              <div style={st('color:rgba(242,239,233,.85)')}>{c.provider_label}: {c.name}</div>
              <div style={st('color:rgba(242,239,233,.6)')}>
                {channelLine(c, p, timezone, now)}
                {c.live_url && (
                  <>
                    {' '}
                    <a href={c.live_url} target="_blank" rel="noreferrer" style={st('color:#E08A2E')}>View post</a>
                  </>
                )}
              </div>
            </div>
          ))}
          {p.last_error && p.state === 'failed' && !p.channels.some((c) => c.error) && <div style={st('font-size:13px;color:#E08A2E')}>{p.last_error}</div>}
        </div>
      ))}
    </div>
  );
}
