// Camera pairing: owner-issued codes, device claim and status.
import type { Ctx } from "../context.js";
import jwt from "jsonwebtoken";
import type { Row } from "../lib/types.js";
import { fail } from "../lib/errors.js";
import { hash, str } from "../lib/validate.js";
import { product } from "../lib/product.js";
import { randomUUID, randomBytes } from "node:crypto";

export function registerPairing(ctx: Ctx) {
  const { app, now, iso, db, deviceSecret, collection, get, ownerShop, body, config } = ctx;
  app.post("/pair/token", async (r) => {
    const { shop } = await ownerShop(r),
      b = body(r);
    const ssid = str(b.ssid, "Wi-Fi name", 64),
      password =
        typeof b.password === "string" && b.password.length <= 256
          ? b.password
          : fail(400, "invalid_input", "Provide the Wi-Fi password.");
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const token = Array.from(randomBytes(12), (n) => alphabet[n % 32]).join("");
    const expires_at = new Date(
      now() + product.pairTokenMinutes * 60000,
    ).toISOString();
    await db.runTransaction(async (tx) => {
      const sr = collection("shops").doc(shop.id),
        fresh = await tx.get(sr);
      const prior = fresh.data()?.pair_token_hash;
      if (prior) tx.delete(collection("pair_tokens").doc(prior));
      tx.create(collection("pair_tokens").doc(hash(token)), {
        shop_id: shop.id,
        state: "waiting",
        expires_at,
        created_at: iso(),
        device_id: null,
        serial: null,
      });
      tx.update(sr, { pair_token_hash: hash(token) });
    });
    return {
      pair_token: token,
      expires_at,
      qr_payload: Buffer.from(
        JSON.stringify({ v: 1, ssid, password, pair_token: token }),
      ).toString("base64"),
    };
  });
  app.get("/pair/status", async (r) => {
    const { shop } = await ownerShop(r),
      t = str((r.query as Row).pair_token, "pair token", 40),
      p = await get("pair_tokens", hash(t));
    if (!p || p.shop_id !== shop.id)
      fail(404, "pair_missing", "Create a new pairing code.");
    return {
      state: p!.device_id
        ? "connected"
        : Date.parse(p!.expires_at) <= now()
          ? "expired"
          : p!.state,
      ...(p!.device_id ? { device_id: p!.device_id } : {}),
    };
  });
  app.post("/pair/reading", async (r) => {
    const id = hash(str(body(r).pair_token, "pair token", 40));
    await db.runTransaction(async (tx) => {
      const ref = collection("pair_tokens").doc(id),
        p = await tx.get(ref);
      if (!p.exists || Date.parse(p.data()!.expires_at) <= now())
        fail(410, "pair_expired", "Create a new pairing code.");
      if (!p.data()!.device_id) tx.update(ref, { state: "reading" });
    });
    return { ok: true };
  });
  app.post("/pair/claim", async (r) => {
    const b = body(r),
      token = str(b.pair_token, "pair token", 40),
      serial = str(b.serial, "device serial", 128),
      newId = randomUUID();
    const d = await db.runTransaction(async (tx) => {
      const pr = collection("pair_tokens").doc(hash(token)),
        p = await tx.get(pr);
      if (!p.exists) fail(410, "pair_expired", "Create a new pairing code.");
      const row = p.data()!;
      const sr = collection("shops").doc(row.shop_id),
        shopSnap = await tx.get(sr);
      if (row.device_id) {
        const existing = await tx.get(collection("devices").doc(row.device_id));
        if (
          row.serial === serial &&
          existing.exists &&
          !existing.data()!.unpaired_at &&
          shopSnap.data()?.device_id === row.device_id
        )
          return { ...existing.data(), id: existing.id } as Row;
        fail(409, "pair_used", "This pairing code has already been used.");
      }
      if (Date.parse(row.expires_at) <= now())
        fail(410, "pair_expired", "Create a new pairing code.");
      const oldId = shopSnap.data()?.device_id || shopSnap.data()?.replacement_context?.previous_device_id;
      const old = oldId ? await tx.get(collection("devices").doc(oldId)) : null;
      const prior = old?.exists && old.data()!.shop_id === row.shop_id ? old.data()! : null;
      const d: Row = {
        id: newId,
        shop_id: row.shop_id,
        serial,
        model: typeof b.model === "string" ? b.model.slice(0, 100) : null,
        app_version:
          typeof b.app_version === "string" ? b.app_version.slice(0, 40) : null,
        status: "framing",
        status_since: iso(),
        created_at: iso(),
        last_seen_at: iso(),
        config_updated_at: iso(),
        pause_mode: "none",
        paused_until: null,
        framing_until: new Date(now() + 10 * 60000).toISOString(),
        reference_frame_path: prior?.reference_frame_path || null,
        reference_frame_revision: prior?.reference_frame_revision || null,
        unpaired_at: null,
        token_version: randomUUID(),
      };
      if (prior && old)
        tx.update(old.ref, { unpaired_at: iso(), config_updated_at: iso() });
      tx.create(collection("devices").doc(newId), d);
      tx.update(sr, { device_id: newId, replacement_context: null });
      tx.update(pr, {
        device_id: newId,
        serial,
        state: "connected",
        claimed_at: iso(),
      });
      return d;
    });
    const shop = (await get("shops", d.shop_id))!;
    const device_jwt = jwt.sign(
      {
        sub: d.id,
        shop_id: d.shop_id,
        role: "device",
        token_version: d.token_version,
      },
      deviceSecret,
      { algorithm: "HS256", expiresIn: "365d" },
    );
    return {
      device_jwt,
      device_id: d.id,
      shop: {
        id: shop.id,
        name: shop.name,
        type: shop.type,
        workstation: shop.workstation,
      },
      config: await config(d),
    };
  });
}
