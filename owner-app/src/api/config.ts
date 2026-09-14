export type OwnerEnv = Record<string, string | undefined>;
export type OwnerConfig =
  | { mode: 'demo' }
  | { mode: 'setup'; missing: string[] }
  | { mode: 'firebase'; apiBaseUrl: string; firebase: { apiKey: string; authDomain: string; projectId: string }; authEmulatorUrl?: string };
const REQUIRED = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_API_BASE_URL'] as const;
export function resolveOwnerConfig(env: OwnerEnv): OwnerConfig {
  if (env.VITE_DEMO_MODE === 'true') return { mode: 'demo' };
  const missing = REQUIRED.filter((key) => !env[key]?.trim());
  if (missing.length) return { mode: 'setup', missing };
  return { mode: 'firebase', apiBaseUrl: env.VITE_API_BASE_URL!.replace(/\/+$/, ''), firebase: { apiKey: env.VITE_FIREBASE_API_KEY!, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN!, projectId: env.VITE_FIREBASE_PROJECT_ID! }, ...(env.VITE_FIREBASE_AUTH_EMULATOR_URL?.trim() ? { authEmulatorUrl: env.VITE_FIREBASE_AUTH_EMULATOR_URL.trim() } : {}) };
}
