import type { PairToken } from '../api/types';

// Tiny cross screen state. The pair payload holds the Wi-Fi password, so it stays in memory only.
const PHONE_KEY = 'cs.pending_phone';

export const pending: { pair: PairToken | null } = { pair: null };

export function getPendingPhone(): string {
  try {
    return sessionStorage.getItem(PHONE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setPendingPhone(phone: string): void {
  try {
    sessionStorage.setItem(PHONE_KEY, phone);
  } catch {
    // ignore
  }
}
