import { useEffect } from 'react';
import { BottomNav, type Tab } from './components/BottomNav';
import { Button } from './components/Button';
import { SessionProvider, useSession, useSessionState } from './hooks/useSession';
import { ToastProvider } from './hooks/useToast';
import { S_ERROR, S_PAGE, st } from './lib/style';
import { AUTH_ROUTES, ONBOARDING_ROUTES, R, replace, stepRoute, useRoute, type Route } from './router';
import { Camera } from './screens/Camera';
import { ClipDetail } from './screens/ClipDetail';
import { Code } from './screens/Code';
import { Done } from './screens/Done';
import { Frame } from './screens/Frame';
import { Home } from './screens/Home';
import { Hours } from './screens/Hours';
import { Qr } from './screens/Qr';
import { Replace } from './screens/Replace';
import { Rescan } from './screens/Rescan';
import { Settings } from './screens/Settings';
import { Shop } from './screens/Shop';
import { SignIn } from './screens/SignIn';
import { Wifi } from './screens/Wifi';
import { ownerConfig } from './api/index';

const NAV_TABS: Partial<Record<Route['name'], Tab>> = { home: 'home', camera: 'camera', settings: 'settings' };

export default function App() {
  if (ownerConfig.mode === 'setup') return <Setup missing={ownerConfig.missing} />;
  return <ConfiguredApp />;
}

function ConfiguredApp() {
  const session = useSessionState();
  return (
    <SessionProvider value={session}>
      <ToastProvider>
        {ownerConfig.mode === 'demo' && <div style={st('position:fixed;z-index:20;top:8px;right:8px;background:#E08A2E;color:#171614;padding:5px 9px;border-radius:8px;font-size:11px;font-weight:700;letter-spacing:.06em')}>DEMO DATA</div>}
        <Shell />
      </ToastProvider>
    </SessionProvider>
  );
}

function Setup({ missing }: { missing: string[] }) {
  return <div style={st(S_PAGE)}>
    <div style={st('flex:1')} />
    <div style={st('display:flex;flex-direction:column;gap:10px')}>
      <div style={st('font-size:13px;font-weight:600;letter-spacing:.08em;color:#E08A2E')}>CONTENTSTATION</div>
      <div style={st('font-size:30px;font-weight:600;line-height:1.1')}>Connect this owner app</div>
      <div style={st('color:#6F6B64;line-height:1.5')}>Add the Firebase project and API settings, then restart the app. For local work, the API runs at port 4310 and Firebase Auth can use the local emulator.</div>
    </div>
    <div style={st('background:#fff;border:1px solid rgba(23,22,20,.08);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:7px')}>
      <div style={st('font-size:13px;font-weight:600')}>MISSING SETTINGS</div>
      {missing.map((name) => <div key={name} style={st('font:13px ui-monospace,SFMono-Regular,monospace;color:#6F6B64')}>{name}</div>)}
    </div>
    <div style={st('font-size:13px;color:#6F6B64')}>Sample data is available only when VITE_DEMO_MODE=true.</div>
    <div style={st('flex:1')} />
  </div>;
}

function Shell() {
  const route = useRoute();
  const { status, me, error, refresh } = useSession();

  // Session gate. Signed out: only sign in and code. Signed in: resume at the onboarding step.
  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'out') {
      if (!AUTH_ROUTES.includes(route.name)) replace(R.start);
      return;
    }
    if (!me) return;
    const step = me.onboarding_step;
    if (AUTH_ROUTES.includes(route.name) || route.name === 'unknown') {
      replace(stepRoute(step));
      return;
    }
    if (step !== 'done' && !ONBOARDING_ROUTES.includes(route.name)) replace(stepRoute(step));
  }, [status, me, route]);

  if (status === 'loading') return null;

  if (status === 'out') {
    if (route.name === 'code') return <Code />;
    if (route.name === 'start') return <SignIn />;
    return null;
  }

  if (!me) {
    return (
      <div style={st(S_PAGE)}>
        <div style={st('flex:1')} />
        <div style={st(S_ERROR)}>{error ?? "Couldn't load your shop. Check your connection and try again."}</div>
        <Button onClick={() => void refresh()}>Try again</Button>
      </div>
    );
  }

  const step = me.onboarding_step;
  if (AUTH_ROUTES.includes(route.name) || route.name === 'unknown') return null;
  if (step !== 'done' && !ONBOARDING_ROUTES.includes(route.name)) return null;

  const tab = NAV_TABS[route.name];
  return (
    <>
      {screenFor(route)}
      {tab && <BottomNav active={tab} />}
    </>
  );
}

function screenFor(route: Route) {
  switch (route.name) {
    case 'shop':
      return <Shop />;
    case 'wifi':
      return <Wifi flow="onboarding" />;
    case 'qr':
      return <Qr flow="onboarding" />;
    case 'frame':
      return <Frame flow="onboarding" />;
    case 'hours':
      return <Hours />;
    case 'done':
      return <Done />;
    case 'home':
      return <Home />;
    case 'clip':
      return <ClipDetail key={route.id} id={route.id} />;
    case 'camera':
      return <Camera />;
    case 'cameraFrame':
      return <Frame flow="framing" />;
    case 'rescan':
      return <Rescan />;
    case 'rescanWifi':
      return <Wifi flow="rescan" />;
    case 'rescanQr':
      return <Qr flow="rescan" />;
    case 'replace':
      return <Replace />;
    case 'settings':
      return <Settings />;
    default:
      return null;
  }
}
