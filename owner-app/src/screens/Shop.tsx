import { useState } from 'react';
import { api } from '../api/index';
import { errorMessage, type ShopType } from '../api/types';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useSession } from '../hooks/useSession';
import { browserTimezone } from '../lib/format';
import { S_ERROR, S_H1, S_LABEL, S_PAGE, S_STEP, st } from '../lib/style';
import { R, navigate, replace } from '../router';

const TYPES: { name: string; value: ShopType }[] = [
  { name: 'Barbershop', value: 'barbershop' },
  { name: 'Detailing', value: 'detailing' },
  { name: 'Wrap shop', value: 'wrap' },
  { name: 'Tattoo', value: 'tattoo' },
];

export function Shop() {
  const { me, setMe, signOut } = useSession();
  const existing = me?.shop ?? null;
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<ShopType>(existing?.type ?? 'barbershop');
  const [instagram, setInstagram] = useState(existing?.instagram ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = async () => {
    if (busy) return;
    if (!name.trim()) {
      setError('Enter your shop name.');
      return;
    }
    setBusy(true);
    setError(null);
    const ig = instagram.trim() ? (instagram.trim().startsWith('@') ? instagram.trim() : `@${instagram.trim()}`) : null;
    try {
      const shop = existing
        ? await api.updateShop({ name: name.trim(), type, instagram: ig })
        : await api.createShop({ name: name.trim(), type, instagram: ig, timezone: browserTimezone() });
      if (me) setMe({ ...me, shop, onboarding_step: me.onboarding_step === 'shop' ? 'wifi' : me.onboarding_step });
      navigate(R.wifi);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save your shop. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  // Back from the first onboarding step means "not this number". Sign out and start over.
  const back = async () => {
    await signOut();
    replace(R.start);
  };

  return (
    <div style={st(S_PAGE)}>
      <div style={st('display:flex;justify-content:space-between;align-items:center')}>
        <Button variant="back" onClick={back}>
          Back
        </Button>
        <div style={st(S_STEP)}>Step 2 of 7</div>
      </div>
      <div style={st(S_H1)}>Your shop</div>
      <Input label="Shop name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" enterKeyHint="next" />
      <div style={st('display:flex;flex-direction:column;gap:8px')}>
        <label style={st(S_LABEL)}>Type of shop</label>
        <div style={st('display:flex;flex-wrap:wrap;gap:8px')}>
          {TYPES.map((t) => (
            <Button key={t.value} variant="pill" selected={type === t.value} onClick={() => setType(t.value)} aria-pressed={type === t.value}>
              {t.name}
            </Button>
          ))}
        </div>
      </div>
      <Input
        label="Instagram (optional)"
        placeholder="@yourshop"
        value={instagram}
        onChange={(e) => setInstagram(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        enterKeyHint="done"
      />
      {error && <div style={st(S_ERROR)}>{error}</div>}
      <div style={st('flex:1')} />
      <Button onClick={next} disabled={busy}>
        Next
      </Button>
    </div>
  );
}
