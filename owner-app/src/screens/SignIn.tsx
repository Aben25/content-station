import { useState, type FormEvent } from 'react';
import { api } from '../api/index';
import { errorMessage } from '../api/types';
import product from '../product.json';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { isValidPhone } from '../lib/format';
import { getPendingPhone, setPendingPhone } from '../lib/state';
import { S_ERROR, S_PAGE_HERO, st } from '../lib/style';
import { R, navigate } from '../router';

export function SignIn() {
  const [phone, setPhone] = useState(getPendingPhone());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!isValidPhone(phone)) {
      setError('Enter a mobile number with 10 digits.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.sendOtp(phone.trim());
      setPendingPhone(phone.trim());
      navigate(R.code);
    } catch (err) {
      setError(errorMessage(err, "Couldn't send the code. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={st(S_PAGE_HERO)}>
      <div style={st('display:flex;flex-direction:column;gap:10px')}>
        <div style={st('font-size:13px;font-weight:600;letter-spacing:.08em;color:#E08A2E')}>{product.name.toUpperCase()}</div>
        <div style={st('font-size:32px;font-weight:600;line-height:1.1;text-wrap:balance')}>{product.tagline}</div>
        <div style={st('color:#6F6B64')}>Sign in with your phone number. No password.</div>
      </div>
      <Input
        label="Mobile number"
        size={20}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        enterKeyHint="send"
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
          setError(null);
        }}
      />
      {error && <div style={st(S_ERROR)}>{error}</div>}
      <div style={st('flex:1')} />
      <Button type="submit" disabled={busy}>
        Text me a code
      </Button>
    </form>
  );
}
