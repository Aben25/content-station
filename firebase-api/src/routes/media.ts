// Signed media capabilities: streaming uploads and range reads on private objects.
import type { Ctx } from "../context.js";
import type { FastifyRequest, Row } from "../lib/types.js";
import { ApiError, fail } from "../lib/errors.js";
import { Transform } from "node:stream";
import { createHmac } from "node:crypto";
import { equal } from "../lib/validate.js";
import { outputPaths } from "../lib/paths.js";
import { pipeline } from "node:stream/promises";

export function registerMedia(ctx: Ctx) {
  const { app, now, bucket, mediaSecret, get, requireLease } = ctx;
  const verifyCapability = async (r: FastifyRequest, action: string) => {
    const raw = (r.params as Row).token as string;
    if (raw.length > 4096)
      fail(403, "invalid_media_token", "This media link is invalid.");
    const [payload, signature, ...extra] = raw.split(".");
    if (
      extra.length ||
      !equal(
        signature,
        createHmac("sha256", mediaSecret).update(payload).digest("base64url"),
      )
    )
      fail(403, "invalid_media_token", "This media link is invalid.");
    let c: Row;
    try {
      c = JSON.parse(Buffer.from(payload, "base64url").toString());
    } catch {
      return fail(403, "invalid_media_token", "This media link is invalid.");
    }
    if (
      c.action !== action ||
      typeof c.exp !== "number" ||
      c.exp <= now() ||
      !c.path?.startsWith("v2/")
    )
      fail(403, "media_expired", "Refresh this media link and try again.");
    const row = (await get(c.kind, c.id))!;
    if (!row || row.deletion_state)
      fail(404, "media_missing", "This media is no longer available.");
    if (c.kind === "engine_jobs") {
      requireLease(row, c.lease_token);
      if (
        action !== "upload" ||
        !Array.from({ length: 20 }, (_, i) =>
          Object.values(outputPaths(row, i)),
        )
          .flat()
          .includes(c.path)
      )
        fail(403, "media_scope", "This media link is invalid.");
    } else if (c.kind === "uploads") {
      if (row.path !== c.path)
        fail(403, "media_scope", "This media link is invalid.");
      const d = await get("devices", row.device_id);
      if (!d || d.unpaired_at)
        fail(401, "device_unpaired", "Pair this camera again.");
      if (row.state !== "pending" && action === "upload")
        fail(409, "upload_finalized", "This upload is already complete.");
    } else if (c.kind === "devices") {
      if (
        row.unpaired_at ||
        ![
          row.preview_path,
          row.last_thumb_path,
          row.reference_frame_path,
        ].includes(c.path)
      )
        fail(404, "media_missing", "This image is no longer available.");
    } else if (![row.path, row.thumb_path].includes(c.path))
      fail(403, "media_scope", "This media link is invalid.");
    return c;
  };
  app.put("/media/:token", async (r, reply) => {
    const c = await verifyCapability(r, "upload");
    if (r.headers["content-type"]?.split(";")[0] !== c.content_type)
      fail(415, "invalid_media", "Use the expected media content type.");
    let size = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, cb) {
        size += chunk.length;
        cb(
          size > c.max_bytes
            ? new ApiError(413, "media_large", "This media file is too large.")
            : null,
          chunk,
        );
      },
    });
    const file = bucket.file(c.path);
    const [exists] = await file.exists();
    if (exists) {
      for await (const chunk of r.body as any) {
        size += chunk.length;
        if (size > c.max_bytes)
          fail(413, "media_large", "This media file is too large.");
      }
      return reply.code(204).send();
    }
    // Delete only the generation this request created. A failed concurrent PUT
    // must never remove a different request's successfully uploaded object.
    const deleteOwnGeneration = async () => {
      const generation = file.metadata.generation;
      if (generation)
        await bucket
          .file(c.path, { generation })
          .delete({ ignoreNotFound: true });
    };
    try {
      await pipeline(
        r.body as any,
        limiter,
        file.createWriteStream({
          resumable: false,
          metadata: { contentType: c.content_type },
          preconditionOpts: { ifGenerationMatch: 0 },
        }),
      );
    } catch (e: any) {
      if (e.code !== 412) {
        await deleteOwnGeneration().catch(() => {});
        throw e;
      }
    }
    if (!size) {
      await deleteOwnGeneration();
      fail(400, "media_empty", "Upload a nonempty media file.");
    }
    try {
      await verifyCapability(r, "upload");
    } catch (e) {
      await deleteOwnGeneration();
      throw e;
    }
    return reply.code(204).send();
  });
  app.get("/media/:token", async (r, reply) => {
    const c = await verifyCapability(r, "read"),
      file = bucket.file(c.path);
    let metadata: any;
    try {
      [metadata] = await file.getMetadata();
    } catch {
      fail(404, "media_missing", "This media is no longer available.");
    }
    const size = Number(metadata.size);
    reply
      .header("accept-ranges", "bytes")
      .header("cache-control", "private, no-store")
      .header(
        "content-type",
        metadata.contentType || "application/octet-stream",
      );
    const range = r.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2]))
        return reply
          .code(416)
          .header("content-range", `bytes */${size}`)
          .send();
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])),
        end = m[1]
          ? m[2]
            ? Math.min(Number(m[2]), size - 1)
            : size - 1
          : size - 1;
      if (start >= size || start > end)
        return reply
          .code(416)
          .header("content-range", `bytes */${size}`)
          .send();
      return reply
        .code(206)
        .header("content-range", `bytes ${start}-${end}/${size}`)
        .header("content-length", end - start + 1)
        .send(file.createReadStream({ start, end }));
    }
    return reply.header("content-length", size).send(file.createReadStream());
  });
}
