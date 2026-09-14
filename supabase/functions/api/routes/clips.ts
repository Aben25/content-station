import { db } from "../../_shared/db.ts";
import { ApiError, optionalString, readJson, requireString, Router } from "../../_shared/http.ts";
import { requireShop } from "../../_shared/auth.ts";
import { localDayRange, localParts } from "../../_shared/hours.ts";
import { removeObjects, signedUrl } from "../../_shared/storage.ts";
import type { Row } from "../../_shared/types.ts";

const EVENT_TYPES = ["open", "share", "skip", "report"] as const;

async function present(clip: Row): Promise<Row> {
  let sourceSeconds: number | null = null;
  if (clip.source_start_s != null && clip.source_end_s != null) sourceSeconds = Math.round(Number(clip.source_end_s) - Number(clip.source_start_s));
  return {
    id: clip.id,
    caption: clip.caption,
    duration_s: Number(clip.duration_s),
    status: clip.status,
    created_at: clip.created_at,
    delivered_at: clip.delivered_at,
    video_url: await signedUrl("clips", clip.path, 3600),
    thumb_url: await signedUrl("thumbs", clip.thumb_path, 3600),
    source_seconds: sourceSeconds,
  };
}

async function loadClip(id: string, shopId: string): Promise<Row> {
  const { data } = await db().from("clips").select("*").eq("id", id).eq("shop_id", shopId).maybeSingle();
  if (!data || data.status === "deleted") throw new ApiError(404, "no_clip", "That clip is gone.");
  return data;
}

export function mountClips(r: Router) {
  r.get("/clips", async ({ req, url }) => {
    const { shop } = await requireShop(req);
    const tz = shop.timezone;
    const today = localParts(new Date(), tz).dateStr;
    const date = url.searchParams.get("date") ?? today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, "bad_date", "Use a date like 2026-09-13.");
    const [start, end] = localDayRange(date, tz);
    const { data: rows, error } = await db()
      .from("clips")
      .select("*")
      .eq("shop_id", shop.id)
      .neq("status", "deleted")
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: false });
    if (error) throw new Error(`list clips: ${error.message}`);

    const since = new Date(start.getTime() - 14 * 86400000).toISOString();
    const { data: recent } = await db()
      .from("clips")
      .select("created_at")
      .eq("shop_id", shop.id)
      .neq("status", "deleted")
      .gte("created_at", since)
      .lt("created_at", start.toISOString());
    const counts = new Map<string, number>();
    for (const c of recent ?? []) {
      const d = localParts(new Date(c.created_at), tz).dateStr;
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    const older = [...counts.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 7).map(([d, count]) => ({ date: d, count }));

    return { date, clips: await Promise.all((rows ?? []).map(present)), older };
  });

  r.get("/clips/:id", async ({ req, params }) => {
    const { shop } = await requireShop(req);
    return await present(await loadClip(params.id, shop.id));
  });

  r.patch("/clips/:id", async ({ req, params }) => {
    const { shop } = await requireShop(req);
    await loadClip(params.id, shop.id);
    const body = await readJson(req);
    const caption = (optionalString(body, "caption", 300) ?? "").trim();
    const { data, error } = await db().from("clips").update({ caption }).eq("id", params.id).select("*").single();
    if (error) throw new Error(`caption: ${error.message}`);
    return await present(data);
  });

  r.post("/clips/:id/event", async ({ req, params }) => {
    const { user, shop } = await requireShop(req);
    const clip = await loadClip(params.id, shop.id);
    const body = await readJson(req);
    const type = requireString(body, "type", 12);
    if (!(EVENT_TYPES as readonly string[]).includes(type)) throw new ApiError(400, "bad_event", "Unknown event type.");
    const reason = optionalString(body, "reason", 80) ?? null;
    await db().from("clip_events").insert({ clip_id: clip.id, user_id: user.id, type, reason });
    const next: Record<string, string> = { share: "shared", skip: "skipped", report: "reported" };
    let updated = clip;
    if (next[type] && clip.status !== next[type]) {
      const { data } = await db().from("clips").update({ status: next[type] }).eq("id", clip.id).select("*").single();
      if (data) updated = data;
    }
    return await present(updated);
  });

  r.delete("/clips/:id", async ({ req, params }) => {
    const { user, shop } = await requireShop(req);
    if (user.role !== "owner") throw new ApiError(403, "owner_only", "Only the owner can delete clips.");
    const clip = await loadClip(params.id, shop.id);
    await removeObjects("clips", [clip.path]);
    await removeObjects("thumbs", clip.thumb_path ? [clip.thumb_path] : []);
    if (clip.segment_id) {
      const { data: seg } = await db().from("segments").select("*").eq("id", clip.segment_id).maybeSingle();
      if (seg && seg.status !== "deleted") {
        await removeObjects("segments", [seg.path]);
        await db().from("segments").update({ status: "deleted" }).eq("id", seg.id);
      }
    }
    await db().from("clips").update({ status: "deleted" }).eq("id", clip.id);
    await db().from("clip_events").insert({ clip_id: clip.id, user_id: user.id, type: "delete" });
    return { ok: true };
  });
}
