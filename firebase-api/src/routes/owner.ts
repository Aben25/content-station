// Health, owner identity, shop profile and hours.
import type { Ctx } from "../context.js";
import type { Row } from "../lib/types.js";
import { DEFAULT_HOURS } from "../lib/time.js";
import { fail } from "../lib/errors.js";
import { product } from "../lib/product.js";
import { randomUUID } from "node:crypto";
import { str, validateHours } from "../lib/validate.js";

export function registerOwner(ctx: Ctx) {
  const { app, iso, projectId, emulator, db, collection, get, owner, ownerShop, currentDevice, body } = ctx;
  app.get("/health", async () => ({
    ok: true,
    at: iso(),
    backend: "firebase",
    emulator,
    project_id: projectId,
  }));
  for (const p of ["/auth/otp/send", "/auth/otp/verify"])
    app.post(p, async () =>
      fail(
        410,
        "firebase_auth_required",
        "Use Firebase phone authentication to sign in.",
      ),
    );
  app.get("/me", async (r) => {
    const user = await owner(r);
    const m = await get("memberships", user.uid),
      shop = m ? await get("shops", m.shop_id) : null;
    const d = shop ? await currentDevice(shop, false) : null;
    return {
      user: { id: user.uid, phone: user.phone_number || null },
      shop,
      device: d
        ? {
            id: d.id,
            status: d.status,
            reference_frame_path: d.reference_frame_path || null,
          }
        : null,
      onboarding_step: !shop
        ? "shop"
        : !d
          ? "wifi"
          : !d.reference_frame_path
            ? "frame"
            : !shop.hours
              ? "hours"
              : "done",
      replacement_context: shop?.replacement_context || null,
    };
  });
  app.post("/shops", async (r) => {
    const user = await owner(r),
      b = body(r);
    const shop = {
      id: randomUUID(),
      name: str(b.name, "shop name", 120),
      type: str(b.type, "shop type", 80),
      instagram: b.instagram ? str(b.instagram, "Instagram", 100) : null,
      timezone: b.timezone || "America/Los_Angeles",
      hours: null,
      workstation: "chair 1",
      owner_id: user.uid,
      phone: user.phone_number || null,
      device_id: null,
      delivery_hour: product.deliveryHourLocal,
      created_at: iso(),
    };
    try {
      new Intl.DateTimeFormat("en", { timeZone: shop.timezone });
    } catch {
      fail(400, "invalid_timezone", "Choose a valid timezone.");
    }
    return db.runTransaction(async (tx) => {
      const mr = collection("memberships").doc(user.uid),
        m = await tx.get(mr);
      if (m.exists) {
        const existing = await tx.get(
          collection("shops").doc(m.data()!.shop_id),
        );
        return { shop: { ...existing.data(), id: existing.id } };
      }
      tx.create(collection("shops").doc(shop.id), shop);
      tx.create(mr, { shop_id: shop.id, role: "owner", created_at: iso() });
      return { shop };
    });
  });
  app.patch("/shops/current", async (r) => {
    const { shop } = await ownerShop(r),
      b = body(r),
      patch: Row = {};
    for (const k of ["name", "type", "instagram", "timezone"])
      if (k in b) patch[k] = str(b[k], k, 120);
    if (patch.timezone)
      try {
        new Intl.DateTimeFormat("en", { timeZone: patch.timezone });
      } catch {
        fail(400, "invalid_timezone", "Choose a valid timezone.");
      }
    if ("hours" in b) patch.hours = validateHours(b.hours);
    const batch = db.batch();
    batch.update(collection("shops").doc(shop.id), patch);
    if (shop.device_id)
      batch.update(collection("devices").doc(shop.device_id), {
        config_updated_at: iso(),
      });
    await batch.commit();
    return { shop: { ...shop, ...patch } };
  });
  app.get("/shop/hours/suggest", async (r) => {
    await owner(r);
    return { hours: DEFAULT_HOURS, source: "default" };
  });
}
