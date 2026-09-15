import type { ChannelState, Publication, PublicationChannel } from '../api/types';
import { localParts, whenLabel, zonedToDate } from './format';

export const CANCELLABLE: ChannelState[] = ['pending', 'queued', 'uncertain'];

export function canCancel(p: Publication): boolean {
  return !p.cancel_requested && p.channels.some((c) => CANCELLABLE.includes(c.state));
}

// One line per channel: "Published" | "Scheduled for tomorrow at 9:00 AM" | "Failed: ..."
export function channelLine(c: PublicationChannel, p: Publication, tz: string, now: Date = new Date()): string {
  switch (c.state) {
    case 'published':
      return 'Published';
    case 'failed':
      return c.error ? `Failed. ${c.error}` : 'Failed.';
    case 'cancelled':
      return c.error ? `Cancelled. ${c.error}` : 'Cancelled';
    case 'uncertain':
      return 'Checking with the publishing service…';
    default:
      if (p.late) return 'Taking longer than expected. Still checking.';
      return p.kind === 'now' && Date.parse(p.scheduled_at) <= now.getTime() + 60_000
        ? 'Publishing…'
        : `Scheduled for ${whenLabel(p.scheduled_at, tz, { at: true, now })}`;
  }
}

export function publicationTitle(p: Publication): string {
  switch (p.state) {
    case 'published':
      return 'Published';
    case 'partial':
      return 'Partly published';
    case 'failed':
      return 'Not published';
    case 'cancelled':
      return 'Cancelled';
    case 'uncertain':
      return 'Checking';
    default:
      return p.kind === 'schedule' ? 'Scheduled' : 'Publishing';
  }
}

// "YYYY-MM-DDTHH:MM" for a datetime-local input, in the shop's timezone.
export function localInputValue(v: string | number | Date, tz: string): string {
  const p = localParts(v, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

// The wall-clock value the owner typed is shop time, not browser time.
export function inputValueToIso(value: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const t = zonedToDate(y, mo, d, h, mi, tz);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
}

export function makeIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
