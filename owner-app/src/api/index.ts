import type { Api } from './Api';
import { resolveOwnerConfig } from './config';
import { FirebaseApi } from './firebase';
import { createFirebaseAuthAdapter } from './firebaseAuth';
import { MockApi, mockVariantFromLocation } from './mock';

export const ownerConfig = resolveOwnerConfig(import.meta.env);
export const isMock = ownerConfig.mode === 'demo';
const unconfiguredApi = () => new Proxy({}, { get() { return () => Promise.reject(new Error('ContentStation needs Firebase configuration.')); } }) as Api;
export const api: Api = ownerConfig.mode === 'demo'
  ? new MockApi(mockVariantFromLocation())
  : ownerConfig.mode === 'firebase'
    ? new FirebaseApi(createFirebaseAuthAdapter(ownerConfig), ownerConfig.apiBaseUrl)
    : unconfiguredApi();
