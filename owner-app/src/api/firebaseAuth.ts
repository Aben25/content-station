import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import type { OwnerConfig } from './config';
import type { AuthAdapter, AuthUserAdapter } from './firebase';

export function phoneAuthErrorMessage(error: unknown, fallback = "Couldn't sign in. Please try again."): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  switch (code) {
    case 'auth/invalid-verification-code': return "That code didn't match. Try again or text a new one.";
    case 'auth/code-expired':
    case 'auth/session-expired': return 'That code has expired. Text a new code and try again.';
    case 'auth/missing-verification-id': return 'Text a new code before trying again.';
    case 'auth/too-many-requests': return 'Too many attempts. Wait a while before trying again.';
    case 'auth/quota-exceeded': return "We can't send another code right now. Please try again later.";
    case 'auth/network-request-failed': return 'Check your connection and try again.';
    case 'auth/operation-in-progress': return 'Please wait for the current sign-in step to finish.';
    case 'auth/captcha-check-failed': return "The security check didn't finish. Please try again.";
    default: return fallback;
  }
}

function authError(code: string): Error & { code: string } {
  return Object.assign(new Error(phoneAuthErrorMessage({ code })), { code });
}

export function createFirebaseAuthAdapter(config: Extract<OwnerConfig, { mode: 'firebase' }>): AuthAdapter {
  const auth = getAuth(initializeApp(config.firebase));
  if (config.authEmulatorUrl) connectAuthEmulator(auth, config.authEmulatorUrl, { disableWarnings: true });
  let confirmation: ConfirmationResult | null = null;
  let verifier: RecaptchaVerifier | null = null;
  let inFlight = false;
  return {
    get currentUser() { return auth.currentUser as AuthUserAdapter | null; },
    waitUntilReady: () => auth.authStateReady(),
    async sendOtp(phone: string) {
      if (inFlight) throw authError('auth/operation-in-progress');
      inFlight = true;
      confirmation = null;
      try {
        // The anchor lives outside routed screens. Firebase resets its one-use challenge
        // after each phone verification attempt; reuse this widget instead of rendering
        // another invisible widget into an element that reCAPTCHA already owns.
        verifier ??= new RecaptchaVerifier(auth, 'firebase-recaptcha', { size: 'invisible' });
        confirmation = await signInWithPhoneNumber(auth, phone, verifier);
      } finally { inFlight = false; }
    },
    async verifyOtp(code: string) {
      if (inFlight) throw authError('auth/operation-in-progress');
      if (!confirmation) throw authError('auth/missing-verification-id');
      inFlight = true;
      try {
        const result = await confirmation.confirm(code);
        confirmation = null;
        return result.user as AuthUserAdapter;
      } finally { inFlight = false; }
    },
    async signOut() {
      if (inFlight) throw authError('auth/operation-in-progress');
      confirmation = null;
      await auth.signOut();
    },
  };
}
