import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import type { OwnerConfig } from './config';
import type { AuthAdapter, AuthUserAdapter } from './firebase';
export function createFirebaseAuthAdapter(config: Extract<OwnerConfig, { mode: 'firebase' }>): AuthAdapter {
  const auth = getAuth(initializeApp(config.firebase));
  if (config.authEmulatorUrl) connectAuthEmulator(auth, config.authEmulatorUrl, { disableWarnings: true });
  let confirmation: ConfirmationResult | null = null; let verifier: RecaptchaVerifier | null = null;
  return {
    get currentUser() { return auth.currentUser as AuthUserAdapter | null; }, waitUntilReady: () => auth.authStateReady(),
    async sendOtp(phone: string) { verifier?.clear(); verifier = new RecaptchaVerifier(auth, 'firebase-recaptcha', { size: 'invisible' }); try { confirmation = await signInWithPhoneNumber(auth, phone, verifier); } catch (error) { verifier.clear(); verifier = null; throw error; } },
    async verifyOtp(code: string) { if (!confirmation) throw new Error('Text a new code before trying again.'); return (await confirmation.confirm(code)).user as AuthUserAdapter; },
    signOut: () => auth.signOut(),
  };
}
