// Input validation and constant-time comparison helpers.
import { createHash, timingSafeEqual } from "node:crypto";
import { fail } from "./errors.js";
import { DEFAULT_HOURS } from "./time.js";

export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const equal = (a: unknown, b: string) =>
  typeof a === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const str = (v: any, name: string, max = 256) =>
  typeof v === "string" && v.trim() && v.length <= max
    ? v.trim()
    : fail(400, "invalid_input", `Provide a valid ${name}.`);
export const finite = (v: any, name: string, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : fail(400, "invalid_input", `Provide a valid ${name}.`);
export const timestamp = (v: any) => {
  const s = str(v, "timestamp", 40);
  return Number.isFinite(Date.parse(s))
    ? new Date(s).toISOString()
    : fail(400, "invalid_input", "Provide a valid timestamp.");
};
export function validateHours(v: any) {
  if (!v || typeof v !== "object" || Array.isArray(v))
    fail(400, "invalid_hours", "Provide weekly opening hours.");
  for (const d of Object.keys(DEFAULT_HOURS)) {
    if (!(d in v)) fail(400, "invalid_hours", "Provide all seven days.");
    const h = v[d];
    if (
      h !== null &&
      (!h ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(h.open) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(h.close))
    )
      fail(400, "invalid_hours", "Use valid opening and closing times.");
  }
  return Object.fromEntries(
    Object.keys(DEFAULT_HOURS).map((d) => [
      d,
      v[d] === null ? null : { open: v[d].open, close: v[d].close },
    ]),
  );
}
