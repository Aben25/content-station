import product from "../../_shared/product.json" with { type: "json" };
import { db } from "../../_shared/db.ts";
import { ApiError, empty, optionalString, readJson, requireString, Router } from "../../_shared/http.ts";
import { requireDevice } from "../../_shared/auth.ts";
import { buildConfig, latestThumbPath, previewPath } from "../../_shared/config.ts";
import { uploadJpeg } from "../../_shared/storage.ts";
import { sendSms, opsAlert } from "../../_shared/sms.ts";
import { ENGINE_API_KEY, ENGINE_WEBHOOK_URL } from "../../_shared/env.ts";
import { DEVICE_STATUSES, type DeviceRow } from "../../_shared/types.ts";

const WIFI = ["strong", "good", "weak", "none"];
const THERMAL = ["nominal", "fair", "serious", "critical"];

function pick(v: unknown, allowed: string[]): string | null {
  return typeof v === "string" && allowed.includes(v) ? v : null;
}

function intOrNull(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : null;
}

async function readImage(req: Request, maxBytes: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) throw new ApiError(400, "empty_image", "No image bytes were sent.");
  if (bytes.length > maxBytes) throw new ApiError(413, "image_too_large", "That image is too large.");
  return bytes;
}

async function notifyMoved(device: DeviceRow, shopId: string): Promise<void> {
  const since = new Date(Date.now() - 6 * 3600000).toISOString();
  const { count } = await db().from("notifications").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("type", "moved").gte("sent_at", since);
  if ((count ?? 0) > 0) return;
  const { data: owner } = await db().from("users").select("id, phone").eq("shop_id", shopId).eq("role", "owner").limit(1).maybeSingle();
  await sendSms({
    shopId,
    userId: owner?.id ?? null,
    type: "moved",
    to: owner?.phone ?? null,
    body: `Camera may have moved. Check the shot. ${product.ownerAppUrl}/#/camera`,
    meta: { device_id: device.id },
  });
}

export function mountDevice(r: Router) {
  r.post("/device/heartbeat", async ({ req }) => {
    const { device, shop } = await requireDevice(req, { allowUnpaired: true });
    const body = await readJson(req);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      last_seen_at: now,
      battery: intOrNull(body.battery, 0, 100),
      thermal: pick(body.thermal, THERMAL) ?? device.thermal,
      wifi_strength: pick(body.wifi, WIFI) ?? device.wifi_strength,
      storage_free_mb: intOrNull(body.storage_free_mb, 0, 10_000_000),
      recording_seconds_today: intOrNull(body.recording_seconds_today, 0, 200_000) ?? device.recording_seconds_today,
    };
    const appVersion = optionalString(body, "app_version", 30);
    if (appVersion) patch.app_version = appVersion;
    const state = pick(body.state, [...DEVICE_STATUSES]);
    if (state && (device.status === "offline" || device.status !== state)) {
      patch.status = state;
      patch.status_code = optionalString(body, "code", 20) ?? null;
      patch.status_since = now;
    }
    const { data, error } = await db().from("devices").update(patch).eq("id", device.id).select("*").single();
    if (error) throw new Error(`heartbeat update: ${error.message}`);
    await db().from("heartbeats").insert({
      device_id: device.id,
      battery: patch.battery,
      thermal: patch.thermal,
      wifi: patch.wifi_strength,
      storage_free_mb: patch.storage_free_mb,
      state: state ?? device.status,
      thumb_path: device.last_thumb_path,
    });
    return await buildConfig(data as DeviceRow, shop);
  });

  r.get("/device/config", async ({ req, url }) => {
    const { device, shop } = await requireDevice(req, { allowUnpaired: true });
    const since = url.searchParams.get("since");
    const wait = Math.max(0, Math.min(25, Number(url.searchParams.get("wait") ?? "0") || 0));
    if (!since || device.unpaired_at || Date.parse(device.config_updated_at) > Date.parse(since)) {
      return await buildConfig(device, shop);
    }
    const deadline = Date.now() + wait * 1000;
    let current = device;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 1000));
      const { data } = await db().from("devices").select("*").eq("id", device.id).maybeSingle();
      if (!data) break;
      current = data as DeviceRow;
      if (current.unpaired_at || Date.parse(current.config_updated_at) > Date.parse(since)) break;
    }
    const { data: freshShop } = await db().from("shops").select("*").eq("id", shop.id).single();
    return await buildConfig(current, freshShop ?? shop);
  });

  r.post("/device/status", async ({ req }) => {
    const { device } = await requireDevice(req);
    const body = await readJson(req);
    let status = requireString(body, "status", 24);
    let code = optionalString(body, "code", 20) ?? null;
    if (status === "nointernet_long") { status = "nointernet"; code = code ?? "long"; }
    if (!(DEVICE_STATUSES as readonly string[]).includes(status)) throw new ApiError(400, "bad_status", "Unknown device status.");
    const now = new Date().toISOString();
    if (device.status !== status || device.status_code !== code) {
      await db().from("devices").update({ status, status_code: code, status_since: now, last_seen_at: now }).eq("id", device.id);
      if (status === "reframe" && device.status !== "reframe") await notifyMoved(device, device.shop_id);
      if (status === "fault") await opsAlert(device.shop_id, "device_fault", `Device ${device.id} fault ${code ?? "?"}`, { device_id: device.id, code });
    } else {
      await db().from("devices").update({ last_seen_at: now }).eq("id", device.id);
    }
    return { ok: true };
  });

  r.post("/device/segment/upload-url", async ({ req }) => {
    const { device } = await requireDevice(req);
    const body = await readJson(req);
    const start = Date.parse(requireString(body, "start_ts", 40));
    const end = Date.parse(requireString(body, "end_ts", 40));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new ApiError(400, "bad_range", "start_ts and end_ts must be ISO timestamps.");
    const path = `${device.shop_id}/${device.id}/${start}.mp4`;
    const { data, error } = await db().storage.from("segments").createSignedUploadUrl(path, { upsert: true });
    if (error || !data) throw new Error(`signed upload url: ${error?.message}`);
    return { path, upload_url: data.signedUrl, token: data.token, expires_at: new Date(Date.now() + 2 * 3600000).toISOString() };
  });

  r.post("/device/segment/complete", async ({ req }) => {
    const { device } = await requireDevice(req);
    const body = await readJson(req);
    const path = requireString(body, "path", 300);
    if (!path.startsWith(`${device.shop_id}/${device.id}/`)) throw new ApiError(403, "bad_path", "That path does not belong to this camera.");
    const startTs = requireString(body, "start_ts", 40);
    const endTs = requireString(body, "end_ts", 40);
    const start = Date.parse(startTs);
    const end = Date.parse(endTs);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new ApiError(400, "bad_range", "start_ts and end_ts must be ISO timestamps.");
    const deleteAfter = new Date(Math.max(Date.now(), end) + product.rawRetentionHours * 3600000).toISOString();
    const { data: seg, error } = await db()
      .from("segments")
      .upsert({
        device_id: device.id,
        shop_id: device.shop_id,
        path,
        start_ts: new Date(start).toISOString(),
        end_ts: new Date(end).toISOString(),
        bytes: intOrNull(body.bytes, 0, Number.MAX_SAFE_INTEGER) ?? 0,
        width: intOrNull(body.width, 0, 10000),
        height: intOrNull(body.height, 0, 10000),
        fps: intOrNull(body.fps, 0, 240),
        delete_after: deleteAfter,
      }, { onConflict: "path" })
      .select("*")
      .single();
    if (error || !seg) throw new Error(`segment upsert: ${error?.message}`);

    let { data: job } = await db().from("engine_jobs").select("*").eq("segment_id", seg.id).maybeSingle();
    if (!job) {
      const ins = await db().from("engine_jobs").insert({ segment_id: seg.id, shop_id: device.shop_id }).select("*").single();
      if (ins.error) throw new Error(`engine job: ${ins.error.message}`);
      job = ins.data;
      const hook = ENGINE_WEBHOOK_URL();
      if (hook) {
        fetch(hook, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-engine-key": ENGINE_API_KEY() ?? "" },
          body: JSON.stringify({ job_id: job.id, segment: seg }),
          signal: AbortSignal.timeout(5000),
        }).catch((e) => console.warn(`engine webhook failed: ${e?.message ?? e}`));
      }
    }
    return { segment_id: seg.id, job_id: job.id };
  });

  r.post("/device/preview", async ({ req }) => {
    const { device } = await requireDevice(req);
    const bytes = await readImage(req, 2 * 1024 * 1024);
    await uploadJpeg("thumbs", previewPath(device.shop_id, device.id), bytes);
    return empty(204);
  });

  r.post("/device/thumb", async ({ req }) => {
    const { device } = await requireDevice(req);
    const bytes = await readImage(req, 1024 * 1024);
    const path = latestThumbPath(device.shop_id, device.id);
    await uploadJpeg("thumbs", path, bytes);
    await db().from("devices").update({ last_thumb_path: path }).eq("id", device.id);
    return empty(204);
  });
}
