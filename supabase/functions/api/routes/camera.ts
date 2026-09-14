import { db } from "../../_shared/db.ts";
import { ApiError, empty, readJson, requireString, Router } from "../../_shared/http.ts";
import { requireShop } from "../../_shared/auth.ts";
import { activeDevice, bumpConfig, cameraStatus, previewPath, referencePath } from "../../_shared/config.ts";
import { DEFAULT_HOURS, nextOpen, type Hours } from "../../_shared/hours.ts";
import type { ShopRow } from "../../_shared/types.ts";

async function requireCamera(req: Request) {
  const ctx = await requireShop(req);
  const device = await activeDevice(ctx.shop.id);
  if (!device) throw new ApiError(404, "no_device", "No camera is paired yet. Start setup from your phone.");
  return { ...ctx, device };
}

function shopHours(shop: ShopRow): Hours {
  return (shop.hours as Hours | null) ?? DEFAULT_HOURS;
}

export function mountCamera(r: Router) {
  r.get("/camera/status", async ({ req }) => {
    const { device, shop } = await requireCamera(req);
    return await cameraStatus(device, shop);
  });

  r.post("/camera/pause", async ({ req }) => {
    const { device, shop } = await requireCamera(req);
    const body = await readJson(req);
    const until = requireString(body, "until", 12);
    const now = new Date();
    let pause_mode: string;
    let paused_until: string | null;
    if (until === "1h") {
      pause_mode = "1h";
      paused_until = new Date(now.getTime() + 3600000).toISOString();
    } else if (until === "today") {
      const next = nextOpen(now, shopHours(shop), shop.timezone);
      pause_mode = next ? "today" : "indefinite";
      paused_until = next ? next.toISOString() : null;
    } else if (until === "indefinite") {
      pause_mode = "indefinite";
      paused_until = null;
    } else {
      throw new ApiError(400, "bad_until", "Choose 1h, today, or indefinite.");
    }
    const updated = await bumpConfig(device.id, { pause_mode, paused_until, status: "paused", status_code: null, status_since: now.toISOString() });
    return await cameraStatus(updated, shop);
  });

  r.post("/camera/resume", async ({ req }) => {
    const { device, shop } = await requireCamera(req);
    const patch: Record<string, unknown> = { pause_mode: "none", paused_until: null };
    if (device.status === "paused") {
      patch.status = "recording";
      patch.status_code = null;
      patch.status_since = new Date().toISOString();
    }
    const updated = await bumpConfig(device.id, patch);
    return await cameraStatus(updated, shop);
  });

  r.post("/camera/framing/start", async ({ req }) => {
    const { device } = await requireCamera(req);
    const framing_until = new Date(Date.now() + 10 * 60000).toISOString();
    await bumpConfig(device.id, { framing_until });
    return { framing_until };
  });

  r.get("/camera/preview", async ({ req }) => {
    const { device, shop } = await requireCamera(req);
    const path = previewPath(shop.id, device.id);
    const dir = path.split("/").slice(0, -1).join("/");
    const { data: list } = await db().storage.from("thumbs").list(dir, { search: "preview.jpg", limit: 1 });
    const obj = list?.find((o) => o.name === "preview.jpg");
    if (!obj) return empty(204);
    const { data } = await db().storage.from("thumbs").createSignedUrl(path, 60);
    if (!data) return empty(204);
    return { url: data.signedUrl, captured_at: obj.updated_at ?? obj.created_at ?? null };
  });

  r.post("/camera/reference-frame", async ({ req }) => {
    const { device, shop } = await requireCamera(req);
    const from = previewPath(shop.id, device.id);
    const to = referencePath(shop.id, device.id);
    await db().storage.from("thumbs").remove([to]);
    const cp = await db().storage.from("thumbs").copy(from, to);
    if (cp.error) throw new ApiError(409, "no_preview", "The camera hasn't sent a preview yet. Give it a few seconds and try again.");
    const patch: Record<string, unknown> = { reference_frame_path: to, framing_until: null };
    if (device.status === "reframe" || device.status === "framing") {
      patch.status = "recording";
      patch.status_code = null;
      patch.status_since = new Date().toISOString();
    }
    await bumpConfig(device.id, patch);
    return { reference_frame_path: to };
  });

  r.post("/camera/unpair", async ({ req }) => {
    const { device } = await requireCamera(req);
    await bumpConfig(device.id, { unpaired_at: new Date().toISOString() });
    return { ok: true };
  });
}
