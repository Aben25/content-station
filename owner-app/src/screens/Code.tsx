import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api } from '../api/index';
import { errorMessage } from '../api/types';
import { Button } from '../components/Button';
import { useSession } from '../hooks/useSession';
import { useToast } from '../hooks/useToast';
import { displayPhone } from '../lib/format';
import { getPendingPhone } from '../lib/state';
import { S_ERROR, S_H1, st } from '../lib/style';
import { R, navigate, replace, stepRoute } from '../router';

const BOX = 'flex:1;height:64px;border-radius:12px;background:#fff;border:1px solid rgba(23,22,20,.14);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:600';
const MISMATCH = "That code didn't match. Try again or text a new one.";

export function Code() {
  const phone = getPendingPhone();
  const { refresh } = useSession();
  const toast = useToast();
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!phone) replace(R.start);
  }, [phone]);

  const submit = useCallback(
    async (code: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await api.verifyOtp(phone, code);
        const me = await refresh();
        replace(me ? stepRoute(me.onboarding_step) : R.home);
      } catch {
        setError(MISMATCH);
        setDigits('');
        input.current?.focus();
      } finally {
        setBusy(false);
      }
    },
    [busy, phone, refresh],
  );

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
    setDigits(v);
    setError(null);
    if (v.length === 6) void submit(v);
  };

  const resend = async () => {
    try {
      await api.sendOtp(phone);
      setDigits('');
      setError(null);
      toast('Texted a new code.');
      input.current?.focus();
    } catch (err) {
      setError(errorMessage(err, "Couldn't send the code. Check your connection and try again."));
    }
  };

  return (
    <div style={st('flex:1;display:flex;flex-direction:column;padding:var(--top-page) 24px var(--bottom-page);gap:28px;overflow-y:auto')}>
      <Button variant="back" onClick={() => navigate(R.start)} style={{ alignSelf: 'flex-start' }}>
        Back
      </Button>
      <div style={st('display:flex;flex-direction:column;gap:10px')}>
        <div style={st(S_H1)}>Enter the code we texted</div>
        <div style={st('color:#6F6B64')}>Sent to {displayPhone(phone)}</div>
      </div>
      <div style={st('position:relative;display:flex;gap:8px')} onClick={() => input.current?.focus()}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={st(BOX)}>
            {digits[i] ?? ''}
          </div>
        ))}
        <input
          ref={input}
          value={digits}
          onChange={onChange}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          aria-label="Six digit code"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: 0,
            border: 0,
            padding: 0,
            margin: 0,
            background: 'transparent',
            color: 'transparent',
            caretColor: 'transparent',
            fontSize: 16,
          }}
        />
      </div>
      {error && <div style={st(S_ERROR)}>{error}</div>}
      <Button variant="link" onClick={resend} style={{ alignSelf: 'flex-start' }}>
        Text it again
      </Button>
      <div style={st('flex:1')} />
      <Button onClick={() => (digits.length === 6 ? void submit(digits) : input.current?.focus())} disabled={busy}>
        Continue
      </Button>
    </div>
  );
}
