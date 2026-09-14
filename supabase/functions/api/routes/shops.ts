import product from "../../_shared/product.json" with { type: "json" };
import { db } from "../../_shared/db.ts";
import { ApiError, optionalString, readJson, requireString, Router } from "../../_shared/http.ts";
import { requireOwner, requireShop } from "../../_shared/auth.ts";
import { activeDevice } from "../../_shared/config.ts";
import { DEFAULT_HOURS, isValidTimezone, normalizeHours, type Hours } from "../../_shared/hours.ts";
import { defaultWorkstation, SHOP_TYPES, type ShopRow } from "../../_shared/types.ts";
import { GOOGLE_PLACES_API_KEY } from "../../_shared/env.ts";

function shopType(v: string | undefined): ShopRow["type"] {
  const t = (v ?? "other").toLowerCase();
  const map: Record<string, ShopRow["type"]> = { "wrap shop": "wrap", detail: "detailing", barber: "barbershop" };
  const norm = (map[t] ?? t) as ShopRow["type"];
  if (!(SHOP_TYPES as readonly string[]).includes(norm)) throw new ApiError(400, "bad_shop_type", "Pick a shop type from the list.");
  return norm;
}

function cleanInstagram(v: string | undefined): string | null {
  if (!v) return null;
  return v.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").trim() || null;
}

async function onboardingStep(shop: ShopRow | null): Promise<string> {
  if (!shop) return "shop";
  const device = await activeDevice(shop.id);
  if (!device) return "wifi";
  if (!device.reference_frame_path) return "frame";
  if (!shop.hours) return "hours";
  return "done";
}

async function googleHours(name: string, type: string): Promise<Hours | null> {
  const key = GOOGLE_PLACES_API_KEY();
  if (!key) return null;
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.regularOpeningHours",
      },
      body: JSON.stringify({ textQuery: `${name} ${type}`, maxResultCount: 1 }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const periods = data?.places?.[0]?.regularOpeningHours?.periods as Array<{ open: { day: number; hour: number; minute: number }; close?: { day: number; hour: number; minute: number } }> | undefined;
    if (!periods || periods.length === 0) return null;
    const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
    const out: Hours = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
    const hm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    for (const p of periods) {
      const k = keys[p.open.day];
      if (!k || !p.close) continue;
      if (!out[k]) out[k] = { open: hm(p.open.hour, p.open.minute), close: hm(p.close.hour, p.close.minute) };
    }
    return out;
  } catch {
    return null;
  }
}

export function mountShops(r: Router) {
  r.get("/me", async ({ req }) => {
    const { user, shop } = await requireOwner(req);
    const device = shop ? await activeDevice(shop.id) : null;
    return {
      user: { id: user.id, phone: user.phone, role: user.role },
      shop,
      device: device ? { id: device.id, status: device.status, paired_at: device.paired_at, reference_frame_path: device.reference_frame_path } : null,
      onboarding_step: await onboardingStep(shop),
      product: { name: product.name, delivery_hour: shop?.delivery_hour ?? product.deliveryHourLocal },
    };
  });

  r.post("/shops", async ({ req }) => {
    const { user, shop } = await requireOwner(req);
    const body = await readJson(req);
    const name = requireString(body, "name", 120);
    const type = shopType(optionalString(body, "type", 40));
    const instagram = cleanInstagram(optionalString(body, "instagram", 80));
    const timezone = optionalString(body, "timezone", 64);
    if (timezone && !isValidTimezone(timezone)) throw new ApiError(400, "bad_timezone", "That time zone isn't recognized.");

    if (shop) {
      const patch: Record<string, unknown> = { name, type, instagram };
      if (timezone) patch.timezone = timezone;
      if (!shop.workstation || shop.type !== type) patch.workstation = defaultWorkstation(type);
      const { data, error } = await db().from("shops").update(patch).eq("id", shop.id).select("*").single();
      if (error) throw new Error(`update shop: ${error.message}`);
      return { shop: data };
    }

    const { data, error } = await db()
      .from("shops")
      .insert({ name, type, instagram, phone: user.phone, timezone: timezone ?? "America/Los_Angeles", workstation: defaultWorkstation(type) })
      .select("*")
      .single();
    if (error) throw new Error(`create shop: ${error.message}`);
    const link = await db().from("users").update({ shop_id: data.id, role: "owner" }).eq("id", user.id);
    if (link.error) throw new Error(`link user: ${link.error.message}`);
    return { shop: data };
  });

  r.patch("/shops/current", async ({ req }) => {
    const { shop } = await requireShop(req);
    const body = await readJson(req);
    const patch: Record<string, unknown> = {};
    const name = optionalString(body, "name", 120);
    if (name) patch.name = name;
    const type = optionalString(body, "type", 40);
    if (type) patch.type = shopType(type);
    if ("instagram" in body) patch.instagram = cleanInstagram(optionalString(body, "instagram", 80));
    const timezone = optionalString(body, "timezone", 64);
    if (timezone) {
      if (!isValidTimezone(timezone)) throw new ApiError(400, "bad_timezone", "That time zone isn't recognized.");
      patch.timezone = timezone;
    }
    const workstation = optionalString(body, "workstation", 60);
    if (workstation) patch.workstation = workstation;
    if ("hours" in body) {
      const hours = normalizeHours(body.hours);
      if (!hours) throw new ApiError(400, "bad_hours", "Hours need an open and close time for each day, or Closed.");
      patch.hours = hours;
    }
    if (typeof body.delivery_hour === "number" && body.delivery_hour >= 0 && body.delivery_hour <= 23) patch.delivery_hour = body.delivery_hour;
    if (Object.keys(patch).length === 0) return { shop };
    const { data, error } = await db().from("shops").update(patch).eq("id", shop.id).select("*").single();
    if (error) throw new Error(`patch shop: ${error.message}`);
    return { shop: data };
  });

  r.get("/shop/hours/suggest", async ({ req, url }) => {
    const { shop } = await requireOwner(req);
    const name = url.searchParams.get("name") ?? shop?.name ?? "";
    const type = url.searchParams.get("type") ?? shop?.type ?? "other";
    const found = name ? await googleHours(name, type) : null;
    if (found) return { hours: found, source: "google" };
    return { hours: DEFAULT_HOURS, source: "default" };
  });
}
