// Render worker job queue: claim, heartbeat, output uploads, completion, failure.
import type { Ctx } from "../context.js";
import type { Row } from "../lib/types.js";
import { fail } from "../lib/errors.js";
import { hash, equal, str, finite } from "../lib/validate.js";
import { outputPaths } from "../lib/paths.js";
import { randomBytes } from "node:crypto";

export function registerEngine(ctx: Ctx) {
  const { app, now, iso, db, bucket, collection, get, engine, body, capability, requireLease } = ctx;
  app.post("/engine/jobs/claim", async (r) => {
    engine(r);
    const b = body(r),
      worker = str(b.worker, "worker name", 100),
      max = Math.min(4, Math.max(1, Number(b.max) || 1));
    const candidates = (
      await collection("engine_jobs")
        .where("status", "in", ["queued", "processing"])
        .get()
    ).docs.sort((a, b) =>
      a.data().created_at.localeCompare(b.data().created_at),
    );
    const jobs: Row[] = [];
    for (const candidate of candidates) {
      if (jobs.length >= max) break;
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(candidate.ref),
          j = snap.data()!;
        if (
          j.status !== "queued" &&
          !(
            j.status === "processing" && Date.parse(j.lease_expires_at) <= now()
          )
        )
          return null;
        const sr = collection("segments").doc(j.segment_id),
          s = await tx.get(sr);
        if (!s.exists || s.data()!.deletion_state) {
          tx.update(candidate.ref, { status: "cancelled" });
          return null;
        }
        if (j.attempts >= 3) {
          tx.update(candidate.ref, {
            status: "failed",
            error: "Worker lease expired after three attempts.",
          });
          return null;
        }
        const lease_token = randomBytes(32).toString("base64url"),
          lease_expires_at = new Date(now() + 120000).toISOString(),
          attempts = j.attempts + 1;
        tx.update(candidate.ref, {
          status: "processing",
          lease_token,
          lease_expires_at,
          attempts,
          worker,
          started_at: iso(),
        });
        return {
          id: snap.id,
          lease_token,
          lease_expires_at,
          attempts,
          segment: {
            ...s.data(),
            id: s.id,
            download_url: capability(
              {
                action: "read",
                path: s.data()!.path,
                kind: "segments",
                id: s.id,
              },
              3600,
            ),
          },
        };
      });
      if (result) jobs.push(result);
    }
    return { jobs };
  });
  app.post("/engine/jobs/:id/heartbeat", async (r) => {
    engine(r);
    const id = (r.params as Row).id;
    return db.runTransaction(async (tx) => {
      const ref = collection("engine_jobs").doc(id),
        s = await tx.get(ref);
      requireLease(s.exists ? s.data()! : null, body(r).lease_token);
      const lease_expires_at = new Date(now() + 120000).toISOString();
      tx.update(ref, { lease_expires_at });
      return { ok: true, lease_expires_at };
    });
  });
  app.post("/engine/jobs/:id/upload-urls", async (r) => {
    engine(r);
    const j = requireLease(
        await get("engine_jobs", (r.params as Row).id),
        body(r).lease_token,
      ),
      index = finite(body(r).index, "clip index", 0, 19);
    if (!Number.isInteger(index))
      fail(400, "invalid_index", "Provide a whole clip index.");
    const paths = outputPaths(j, index);
    return {
      ...paths,
      video_upload_url: capability(
        {
          action: "upload",
          path: paths.path,
          kind: "engine_jobs",
          id: j.id,
          lease_token: j.lease_token,
          content_type: "video/mp4",
          max_bytes: 128 * 1024 * 1024,
        },
        120,
      ),
      thumb_upload_url: capability(
        {
          action: "upload",
          path: paths.thumb_path,
          kind: "engine_jobs",
          id: j.id,
          lease_token: j.lease_token,
          content_type: "image/jpeg",
          max_bytes: 5 * 1024 * 1024,
        },
        120,
      ),
    };
  });
  app.post("/engine/jobs/:id/done", async (r) => {
    engine(r);
    const id = (r.params as Row).id,
      b = body(r),
      original = await get("engine_jobs", id);
    if (!original) fail(404, "job_missing", "This job was not found.");
    if (!Array.isArray(b.clips) || b.clips.length > 20)
      fail(400, "invalid_clips", "Provide up to twenty clips.");
    const seen = new Set<string>();
    const clips: Row[] = b.clips.map((c: Row) => {
      const index = Array.from({ length: 20 }, (_, i) => i).find(
        (i) => outputPaths(original!, i).path === c.path,
      );
      if (
        index === undefined ||
        c.thumb_path !== outputPaths(original!, index).thumb_path ||
        seen.has(c.path)
      )
        fail(400, "clip_scope", "Use the output paths provided for this job.");
      seen.add(c.path);
      const source_start_s = finite(c.source_start_s, "source start", 0, 3600),
        source_end_s = finite(
          c.source_end_s,
          "source end",
          source_start_s,
          3600,
        );
      return {
        path: c.path,
        thumb_path: c.thumb_path,
        duration_s: finite(c.duration_s, "clip duration", 0.01, 300),
        caption: str(c.caption, "caption", 2200),
        source_start_s,
        source_end_s,
      };
    });
    const fingerprint = hash(JSON.stringify(clips));
    if (original!.status !== "done") {
      requireLease(original, b.lease_token);
      for (const c of clips) {
        for (const [path, contentType] of [
          [c.path, "video/mp4"],
          [c.thumb_path, "image/jpeg"],
        ]) {
          let meta: any;
          try {
            [meta] = await bucket.file(path).getMetadata();
          } catch {
            fail(
              409,
              "output_missing",
              "Finish uploading all clip files first.",
            );
          }
          if (Number(meta.size) <= 0 || meta.contentType !== contentType)
            fail(409, "output_invalid", "Upload valid clip files first.");
        }
      }
    }
    return db.runTransaction(async (tx) => {
      const ref = collection("engine_jobs").doc(id),
        s = await tx.get(ref),
        j = s.data()!;
      const segmentSnap = await tx.get(
        collection("segments").doc(j.segment_id),
      );
      if (!segmentSnap.exists || segmentSnap.data()!.deletion_state)
        fail(
          409,
          "segment_deleted",
          "This source footage is no longer available.",
        );
      if (j.status === "done") {
        if (
          !equal(b.lease_token, j.completed_lease_token) ||
          j.fingerprint !== fingerprint
        )
          fail(
            409,
            "completion_conflict",
            "This job has already completed with different output.",
          );
        return { clip_ids: j.clip_ids };
      }
      requireLease(j, b.lease_token);
      const sourceDuration =
        (Date.parse(segmentSnap.data()!.end_ts) -
          Date.parse(segmentSnap.data()!.start_ts)) /
        1000;
      const clip_ids = clips.map((c) => hash(c.path));
      clips.forEach((c, i) => {
        if (c.source_end_s > sourceDuration + 0.1)
          fail(
            400,
            "source_range",
            "Clip timing must stay within the source segment.",
          );
        tx.create(collection("clips").doc(clip_ids[i]), {
          ...c,
          id: clip_ids[i],
          shop_id: j.shop_id,
          segment_id: j.segment_id,
          job_id: id,
          status: "new",
          created_at: iso(),
          delivered_at: null,
          deletion_state: null,
        });
      });
      tx.update(ref, {
        status: "done",
        completed_at: iso(),
        completed_lease_token: j.lease_token,
        fingerprint,
        clip_ids,
      });
      return { clip_ids };
    });
  });
  app.post("/engine/jobs/:id/failed", async (r) => {
    engine(r);
    const id = (r.params as Row).id,
      b = body(r);
    await db.runTransaction(async (tx) => {
      const ref = collection("engine_jobs").doc(id),
        s = await tx.get(ref),
        j = requireLease(s.exists ? s.data()! : null, b.lease_token);
      tx.update(ref, {
        status: j.attempts >= 3 ? "failed" : "queued",
        error: str(b.error, "error", 2000),
        lease_expires_at: null,
        lease_token: null,
      });
    });
    return { ok: true };
  });
}
