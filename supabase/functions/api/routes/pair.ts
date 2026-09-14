import product from "../../_shared/product.json" with { type: "json" };
import { db } from "../../_shared/db.ts";
import { ApiError, optionalString, readJson, requireString, Router } from "../../_shared/http.ts";
import { requireShop } from "../../_shared/auth.ts";
import { encryptText, pairToken } from "../../_shared/crypto.ts";
import { signDeviceJwt } from "../../_shared/jwt.ts";
import { activeDevice, buildConfig, referencePath } from "../../_shared/config.ts";
import type { DeviceRow, ShopRow } from "../../_shared/types.ts";

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return btoa(out);
}

async function loadToken(token: string) {
  const { data } = await db().from("pair_tokens").select("*").eq("token", token).maybeSingle();
  return data;
}

function tokenState(row: { used_at: string | null; expires_at: string; state: string }): string {
  if (row.used_at) return "connected";
  if (Date.parse(row.expires_at) < Date.now()) return "expired";
  return row.state;
}

export function mountPair(r: Router) {
  r.post("/pair/token", async ({ req }) => {
    const { user, shop } = await requireShop(req);
    const body = await readJson(req);
    const ssid = requireString(body, "ssid", 64);
    const password = optionalString(body, "password", 128) ?? "";
    const token = pairToken(12);
    const expiresAt = new Date(Date.now() + product.pairTokenMinutes * 60000).toISOString();
    await db().from("pair_tokens").update({ state: "expired" }).eq("shop_id", shop.id).is("used_at", null).eq("state", "waiting");
    const { error } = await db().from("pair_tokens").insert({
      token,
      shop_id: shop.id,
      ssid,
      password_enc: await encryptText(password),
      created_by: user.id,
      expires_at: expiresAt,
    });
    if (error) throw new Error(`create pair token: ${error.message}`);
    const qr_payload = b64(JSON.stringify({ v: 1, ssid, password, pair_token: token }));
    return { pair_token: token, qr_payload, expires_at: expiresAt };
  });

  r.get("/pair/status", async ({ req, url }) => {
    const { shop } = await requireShop(req);
    const token = url.searchParams.get("pair_token") ?? "";
    const row = await loadToken(token);
    if (!row || row.shop_id !== shop.id) throw new ApiError(404, "unknown_token", "That QR is no longer valid. Go back and try again.");
    return { state: tokenState(row), device_id: row.device_id };
  });

  // Called by the wall app the moment it is on Wi-Fi, before claim, so the owner sees "Reading".
  r.post("/pair/reading", async ({ req }) => {
    const body = await readJson(req);
    const token = requireString(body, "pair_token", 32);
    const row = await loadToken(token);
    if (!row || tokenState(row) !== "waiting") return { ok: false };
    await db().from("pair_tokens").update({ state: "reading" }).eq("token", token);
    return { ok: true };
  });

  r.post("/pair/claim", async ({ req }) => {
    const body = await readJson(req);
    const token = requireString(body, "pair_token", 32);
    const serial = requireString(body, "serial", 80);
    const model = optionalString(body, "model", 60) ?? null;
    const appVersion = optionalString(body, "app_version", 30) ?? null;

    const row = await loadToken(token);
    if (!row) throw new ApiError(404, "unknown_token", "That QR is not valid. Re-scan from your phone.");
    if (row.used_at && row.device_id) {
      // Retry after a lost response: same device, same token, hand back the same result.
      const { data: same } = await db().from("devices").select("*").eq("id", row.device_id).eq("serial", serial).maybeSingle();
      if (!same) throw new ApiError(410, "token_used", "That QR was already used. Get a new one from your phone.");
    } else if (Date.parse(row.expires_at) < Date.now()) {
      throw new ApiError(410, "token_expired", "That QR expired. Get a new one from your phone.");
    }

    const { data: shop } = await db().from("shops").select("*").eq("id", row.shop_id).single();
    if (!shop) throw new ApiError(404, "unknown_shop", "That shop no longer exists.");

    const now = new Date().toISOString();
    const previous = await activeDevice(shop.id);
    const { data: existing } = await db().from("devices").select("*").eq("serial", serial).is("unpaired_at", null).maybeSingle();

    let device: DeviceRow;
    if (existing && existing.shop_id === shop.id) {
      const { data, error } = await db()
        .from("devices")
        .update({ model, app_version: appVersion, status: "connecting", status_code: null, status_since: now, paired_at: now, last_seen_at: now, config_updated_at: now })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw new Error(`repair device: ${error.message}`);
      device = data as DeviceRow;
    } else {
      if (existing) await db().from("devices").update({ unpaired_at: now, config_updated_at: now }).eq("id", existing.id);
      const { data, error } = await db()
        .from("devices")
        .insert({ shop_id: shop.id, serial, model, app_version: appVersion, status: "connecting", status_since: now, last_seen_at: now })
        .select("*")
        .single();
      if (error) throw new Error(`create device: ${error.message}`);
      device = data as DeviceRow;
    }

    // Replace camera: the previous phone drops out, framing and hours carry over.
    if (previous && previous.id !== device.id) {
      await db().from("devices").update({ unpaired_at: now, config_updated_at: now }).eq("id", previous.id);
      if (previous.reference_frame_path && !device.reference_frame_path) {
        const dest = referencePath(shop.id, device.id);
        await db().storage.from("thumbs").remove([dest]);
        const cp = await db().storage.from("thumbs").copy(previous.reference_frame_path, dest);
        if (!cp.error) {
          const { data } = await db().from("devices").update({ reference_frame_path: dest }).eq("id", device.id).select("*").single();
          if (data) device = data as DeviceRow;
        }
      }
    }

    await db().from("pair_tokens").update({ used_at: now, state: "connected", device_id: device.id, password_enc: "" }).eq("token", token);

    const device_jwt = await signDeviceJwt(device.id, shop.id);
    const s = shop as ShopRow;
    return {
      device_jwt,
      device_id: device.id,
      shop: { id: s.id, name: s.name, type: s.type, workstation: s.workstation ?? "the work area" },
      config: await buildConfig(device, s),
    };
  });
}
