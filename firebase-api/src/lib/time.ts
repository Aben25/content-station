// Shop-local time helpers. Timezones come from the shop record.
import type { Row } from "./types.js";

export const DEFAULT_HOURS = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
    d,
    d === "sun" ? null : { open: "09:00", close: "19:00" },
  ]),
);
export function localParts(ms: number, timezone: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(ms)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
}
export function localDate(ms: number, timezone: string) {
  const p = localParts(ms, timezone);
  return `${p.year}-${p.month}-${p.day}`;
}
export function nextOpening(ms: number, shop: Row) {
  const today = localDate(ms, shop.timezone);
  for (let i = 1; i <= 8 * 24 * 60; i++) {
    const at = Math.floor(ms / 60000) * 60000 + i * 60000;
    const p = localParts(at, shop.timezone);
    if (`${p.year}-${p.month}-${p.day}` === today) continue;
    const h = (shop.hours || DEFAULT_HOURS)[p.weekday.toLowerCase()];
    if (h && `${p.hour}:${p.minute}` === h.open) return at;
  }
  return ms + 24 * 3600000;
}
