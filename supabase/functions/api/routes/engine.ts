import { db } from "../../_shared/db.ts";
import { ApiError, readJson, Router } from "../../_shared/http.ts";
import { requireEngine } from "../../_shared/auth.ts";
import { signedUrl } from "../../_shared/storage.ts";
import type { Row } from "../../_shared/types.ts";

export function mountEngine(r: Router) {
  r.post("/engine/jobs/claim", async ({ req }) => {
    requireEngine(req);
    const body = await readJson(req);
    const worker = typeof body.worker === "string" ? body.worker.slice(0, 80) : "engine";
    const max = Math.max(1, Math.min(20, Number(body.max ?? 1) || 1));
    const { data: jobs, error } = await db().rpc("claim_engine_jobs", { p_worker: worker, p_max: max });
    if (error) throw new Error(`claim jobs: ${error.message}`);
    const out = [];
    for (const job of (jobs ?? []) as Row[]) {
      const { data: seg } = await db().from("segments").select("*").eq("id", job.segment_id).maybeSingle();
      if (!seg) continue;
      out.push({
        id: job.id,
        attempts: job.attempts,
        segment: {
          id: seg.id,
          shop_id: seg.shop_id,
          device_id: seg.device_id,
          path: seg.path,
          download_url: await signedUrl("segments", seg.path, 6 * 3600),
          start_ts: seg.start_ts,
          end_ts: seg.end_ts,
          bytes: seg.bytes,
          width: seg.width,
          height: seg.height,
          fps: seg.fps,
        },
      });
    }
    return { jobs: out };
  });

  r.post("/engine/jobs/:id/done", async ({ req, params }) => {
    requireEngine(req);
    const { data: job } = await db().from("engine_jobs").select("*").eq("id", params.id).maybeSingle();
    if (!job) throw new ApiError(404, "no_job", "Unknown job.");
    const body = await readJson(req);
    const clips = Array.isArray(body.clips) ? (body.clips as Row[]) : [];
    const ids: string[] = [];
    for (const c of clips) {
      if (typeof c.path !== "string" || !c.path.startsWith(`${job.shop_id}/`)) throw new ApiError(400, "bad_clip_path", "Clip paths must start with the shop id.");
      const { data, error } = await db()
        .from("clips")
        .insert({
          shop_id: job.shop_id,
          segment_id: job.segment_id,
          path: c.path,
          thumb_path: typeof c.thumb_path === "string" ? c.thumb_path : null,
          duration_s: Number(c.duration_s ?? 0),
          caption: typeof c.caption === "string" ? c.caption.slice(0, 300) : "",
          source_start_s: c.source_start_s ?? null,
          source_end_s: c.source_end_s ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(`insert clip: ${error.message}`);
      ids.push(data.id);
    }
    await db().from("engine_jobs").update({ status: "done", finished_at: new Date().toISOString() }).eq("id", job.id);
    await db().from("segments").update({ status: "done" }).eq("id", job.segment_id);
    return { clip_ids: ids };
  });

  r.post("/engine/jobs/:id/failed", async ({ req, params }) => {
    requireEngine(req);
    const { data: job } = await db().from("engine_jobs").select("*").eq("id", params.id).maybeSingle();
    if (!job) throw new ApiError(404, "no_job", "Unknown job.");
    const body = await readJson(req);
    const err = typeof body.error === "string" ? body.error.slice(0, 500) : "unknown";
    const status = job.attempts >= 3 ? "failed" : "queued";
    await db().from("engine_jobs").update({ status, last_error: err, finished_at: status === "failed" ? new Date().toISOString() : null }).eq("id", job.id);
    if (status === "failed") await db().from("segments").update({ status: "failed" }).eq("id", job.segment_id);
    return { ok: true, status };
  });
}
