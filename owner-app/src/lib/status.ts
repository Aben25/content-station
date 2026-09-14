import type { CameraStatus, Thermal, WifiStrength } from '../api/types';
import product from '../product.json';
import { hourLabel, hoursShort, nextOpeningFromNow, seenLabel, timeOfDay, whenLabel } from './format';

export type StatusKind = 'recording' | 'offline' | 'attention' | 'paused';

export interface StatusView {
  kind: StatusKind;
  color: string;
  bg: string;
  title: string;
  sub: string;
  short: string;
  wifi: string;
  thermal: string;
  seen: string;
  records: string;
  isPaused: boolean;
}

const COLORS: Record<StatusKind, { color: string; bg: string }> = {
  recording: { color: '#2F8F5B', bg: '#E6F0E9' },
  offline: { color: '#D9A21B', bg: '#F6EEDB' },
  attention: { color: '#C94B32', bg: '#F5E3DE' },
  paused: { color: '#D9A21B', bg: '#F6EEDB' },
};

export function wifiWord(w: WifiStrength | string): string {
  switch (w) {
    case 'strong':
      return 'Strong';
    case 'good':
      return 'Good';
    case 'weak':
      return 'Weak';
    default:
      return 'None';
  }
}

export function thermalWord(t: Thermal | string): string {
  switch (t) {
    case 'fair':
      return 'Warm';
    case 'serious':
      return 'Hot';
    case 'critical':
      return 'Cooling down';
    default:
      return 'Normal';
  }
}

// "tomorrow at 8 AM" from next_delivery_at, or the product delivery hour when the server gave none.
export function deliveryLabel(cs: Pick<CameraStatus, 'next_delivery_at' | 'timezone'> | null, now: Date = new Date()): string {
  const fallback = `tomorrow at ${hourLabel(product.deliveryHourLocal)}`;
  if (!cs?.next_delivery_at) return fallback;
  const label = whenLabel(cs.next_delivery_at, cs.timezone, { at: true, now });
  // Drop ":00" so "8:00 AM" reads "8 AM" like the prototype.
  return label.replace(/:00 (AM|PM)/, ' $1');
}

// "Paused until 3:00 PM" | "Paused until tomorrow 9:00 AM" | "Paused until you resume"
export function pausedUntilLabel(cs: CameraStatus, now: Date = new Date()): { plain: string; at: string } {
  if (cs.pause_mode === 'indefinite' || !cs.paused_until) return { plain: 'you resume', at: 'when you resume' };
  return {
    plain: whenLabel(cs.paused_until, cs.timezone, { now }),
    at: whenLabel(cs.paused_until, cs.timezone, { at: true, now }),
  };
}

export function statusView(cs: CameraStatus, now: Date = new Date()): StatusView {
  const tz = cs.timezone;
  const base = {
    wifi: wifiWord(cs.wifi),
    thermal: thermalWord(cs.thermal),
    seen: seenLabel(cs.last_seen_at, tz, now),
    records: hoursShort(cs.hours),
  };
  const make = (kind: StatusKind, title: string, sub: string, short: string): StatusView => ({
    kind,
    ...COLORS[kind],
    title,
    sub,
    short,
    ...base,
    isPaused: kind === 'paused',
  });

  switch (cs.status) {
    case 'paused': {
      const until = pausedUntilLabel(cs, now);
      const sub = cs.pause_mode === 'indefinite' || !cs.paused_until ? 'Nothing is being filmed.' : `Nothing is being filmed. Recording resumes on its own ${until.at}.`;
      return make('paused', `Paused until ${until.plain}`, sub, `Paused until ${until.plain}`);
    }
    case 'nointernet':
    case 'offline': {
      const since = timeOfDay(cs.status_since, tz);
      return make(
        'offline',
        `No internet since ${since}`,
        'The camera is buffering footage and will upload when it reconnects. If your Wi-Fi changed, re-scan the QR.',
        `No internet since ${since}`,
      );
    }
    case 'reframe':
      return make('attention', 'Needs attention', 'The camera may have moved. Check the shot and adjust the arm.', 'Needs attention');
    case 'hot':
      return make('attention', 'Needs attention', 'The camera is too hot and stopped filming. It starts again on its own once it cools down.', 'Needs attention');
    case 'fault':
      return make(
        'attention',
        'Needs attention',
        `The camera stopped${cs.status_code ? ` with code ${cs.status_code}` : ''}. Restart the camera app${product.supportPhoneDisplay ? ` or call ${product.supportPhoneDisplay}` : ''}.`,
        'Needs attention',
      );
    case 'idle': {
      const next = nextOpeningFromNow(cs.hours, tz, now);
      const when = next ? whenLabel(next, tz, { now }) : null;
      const whenAt = next ? whenLabel(next, tz, { at: true, now }) : null;
      return make(
        'recording',
        when ? `Closed until ${when}` : 'Closed',
        whenAt ? `Nothing is filmed outside your hours. Recording starts on its own ${whenAt}.` : 'Nothing is filmed outside your hours.',
        when ? `Closed until ${when}` : 'Closed',
      );
    }
    case 'waiting':
    case 'reading':
    case 'connecting':
      return make('recording', 'Waiting for the camera', 'The camera is not connected yet. Re-scan the QR to connect it.', 'Waiting for the camera');
    case 'framing':
      return make('recording', 'Checking the shot', 'Live preview is on. Tap Check the shot to adjust the arm.', 'Checking the shot');
    case 'recording':
    default: {
      const since = timeOfDay(cs.status_since, tz);
      return make('recording', `Recording since ${since}`, `Filming ${cs.workstation}. Check Clips after footage is processed.`, 'Recording');
    }
  }
}
