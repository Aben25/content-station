import type { DayKey, Hours, ShopType } from '../api/types';

export const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_SHORT: Record<DayKey, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const DAY_LONG: Record<DayKey, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const JS_DAY: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const DEFAULT_HOURS: Hours = {
  mon: { open: '09:00', close: '19:00' },
  tue: { open: '09:00', close: '19:00' },
  wed: { open: '09:00', close: '19:00' },
  thu: { open: '09:00', close: '19:00' },
  fri: { open: '09:00', close: '19:00' },
  sat: { open: '09:00', close: '19:00' },
  sun: null,
};

export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function safeTz(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

// Newer ICU puts a narrow no-break space before AM/PM. The prototype uses a plain space.
function plainSpaces(s: string): string {
  return s.replace(/[\u202f\u00a0]/g, ' ');
}

export function toDate(v: string | number | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

// "3:00 PM"
export function timeOfDay(v: string | number | Date, tz: string): string {
  return plainSpaces(new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: safeTz(tz) }).format(toDate(v)));
}

export interface LocalParts {
  year: number;
  month: number; // 1 to 12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: DayKey;
}

export function localParts(v: string | number | Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(toDate(v));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wd = get('weekday').slice(0, 3).toLowerCase() as DayKey;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: DAY_KEYS.includes(wd) ? wd : 'mon',
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

// "YYYY-MM-DD" in shop local time
export function dateKey(v: string | number | Date, tz: string): string {
  const p = localParts(v, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function todayKey(tz: string, now: Date = new Date()): string {
  return dateKey(now, tz);
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekdayOfKey(key: string): DayKey {
  const [y, m, d] = key.split('-').map(Number);
  return JS_DAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// Shop local wall clock to an instant. Two passes handle DST edges.
export function zonedToDate(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = localParts(guess, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += target - asUtc;
  }
  return new Date(guess);
}

export function keyAtTime(key: string, hhmm: string, tz: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  return zonedToDate(y, m, d, h || 0, min || 0, tz);
}

// Next opening time starting tomorrow (the "rest of today" pause resumes here).
export function nextOpening(hours: Hours | null | undefined, tz: string, now: Date = new Date()): Date | null {
  const h = hours ?? DEFAULT_HOURS;
  const today = dateKey(now, tz);
  for (let i = 1; i <= 7; i++) {
    const key = addDays(today, i);
    const dh = h[weekdayOfKey(key)];
    if (dh) return keyAtTime(key, dh.open, tz);
  }
  return null;
}

// Next time the shop opens, today included, for the idle state.
export function nextOpeningFromNow(hours: Hours | null | undefined, tz: string, now: Date = new Date()): Date | null {
  const h = hours ?? DEFAULT_HOURS;
  const today = dateKey(now, tz);
  for (let i = 0; i <= 7; i++) {
    const key = addDays(today, i);
    const dh = h[weekdayOfKey(key)];
    if (!dh) continue;
    const t = keyAtTime(key, dh.open, tz);
    if (t.getTime() > now.getTime()) return t;
  }
  return null;
}

// "3:00 PM" | "tomorrow 9:00 AM" | "Monday 9:00 AM"
// With at: "at 3:00 PM" | "tomorrow at 9:00 AM" | "Monday at 9:00 AM"
export function whenLabel(target: string | number | Date, tz: string, opts: { at?: boolean; now?: Date } = {}): string {
  const now = opts.now ?? new Date();
  const t = timeOfDay(target, tz);
  const tk = dateKey(target, tz);
  const nk = dateKey(now, tz);
  if (tk === nk) return opts.at ? `at ${t}` : t;
  if (tk === addDays(nk, 1)) return opts.at ? `tomorrow at ${t}` : `tomorrow ${t}`;
  const wd = DAY_LONG[weekdayOfKey(tk)];
  return opts.at ? `${wd} at ${t}` : `${wd} ${t}`;
}

// "today" | "yesterday" | "Monday" relative to now, for "Seen today, 11:40 AM"
export function dayWord(target: string | number | Date, tz: string, now: Date = new Date()): string {
  const tk = dateKey(target, tz);
  const nk = dateKey(now, tz);
  if (tk === nk) return 'today';
  if (tk === addDays(nk, -1)) return 'yesterday';
  return DAY_LONG[weekdayOfKey(tk)];
}

// "Today" | "Yesterday" | "Monday" for a YYYY-MM-DD key
export function dayTitle(key: string, tz: string, now: Date = new Date()): string {
  const nk = dateKey(now, tz);
  if (key === nk) return 'Today';
  if (key === addDays(nk, -1)) return 'Yesterday';
  return DAY_LONG[weekdayOfKey(key)];
}

// "Just now" inside a minute, "2:14 PM" same day, "Yesterday, 2:14 PM", "Monday, 2:14 PM"
export function seenLabel(iso: string | null | undefined, tz: string, now: Date = new Date()): string {
  if (!iso) return 'Never';
  const t = toDate(iso);
  if (now.getTime() - t.getTime() < 60_000) return 'Just now';
  const word = dayWord(t, tz, now);
  const time = timeOfDay(t, tz);
  if (word === 'today') return time;
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}, ${time}`;
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

// 8 -> "8 AM", 13 -> "1 PM", 0 -> "12 AM"
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${h < 12 ? 'AM' : 'PM'}`;
}

// "09:00" -> "9:00 AM" (long) or "9" (short, "9:30" when minutes are set)
export function clockLabel(hhmm: string, style: 'long' | 'short' = 'long'): string {
  const [h, m] = hhmm.split(':').map(Number);
  const hh = ((h % 24) + 24) % 24;
  const twelve = hh % 12 === 0 ? 12 : hh % 12;
  if (style === 'short') return m ? `${twelve}:${pad(m)}` : `${twelve}`;
  return `${twelve}:${pad(m || 0)} ${hh < 12 ? 'AM' : 'PM'}`;
}

interface Run {
  from: DayKey;
  to: DayKey;
  open: string;
  close: string;
}

function runs(hours: Hours): Run[] {
  const out: Run[] = [];
  for (const k of DAY_KEYS) {
    const dh = hours[k];
    if (!dh) continue;
    const last = out[out.length - 1];
    const prevIdx = last ? DAY_KEYS.indexOf(last.to) : -2;
    if (last && prevIdx === DAY_KEYS.indexOf(k) - 1 && last.open === dh.open && last.close === dh.close) {
      last.to = k;
    } else {
      out.push({ from: k, to: k, open: dh.open, close: dh.close });
    }
  }
  return out;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function runDays(r: Run): string {
  return r.from === r.to ? DAY_SHORT[r.from] : `${DAY_SHORT[r.from]} to ${DAY_SHORT[r.to]}`;
}

// { line: "Mon to Sat, 9:00 AM to 7:00 PM", closed: "Closed Sunday" }
export function hoursSummary(hours: Hours | null | undefined): { line: string; closed: string | null } {
  const h = hours ?? DEFAULT_HOURS;
  const rs = runs(h);
  const closedDays = DAY_KEYS.filter((k) => !h[k]).map((k) => DAY_LONG[k]);
  if (rs.length === 0) return { line: 'Closed every day', closed: null };
  const allSame = rs.length === 1 && closedDays.length === 0;
  const line = allSame
    ? `Every day, ${clockLabel(rs[0].open)} to ${clockLabel(rs[0].close)}`
    : rs.map((r) => `${runDays(r)}, ${clockLabel(r.open)} to ${clockLabel(r.close)}`).join('. ');
  return { line, closed: closedDays.length ? `Closed ${joinNames(closedDays)}` : null };
}

// "Mon to Sat, 9 to 7"
export function hoursShort(hours: Hours | null | undefined): string {
  const h = hours ?? DEFAULT_HOURS;
  const rs = runs(h);
  if (rs.length === 0) return 'Closed';
  const closedDays = DAY_KEYS.filter((k) => !h[k]);
  if (rs.length === 1 && closedDays.length === 0) return `Every day, ${clockLabel(rs[0].open, 'short')} to ${clockLabel(rs[0].close, 'short')}`;
  return rs.map((r) => `${runDays(r)}, ${clockLabel(r.open, 'short')} to ${clockLabel(r.close, 'short')}`).join('. ');
}

export function dayLabel(k: DayKey, style: 'short' | 'long' = 'short'): string {
  return style === 'short' ? DAY_SHORT[k] : DAY_LONG[k];
}

export function typeLabel(type: ShopType | string | null | undefined): string {
  switch (type) {
    case 'barbershop':
      return 'Barbershop';
    case 'detailing':
      return 'Detailing';
    case 'wrap':
      return 'Wrap shop';
    case 'tattoo':
      return 'Tattoo';
    default:
      return 'Shop';
  }
}

// Lowercase noun for "Typical hours for a {type}"
export function typeNoun(type: ShopType | string | null | undefined): string {
  switch (type) {
    case 'barbershop':
      return 'barbershop';
    case 'detailing':
      return 'detailing shop';
    case 'wrap':
      return 'wrap shop';
    case 'tattoo':
      return 'tattoo shop';
    default:
      return 'shop';
  }
}

// Phone helpers. E.164 for the API, "(415) 555-0198" for display.
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

export function displayPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (local.length === 10) return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  return raw.trim();
}

export function isValidPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

// "2 hours" | "1 hour" | "35 minutes"
export function spanLabel(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  }
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}
