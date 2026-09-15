// Routes the mounted camera calls: config long-poll, heartbeat, segment upload, previews.
import type { Ctx } from "../context.js";
import type { FastifyRequest, Row } from "../lib/types.js";
import { fail } from "../lib/errors.js";
import { hash, str, finite, timestamp } from "../lib/validate.js";
import { product } from "../lib/product.js";

export function registerDevice(ctx: Ctx) {
  const { app, now, iso, db, bucket, collection, get, device, body, capability, config } = ctx;
  app.get("/device/config", async (r) => {
    let d = await device(r, true);
    const q = r.query as Row,
      wait = Math.min(25, Math.max(0, Number(q.wait) || 0)),
      until = Date.now() + wait * 1000;
    while (
      q.since === d.config_updated_at &&
      !d.unpaired_at &&
      Date.now() < until
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      d = (await get("devices", d.id))!;
    }
    return config(d);
  });
  const statuses = [
    "waiting",
    "reading",
    "connecting",
    "framing",
    "recording",
    "paused",
    "nointernet",
    "reframe",
    "hot",
    "fault",
    "idle",
  ];
  app.post("/device/heartbeat", async (r) => {
    const d = await device(r),
      b = body(r),
      patch: Row = { last_seen_at: iso() };
    for (const k of ["battery", "storage_free_mb", "recording_seconds_today"])
      if (k in b) patch[k] = finite(b[k], k, 0, k === "battery" ? 100 : 1e12);
    if (
      b.thermal &&
      ["nominal", "fair", "serious", "critical"].includes(b.thermal)
    )
      patch.thermal = b.thermal;
    if (b.wifi && ["strong", "good", "weak", "none"].includes(b.wifi))
      patch.wifi = b.wifi;
    if (b.state && statuses.includes(b.state)) {
      patch.status = b.state;
      if (b.state !== d.status) patch.status_since = iso();
    }
    patch.status_code = typeof b.code === "string" ? b.code.slice(0, 60) : null;
    await collection("devices").doc(d.id).update(patch);
    return config({ ...d, ...patch });
  });
  app.post("/device/status", async (r) => {
    const d = await device(r),
      b = body(r);
    if (!statuses.includes(b.status))
      fail(400, "invalid_status", "Provide a valid camera status.");
    await collection("devices")
      .doc(d.id)
      .update({
        status: b.status,
        status_code: typeof b.code === "string" ? b.code.slice(0, 60) : null,
        status_since: iso(),
      });
    return { ok: true };
  });
  const parseSegment = (b: Row) => {
    const start_ts = timestamp(b.start_ts),
      end_ts = timestamp(b.end_ts),
      duration = Date.parse(end_ts) - Date.parse(start_ts);
    if (
      duration < 1 ||
      duration > product.segmentMinutes * 60000 + 10000 ||
      Date.parse(start_ts) > now() + 300000 ||
      Date.parse(end_ts) < now() - product.rawRetentionHours * 3600000
    )
      fail(
        400,
        "invalid_segment",
        "Provide a recent camera segment within the recording limit.",
      );
    return { start_ts, end_ts };
  };
  app.post("/device/segment/upload-url", async (r) => {
    const d = await device(r),
      times = parseSegment(body(r)),
      path = `v2/segments/${d.shop_id}/${d.id}/${Date.parse(times.start_ts)}.mp4`,
      id = hash(path);
    await db.runTransaction(async (tx) => {
      const ref = collection("uploads").doc(id),
        s = await tx.get(ref);
      if (s.exists) {
        if (s.data()!.end_ts !== times.end_ts)
          fail(
            409,
            "segment_conflict",
            "This segment already has different timing.",
          );
        return;
      }
      tx.create(ref, {
        id,
        path,
        shop_id: d.shop_id,
        device_id: d.id,
        ...times,
        created_at: iso(),
        state: "pending",
      });
    });
    return {
      path,
      upload_url: capability(
        {
          action: "upload",
          path,
          kind: "uploads",
          id,
          content_type: "video/mp4",
          max_bytes: 512 * 1024 * 1024,
        },
        3600,
      ),
      expires_at: new Date(now() + 3600000).toISOString(),
    };
  });
  app.post("/device/segment/complete", async (r) => {
    const d = await device(r),
      b = body(r),
      times = parseSegment(b),
      path = str(b.path, "segment path", 512),
      id = hash(path);
    const upload = await get("uploads", id);
    if (
      !upload ||
      upload.path !== path ||
      upload.device_id !== d.id ||
      upload.start_ts !== times.start_ts ||
      upload.end_ts !== times.end_ts
    )
      fail(
        403,
        "segment_scope",
        "Upload this segment using its camera upload URL.",
      );
    const bytes = finite(b.bytes, "file size", 1, 512 * 1024 * 1024),
      width = finite(b.width, "width", 1, 4096),
      height = finite(b.height, "height", 1, 4096),
      fps = finite(b.fps, "frame rate", 1, 120);
    let meta: any;
    try {
      [meta] = await bucket.file(path).getMetadata();
    } catch {
      fail(
        409,
        "upload_missing",
        "Finish uploading the segment, then try again.",
      );
    }
    if (Number(meta.size) !== bytes || meta.contentType !== "video/mp4")
      fail(
        409,
        "upload_mismatch",
        "The uploaded segment does not match its file information.",
      );
    await db.runTransaction(async (tx) => {
      const sr = collection("segments").doc(id),
        s = await tx.get(sr),
        dr = await tx.get(collection("devices").doc(d.id)),
        grant = await tx.get(collection("uploads").doc(id));
      if (grant.data()?.deletion_state)
        fail(409, "upload_expired", "This upload has expired.");
      if (dr.data()?.unpaired_at)
        fail(401, "device_unpaired", "Pair this camera again.");
      if (s.exists) {
        if (s.data()?.deletion_state)
          fail(409, "segment_deleted", "This footage has been deleted.");
        return;
      }
      tx.create(sr, {
        id,
        shop_id: d.shop_id,
        device_id: d.id,
        path,
        ...times,
        bytes,
        width,
        height,
        fps,
        created_at: iso(),
        deletion_state: null,
      });
      tx.create(collection("engine_jobs").doc(id), {
        id,
        segment_id: id,
        shop_id: d.shop_id,
        status: "queued",
        attempts: 0,
        created_at: iso(),
        lease_token: null,
        lease_expires_at: null,
      });
      tx.update(collection("uploads").doc(id), { state: "completed" });
    });
    return { segment_id: id, job_id: id };
  });
  const saveImage = async (r: FastifyRequest, kind: string) => {
    const d = await device(r);
    if (!r.headers["content-type"]?.startsWith("image/jpeg"))
      fail(415, "invalid_media", "Send a JPEG image.");
    if (
      kind === "preview" &&
      (!d.framing_until || Date.parse(d.framing_until) <= now())
    )
      fail(409, "framing_inactive", "Start camera framing first.");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of r.body as any) {
      size += chunk.length;
      if (size > 3 * 1024 * 1024)
        fail(413, "image_large", "Send a smaller preview image.");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (
      bytes.length < 3 ||
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes[2] !== 255
    )
      fail(400, "invalid_jpeg", "Send a valid JPEG image.");
    const path = `v2/thumbs/${d.shop_id}/device/${d.id}/${kind}.jpg`;
    await bucket
      .file(path)
      .save(bytes, { resumable: false, contentType: "image/jpeg" });
    await collection("devices")
      .doc(d.id)
      .update(
        kind === "preview"
          ? { preview_path: path, preview_at: iso() }
          : { last_thumb_path: path, last_thumb_at: iso() },
      );
  };
  for (const kind of ["preview", "thumb"])
    app.post(`/device/${kind}`, async (r, reply) => {
      await saveImage(r, kind);
      return reply.code(204).send();
    });
}
