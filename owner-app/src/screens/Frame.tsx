import { useEffect, useState } from 'react';
import { api } from '../api/index';
import { errorMessage, type Preview, type ShopType } from '../api/types';
import { Button } from '../components/Button';
import { usePolling } from '../hooks/usePolling';
import { useSession } from '../hooks/useSession';
import { useToast } from '../hooks/useToast';
import { STRIPE_PREVIEW, st } from '../lib/style';
import { R, navigate } from '../router';

export type FrameFlow = 'onboarding' | 'framing';

export function guideCopy(type: ShopType | string | null | undefined): string {
  switch (type) {
    case 'barbershop':
      return 'Keep the chair and mirror inside the box';
    case 'detailing':
    case 'wrap':
      return 'Keep the whole car inside this box';
    case 'tattoo':
      return 'Keep the chair and the station inside the box';
    default:
      return 'Keep the work area inside the box';
  }
}

export function Frame({ flow }: { flow: FrameFlow }) {
  const { me, refresh } = useSession();
  const toast = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.framingStart().catch(() => undefined);
  }, []);

  // 2 Hz, the wall app streams JPEGs while framing_until is in the future.
  usePolling(async () => {
    const p = await api.preview();
    if (p?.url) setPreview(p);
  }, 500);

  const done = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.saveReferenceFrame();
      if (flow === 'framing') {
        navigate(R.camera);
        toast('Shot saved');
      } else {
        await refresh();
        navigate(R.hours);
      }
    } catch (err) {
      toast(errorMessage(err, "Couldn't save the shot. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={st('flex:1;display:flex;flex-direction:column;background:#0E0D0C;color:#F2EFE9')}>
      <div style={{ ...st('position:relative;flex:1;overflow:hidden'), background: STRIPE_PREVIEW }}>
        {preview ? (
          <img src={preview.url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={st('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:12px ui-monospace,Menlo,monospace;color:rgba(242,239,233,.35)')}>
            live preview from wall camera
          </div>
        )}
        <div style={st('position:absolute;left:28px;right:28px;top:160px;bottom:190px;border:3px solid #E08A2E;border-radius:12px;pointer-events:none')} />
        <div style={st('position:absolute;top:var(--top-page);left:24px;right:24px;display:flex;justify-content:space-between;align-items:center')}>
          <Button variant="backDark" onClick={() => navigate(flow === 'framing' ? R.camera : R.qr)}>
            Back
          </Button>
          <div style={st('font-size:13px;color:rgba(242,239,233,.6)')}>{flow === 'framing' ? '' : 'Step 5 of 7'}</div>
        </div>
        <div style={st('position:absolute;left:24px;right:24px;bottom:120px;display:flex;flex-direction:column;gap:6px;pointer-events:none')}>
          <div style={st('font-size:24px;font-weight:600;line-height:1.15;text-wrap:balance')}>{guideCopy(me?.shop?.type)}</div>
          <div style={st('color:rgba(242,239,233,.7);font-size:15px')}>Move the arm by hand. The preview updates live.</div>
        </div>
      </div>
      <div style={st('padding:16px 24px var(--bottom-dark);background:#0E0D0C;flex:none')}>
        <Button variant="primaryAmber" onClick={done} disabled={busy} style={{ width: '100%' }}>
          Looks good
        </Button>
      </div>
    </div>
  );
}
