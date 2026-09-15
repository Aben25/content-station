import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index';
import { errorMessage, type PublishingAccount, type PublishingOverview } from '../api/types';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { usePolling } from '../hooks/usePolling';
import { useToast } from '../hooks/useToast';
import { openExternal } from '../lib/navigation';
import { S_ERROR, S_SCROLL, st } from '../lib/style';
import { hashQuery, R, navigate, replace } from '../router';

const ROW = 'display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid rgba(23,22,20,.08);gap:12px';

// Connected social accounts. Connecting sends the owner to the platform's own
// login page; the publishing service brings them back here afterwards.
export function Accounts() {
  const toast = useToast();
  const [overview, setOverview] = useState<PublishingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PublishingAccount | null>(null);
  const pending = useRef(false);

  const load = async () => {
    try {
      setOverview(await api.publishingAccounts());
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Couldn't load your accounts. Check your connection and try again."));
    }
  };
  usePolling(load, 30_000);

  // Return from the platform login: "#/accounts?added=facebook&msg=Channel%20Added".
  // A real return is a fresh page load; a hash-only return (same document) is handled too.
  useEffect(() => {
    const returned = () => {
      const q = hashQuery();
      if (!q.get('added') && !q.get('msg')) return;
      pending.current = false;
      setBusy(null);
      toast(q.get('added') ? 'Account connected.' : q.get('msg') || 'Back from the platform.');
      replace(R.accounts);
      void load();
    };
    returned();
    window.addEventListener('hashchange', returned);
    return () => window.removeEventListener('hashchange', returned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async (key: string, run: () => Promise<{ url: string }>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(key);
    setError(null);
    try {
      const { url } = await run();
      openExternal(url);
    } catch (err) {
      setError(errorMessage(err, "Couldn't start the connection. Try again."));
      pending.current = false;
      setBusy(null);
    }
  };

  const remove = async () => {
    const account = removing;
    if (!account || pending.current) return;
    pending.current = true;
    setBusy(`remove:${account.id}`);
    try {
      await api.disconnectAccount(account.id);
      setRemoving(null);
      toast('Account removed. Scheduled posts to it were cancelled.');
      await load();
    } catch (err) {
      toast(errorMessage(err, "Couldn't remove the account. Try again."));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  };

  return (
    <div style={st(S_SCROLL)}>
      <div style={st('padding:var(--top-list) 20px 12px;display:flex;flex-direction:column;gap:6px')}>
        <Button variant="back" onClick={() => navigate(R.settings)} style={{ alignSelf: 'flex-start' }}>Back</Button>
        <div style={st('font-size:28px;font-weight:600;line-height:1.1')}>Connected accounts</div>
      </div>
      <div style={st('padding:8px 20px 24px;display:flex;flex-direction:column;gap:16px')}>
        {error && <div role="alert" style={st(S_ERROR)}>{error}</div>}
        {overview && !overview.configured && (
          <div style={st('background:#fff;border:1px solid rgba(23,22,20,.08);border-radius:20px;padding:18px;display:flex;flex-direction:column;gap:6px')}>
            <div style={st('font-size:17px;font-weight:600')}>Publishing is not set up yet</div>
            <div style={st('font-size:15px;color:#6F6B64;line-height:1.45')}>This server has no publishing service. Download or share clips manually for now.</div>
          </div>
        )}
        {overview?.configured && (
          <>
            <div style={st('background:#fff;border:1px solid rgba(23,22,20,.08);border-radius:20px;overflow:hidden;display:flex;flex-direction:column')}>
              {overview.accounts.length === 0 && <div style={st('padding:16px 18px;font-size:15px;color:#6F6B64;line-height:1.45')}>No account is connected. Connect one below to publish clips from the app.</div>}
              {overview.accounts.map((a) => (
                <div key={a.id} style={st(ROW)}>
                  <div style={st('display:flex;flex-direction:column;gap:2px;min-width:0')}>
                    <div style={st('font-size:17px;font-weight:600')}>{a.name}</div>
                    <div style={st('font-size:14px;color:#6F6B64')}>
                      {a.provider_label}
                      {a.profile ? `, ${a.profile}` : ''}
                      {a.disabled ? '. Needs reconnecting.' : ''}
                    </div>
                  </div>
                  <div style={st('display:flex;gap:8px;flex:none')}>
                    {a.disabled && (
                      <Button variant="pill" selected onClick={() => void start(`reconnect:${a.id}`, () => api.reconnectAccount(a.id, a.provider))} disabled={!!busy}>
                        {busy === `reconnect:${a.id}` ? 'Opening…' : 'Reconnect'}
                      </Button>
                    )}
                    <Button variant="pill" onClick={() => setRemoving(a)} disabled={!!busy}>Remove</Button>
                  </div>
                </div>
              ))}
            </div>
            <div style={st('display:flex;flex-direction:column;gap:10px')}>
              {overview.providers.map((p) => (
                <Button key={p.id} variant="secondaryFilled" onClick={() => void start(`connect:${p.id}`, () => api.connectAccount(p.id))} disabled={!!busy}>
                  {busy === `connect:${p.id}` ? 'Opening…' : `Connect ${p.label}`}
                </Button>
              ))}
            </div>
            <div style={st('font-size:13px;color:#6F6B64;line-height:1.45;padding:0 4px')}>
              You sign in on the platform itself and choose the Page or account. Your password never goes through {'ContentStation'}. Use your browser's Back button if you change your mind on the platform's page.
            </div>
          </>
        )}
      </div>
      {removing && (
        <Sheet onClose={() => setRemoving(null)}>
          <div style={st('display:flex;flex-direction:column;gap:6px')}>
            <div style={st('font-size:22px;font-weight:600')}>Remove {removing.name}?</div>
            <div style={st('font-size:15px;color:#3F3C37;line-height:1.45')}>Scheduled posts to this account are cancelled. Posts already published stay on {removing.provider_label}.</div>
          </div>
          <Button variant="danger" onClick={() => void remove()} disabled={!!busy}>Remove account</Button>
          <Button variant="cancel" onClick={() => setRemoving(null)}>Keep it</Button>
        </Sheet>
      )}
    </div>
  );
}
