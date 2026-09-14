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

const NAV_TABS: Partial<Record<Route['name'], Tab>> = { home: 'home', camera: 'camera', settings: 'settings' };

export default function App() {
  const session = useSessionState();
  return (
    <SessionProvider value={session}>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </SessionProvider>
  );
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
