import product from '../product.json';
import { Button } from '../components/Button';
import { useSession } from '../hooks/useSession';
import { hourLabel } from '../lib/format';
import { STRIPE_TINY, st } from '../lib/style';
import { R, navigate } from '../router';

export function Done() {
  const { me } = useSession();
  const deliveryHour = me?.shop?.delivery_hour ?? product.deliveryHourLocal;
  return (
    <div style={st('flex:1;display:flex;flex-direction:column;padding:var(--top-hero) 24px var(--bottom-page);gap:24px;overflow-y:auto')}>
      <div style={st('width:64px;height:64px;border-radius:50%;background:#E08A2E;flex:none')} />
      <div style={st('display:flex;flex-direction:column;gap:10px')}>
        <div style={st('font-size:32px;font-weight:600;line-height:1.1')}>You're set.</div>
        <div style={st('color:#6F6B64;font-size:18px;text-wrap:pretty')}>Your recording schedule is saved. Clips appear here after footage is captured and processed.</div>
      </div>
      <div style={st('display:flex;gap:12px;padding:14px;border-radius:20px;background:rgba(255,255,255,.9);border:1px solid rgba(23,22,20,.08);box-shadow:0 8px 24px rgba(0,0,0,.08)')}>
        <div style={st('width:44px;height:44px;border-radius:11px;background:#171614;display:flex;align-items:center;justify-content:center;flex:none')}>
          <div style={st('width:14px;height:14px;border-radius:50%;background:#E08A2E')} />
        </div>
        <div style={st('flex:1;display:flex;flex-direction:column;gap:2px')}>
          <div style={st('display:flex;justify-content:space-between;font-size:15px')}>
            <span style={st('font-weight:600')}>Clip schedule</span>
            <span style={st('color:#6F6B64;font-size:13px')}>{hourLabel(deliveryHour)}</span>
          </div>
          <div style={st('font-size:15px;line-height:1.3')}>Check Camera for its current status, then open Clips to see processed videos.</div>
        </div>
        <div style={{ ...st('width:40px;height:56px;border-radius:8px;flex:none'), background: STRIPE_TINY }} />
      </div>
      <div style={st('flex:1')} />
      <Button onClick={() => navigate(R.home)}>Done</Button>
    </div>
  );
}
