// Shop hours and time zone math. Hours JSON shape is in docs/CONTRACT.md section 3.
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type DayHours = { open: string; close: string } | null;
export type Hours = Record<DayKey, DayHours>;

export const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export const DEFAULT_HOURS: Hours = {
  mon: { open: "09:00", close: "19:00" },
  tue: { open: "09:00", close: "19:00" },
  wed: { open: "09:00", close: "19:00" },
  thu: { open: "09:00", close: "19:00" },
  fri: { open: "09:00", close: "19:00" },
  sat: { open: "09:00", close: "19:00" },
  sun: null,
};

export interface LocalParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
  dow: number; // 0 = Sunday
  dateStr: string; // YYYY-MM-DD
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isValidTimezone(tz: string): boolean {
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

export function localParts(date: Date, tz: string): LocalParts {
  const parts = fmt(tz).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));
  let hh = Number(get("hour"));
  if (hh === 24) hh = 0;
  const mm = Number(get("minute"));
  const ss = Number(get("second"));
  const dow = DOW[get("weekday")] ?? 0;
  return { y, m, d, hh, mm, ss, dow, dateStr: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

function offsetMs(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const off1 = offsetMs(new Date(guess), tz);
  let utc = guess - off1;
  const off2 = offsetMs(new Date(utc), tz);
  if (off2 !== off1) utc = guess - off2;
  return new Date(utc);
}

function parseHm(s: string): [number, number] {
  const [h, m] = s.split(":").map(Number);
  return [h || 0, m || 0];
}

function addDays(p: LocalParts, n: number): { y: number; m: number; d: number; dow: number } {
  const t = Date.UTC(p.y, p.m - 1, p.d) + n * 86400000;
  const dt = new Date(t);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay() };
}

export function normalizeHours(input: unknown): Hours | null {
  if (!input || typeof input !== "object") return null;
  const out = { ...DEFAULT_HOURS } as Hours;
  for (const k of DAY_KEYS) {
    const v = (input as Record<string, unknown>)[k];
    if (v === null) { out[k] = null; continue; }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.open === "string" && typeof o.close === "string" && /^\d{2}:\d{2}$/.test(o.open) && /^\d{2}:\d{2}$/.test(o.close)) {
        out[k] = { open: o.open, close: o.close };
        continue;
      }
    }
    return null;
  }
  return out;
}

// Opening and closing instants for a given local day, or null when closed.
export function dayWindow(p: { y: number; m: number; d: number; dow: number }, hours: Hours, tz: string): [Date, Date] | null {
  const dh = hours[DAY_KEYS[p.dow]];
  if (!dh) return null;
  const [oh, om] = parseHm(dh.open);
  const [ch, cm] = parseHm(dh.close);
  const open = zonedToUtc(p.y, p.m, p.d, oh, om, tz);
  let close = zonedToUtc(p.y, p.m, p.d, ch, cm, tz);
  if (close <= open) close = new Date(close.getTime() + 86400000);
  return [open, close];
}

export function isOpen(now: Date, hours: Hours, tz: string): boolean {
  const p = localParts(now, tz);
  for (const back of [1, 0]) {
    const w = dayWindow(addDays(p, -back), hours, tz);
    if (w && now >= w[0] && now < w[1]) return true;
  }
  return false;
}

// The next opening instant strictly after now. Null when the shop never opens.
export function nextOpen(now: Date, hours: Hours, tz: string): Date | null {
  const p = localParts(now, tz);
  for (let i = 0; i < 8; i++) {
    const w = dayWindow(addDays(p, i), hours, tz);
    if (w && w[0] > now) return w[0];
  }
  return null;
}

// UTC range covering one local calendar day.
export function localDayRange(dateStr: string, tz: string): [Date, Date] {
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = zonedToUtc(y, m, d, 0, 0, tz);
  const next = new Date(Date.UTC(y, m - 1, d) + 86400000);
  const end = zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz);
  return [start, end];
}

export function nextDeliveryAt(now: Date, tz: string, hour: number): Date {
  const p = localParts(now, tz);
  let t = zonedToUtc(p.y, p.m, p.d, hour, 0, tz);
  if (t <= now) {
    const n = addDays(p, 1);
    t = zonedToUtc(n.y, n.m, n.d, hour, 0, tz);
  }
  return t;
}
