import product from "../../_shared/product.json" with { type: "json" };
import { db } from "../../_shared/db.ts";
import { Router } from "../../_shared/http.ts";
import { requireCron } from "../../_shared/auth.ts";
import { localParts } from "../../_shared/hours.ts";
import { removeObjects } from "../../_shared/storage.ts";
import { opsAlert, sendSms } from "../../_shared/sms.ts";
import type { Row } from "../../_shared/types.ts";

async function ownerOf(shopId: string): Promise<{ id: string; phone: string | null } | null> {
  const { data } = await db().from("users").select("id, phone").eq("shop_id", shopId).eq("role", "owner").limit(1).maybeSingle();
  return data ?? null;
}

async function alreadySent(shopId: string, type: string, sinceIso: string): Promise<boolean> {
  const { count } = await db().from("notifications").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("type", type).gte("sent_at", sinceIso);
  return (count ?? 0) > 0;
}

async function sentForLocalDate(shopId: string, type: string, localDate: string): Promise<boolean> {
  const { count } = await db().from("notifications").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("type", type).contains("meta", { local_date: localDate });
  return (count ?? 0) > 0;
}

async function offlineSweep(): Promise<number> {
  const cutoff = new Date(Date.now() - product.heartbeatAlertMinutes * 60000).toISOString();
  const { data: stale } = await db()
    .from("devices")
    .select("*")
    .is("unpaired_at", null)
    .not("status", "in", "(offline,waiting,reading,connecting)")
    .lt("last_seen_at", cutoff);
  let n = 0;
  for (const d of (stale ?? []) as Row[]) {
    await db().from("devices").update({ status: "offline", status_code: null, status_since: d.last_seen_at }).eq("id", d.id);
    await opsAlert(d.shop_id, "device_offline", `Device ${d.id} silent since ${d.last_seen_at}`, { device_id: d.id });
    const owner = await ownerOf(d.shop_id);
    await sendSms({
      shopId: d.shop_id,
      userId: owner?.id,
      type: "offline_5m",
      to: owner?.phone ?? null,
      body: `Camera lost internet. Buffering footage. If your Wi-Fi changed, re-scan the QR from the Camera tab. ${product.ownerAppUrl}/#/camera`,
      meta: { device_id: d.id, since: d.last_seen_at },
    });
    n++;
  }
  const twoHours = new Date(Date.now() - 2 * 3600000).toISOString();
  const { data: longOffline } = await db().from("devices").select("*").is("unpaired_at", null).eq("status", "offline").lt("status_since", twoHours);
  for (const d of (longOffline ?? []) as Row[]) {
    if (await alreadySent(d.shop_id, "offline_2h", d.status_since)) continue;
    const owner = await ownerOf(d.shop_id);
    await sendSms({
      shopId: d.shop_id,
      userId: owner?.id,
      type: "offline_2h",
      to: owner?.phone ?? null,
      body: `Camera has been offline for 2 hours. Footage is safe on the phone. Text us at ${product.supportPhoneDisplay} if you need a hand.`,
      meta: { device_id: d.id, since: d.status_since },
    });
  }
  return n;
}

async function retentionSweep(): Promise<number> {
  const now = new Date().toISOString();
  const { data: due } = await db().from("segments").select("id, path").neq("status", "deleted").lt("delete_after", now).limit(100);
  const rows = (due ?? []) as Row[];
  if (rows.length > 0) {
    await removeObjects("segments", rows.map((s) => s.path));
    await db().from("segments").update({ status: "deleted" }).in("id", rows.map((s) => s.id));
  }
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  await db().from("heartbeats").delete().lt("at", weekAgo);
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  await db().from("pair_tokens").delete().lt("expires_at", hourAgo);
  return rows.length;
}

async function dailySweep(): Promise<number> {
  const { data: shops } = await db().from("shops").select("*");
  let sent = 0;
  const now = new Date();
  for (const shop of (shops ?? []) as Row[]) {
    const p = localParts(now, shop.timezone);
    const hour = shop.delivery_hour ?? product.deliveryHourLocal;
    if (p.hh < hour || p.hh >= hour + 2) continue;
    if (await sentForLocalDate(shop.id, "daily", p.dateStr)) continue;
    const owner = await ownerOf(shop.id);

    const { data: fresh } = await db().from("clips").select("id").eq("shop_id", shop.id).eq("status", "new").is("delivered_at", null);
    const count = fresh?.length ?? 0;
    const lastWindowMinute = p.hh === hour + 1 && p.mm >= 58;
    if (count === 0 && !lastWindowMinute) continue;
    if (count > 0) {
      await db().from("clips").update({ delivered_at: now.toISOString() }).in("id", fresh!.map((c) => c.id));
      const noun = count === 1 ? "clip" : "clips";
      await sendSms({
        shopId: shop.id,
        userId: owner?.id,
        type: "daily",
        to: owner?.phone ?? null,
        body: `${count} ${noun} from today. Tap to see. ${product.ownerAppUrl}/#/home`,
        meta: { local_date: p.dateStr, count },
      });
      sent++;
    } else {
      await db().from("notifications").insert({ shop_id: shop.id, type: "daily", channel: "ops", body: "No clips today", meta: { local_date: p.dateStr, count: 0 } });
    }

    const { data: device } = await db().from("devices").select("*").eq("shop_id", shop.id).is("unpaired_at", null).eq("pause_mode", "indefinite").limit(1).maybeSingle();
    if (device && !(await sentForLocalDate(shop.id, "paused_daily", p.dateStr))) {
      await sendSms({
        shopId: shop.id,
        userId: owner?.id,
        type: "paused_daily",
        to: owner?.phone ?? null,
        body: `Camera is still paused. Resume from the Camera tab whenever you're ready. ${product.ownerAppUrl}/#/camera`,
        meta: { local_date: p.dateStr },
      });
    }
  }
  return sent;
}

export function mountCron(r: Router) {
  r.post("/internal/cron/tick", async ({ req }) => {
    requireCron(req);
    const offline = await offlineSweep();
    const retired = await retentionSweep();
    const delivered = await dailySweep();
    return { ok: true, offline, retired, delivered };
  });
}
