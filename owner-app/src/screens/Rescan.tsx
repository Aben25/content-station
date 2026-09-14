import { Button } from '../components/Button';
import { S_H1, S_PAGE, st } from '../lib/style';
import { R, navigate } from '../router';

export function Rescan() {
  return (
    <div style={st(S_PAGE)}>
      <Button variant="back" onClick={() => navigate(R.camera)} style={{ alignSelf: 'flex-start' }}>
        Back
      </Button>
      <div style={st('display:flex;flex-direction:column;gap:10px')}>
        <div style={st(S_H1)}>Re-scan QR</div>
        <div style={st('color:#6F6B64;font-size:17px;line-height:1.45;text-wrap:pretty')}>
          Use this if you changed your Wi-Fi name or password, or the camera says "Re-scan QR". Takes about a minute. You'll enter the Wi-Fi, then hold your phone up to the camera.
        </div>
      </div>
      <div style={st('flex:1')} />
      <Button onClick={() => navigate(R.rescanWifi)}>Start</Button>
    </div>
  );
}
