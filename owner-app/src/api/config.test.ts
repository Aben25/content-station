import { describe, expect, it } from 'vitest';
import { resolveOwnerConfig } from './config';

const firebase = {
  VITE_FIREBASE_API_KEY: 'key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo.local',
  VITE_FIREBASE_PROJECT_ID: 'contentstation-local',
  VITE_API_BASE_URL: 'http://127.0.0.1:4310',
};

describe('owner configuration', () => {
  it('uses the mock only when demo mode is explicitly true', () => {
    expect(resolveOwnerConfig({ VITE_DEMO_MODE: 'true' })).toEqual({ mode: 'demo' });
    expect(resolveOwnerConfig({ VITE_DEMO_MODE: 'false' }).mode).toBe('setup');
  });

  it('uses Firebase only with every required setting', () => {
    expect(resolveOwnerConfig(firebase)).toMatchObject({ mode: 'firebase', apiBaseUrl: 'http://127.0.0.1:4310' });
  });

  it('reports missing settings instead of silently serving sample data', () => {
    expect(resolveOwnerConfig({ VITE_FIREBASE_API_KEY: 'key' })).toEqual({
      mode: 'setup',
      missing: ['VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_API_BASE_URL'],
    });
  });
});
