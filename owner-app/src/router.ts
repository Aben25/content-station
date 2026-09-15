import { useEffect, useState } from 'react';
import type { OnboardingStep } from './api/types';

// Hash routes from docs/CONTRACT.md section 8.
export const R = {
  start: '/start',
  code: '/code',
  shop: '/onboarding/shop',
  wifi: '/onboarding/wifi',
  qr: '/onboarding/qr',
  frame: '/onboarding/frame',
  hours: '/onboarding/hours',
  done: '/onboarding/done',
  home: '/home',
  clip: (id: string) => `/clips/${encodeURIComponent(id)}`,
  camera: '/camera',
  cameraFrame: '/camera/frame',
  rescan: '/camera/rescan',
  rescanWifi: '/camera/rescan/wifi',
  rescanQr: '/camera/rescan/qr',
  replace: '/camera/replace',
  settings: '/settings',
  accounts: '/accounts',
} as const;

export type Route =
  | { name: 'start' }
  | { name: 'code' }
  | { name: 'shop' }
  | { name: 'wifi' }
  | { name: 'qr' }
  | { name: 'frame' }
  | { name: 'hours' }
  | { name: 'done' }
  | { name: 'home' }
  | { name: 'clip'; id: string }
  | { name: 'camera' }
  | { name: 'cameraFrame' }
  | { name: 'rescan' }
  | { name: 'rescanWifi' }
  | { name: 'rescanQr' }
  | { name: 'replace' }
  | { name: 'settings' }
  | { name: 'accounts' }
  | { name: 'unknown' };

const STATIC: Record<string, Route['name']> = {
  '/start': 'start',
  '/code': 'code',
  '/onboarding/shop': 'shop',
  '/onboarding/wifi': 'wifi',
  '/onboarding/qr': 'qr',
  '/onboarding/frame': 'frame',
  '/onboarding/hours': 'hours',
  '/onboarding/done': 'done',
  '/home': 'home',
  '/camera': 'camera',
  '/camera/frame': 'cameraFrame',
  '/camera/rescan': 'rescan',
  '/camera/rescan/wifi': 'rescanWifi',
  '/camera/rescan/qr': 'rescanQr',
  '/camera/replace': 'replace',
  '/settings': 'settings',
  '/accounts': 'accounts',
};

export function parseHash(hash: string): Route {
  let path = hash.replace(/^#/, '');
  const q = path.indexOf('?');
  if (q >= 0) path = path.slice(0, q);
  path = path.replace(/\/+$/, '') || '/';
  const name = STATIC[path];
  if (name && name !== 'clip' && name !== 'unknown') return { name } as Route;
  const m = path.match(/^\/clips\/([^/]+)$/);
  if (m) return { name: 'clip', id: decodeURIComponent(m[1]) };
  return { name: 'unknown' };
}

export const ONBOARDING_ROUTES: Route['name'][] = ['shop', 'wifi', 'qr', 'frame', 'hours', 'done'];
export const AUTH_ROUTES: Route['name'][] = ['start', 'code'];

export function stepRoute(step: OnboardingStep): string {
  switch (step) {
    case 'shop':
      return R.shop;
    case 'wifi':
      return R.wifi;
    case 'qr':
      return R.qr;
    case 'frame':
      return R.frame;
    case 'hours':
      return R.hours;
    case 'done':
    default:
      return R.home;
  }
}

// Query string carried inside the hash, for example "#/accounts?added=facebook".
export function hashQuery(hash: string = location.hash): URLSearchParams {
  const q = hash.indexOf('?');
  return new URLSearchParams(q >= 0 ? hash.slice(q + 1) : '');
}

export function currentPath(): string {
  return location.hash.replace(/^#/, '') || '/';
}

export function navigate(path: string): void {
  if (currentPath() === path) return;
  location.hash = path;
}

export function replace(path: string): void {
  if (currentPath() === path) return;
  history.replaceState(null, '', `#${path}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
