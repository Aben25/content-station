// Owner controls for the paired camera: status, pause, framing, unpair.
import type { Ctx } from "../context.js";
import type { Row } from "../lib/types.js";
import { fail } from "../lib/errors.js";
import { nextOpening } from "../lib/time.js";
import { randomUUID } from "node:crypto";

export function registerCamera(ctx: Ctx) {
  const { app, now, iso, db, bucket, collection, ownerShop, currentDevice, body, readUrl, cameraStatus } = ctx;
  app.get("/camera/status", async (r) =>
    cameraStatus((await ownerShop(r)).shop),
  );
  for (const action of ["pause", "resume", "framing/start"])
    app.post(`/camera/${action}`, async (r) => {
      const { shop } = await ownerShop(r),
        d = (await currentDevice(shop))!,
        b = body(r),
        patch: Row = { config_updated_at: iso() };
      if (action === "pause") {
        if (!["1h", "today", "indefinite"].includes(b.until))
          fail(400, "invalid_pause", "Choose when recording should resume.");
        Object.assign(patch, {
          pause_mode: b.until,
          paused_until:
            b.until === "indefinite"
              ? null
              : new Date(
                  b.until === "1h" ? now() + 3600000 : nextOpening(now(), shop),
                ).toISOString(),
          status: "paused",
          status_since: iso(),
        });
      } else if (action === "resume")
        Object.assign(patch, {
          pause_mode: "none",
          paused_until: null,
          status: "recording",
          status_since: iso(),
        });
      else patch.framing_until = new Date(now() + 10 * 60000).toISOString();
      await collection("devices").doc(d.id).update(patch);
      return action === "framing/start"
        ? { framing_until: patch.framing_until }
        : cameraStatus(shop);
    });
  app.get("/camera/preview", async (r, reply) => {
    const { shop } = await ownerShop(r),
      d = (await currentDevice(shop))!;
    if (!d.preview_path) return reply.code(204).send();
    return {
      url: readUrl(d.preview_path, "devices", d.id),
      captured_at: d.preview_at,
    };
  });
  app.post("/camera/reference-frame", async (r) => {
    const { shop } = await ownerShop(r),
      d = (await currentDevice(shop))!;
    if (!d.preview_path)
      fail(
        409,
        "preview_missing",
        "Wait for a camera preview, then try again.",
      );
    const revision = randomUUID(),
      path = `v2/thumbs/${shop.id}/device/${d.id}/reference-${revision}.jpg`;
    await bucket.file(d.preview_path).copy(bucket.file(path));
    await db.runTransaction(async (tx) => {
      const ref = collection("devices").doc(d.id),
        fresh = await tx.get(ref);
      if (fresh.data()?.unpaired_at)
        fail(409, "device_changed", "Pair your camera again.");
      tx.update(ref, {
        reference_frame_path: path,
        reference_frame_revision: revision,
        framing_until: null,
        config_updated_at: iso(),
      });
    });
    return { reference_frame_path: path, reference_frame_revision: revision };
  });
  app.post("/camera/unpair", async (r) => {
    const { shop } = await ownerShop(r);
    await db.runTransaction(async (tx) => {
      const sr = collection("shops").doc(shop.id),
        s = await tx.get(sr);
      const id = s.data()?.device_id;
      if (!id) return;
      const dr = collection("devices").doc(id);
      await tx.get(dr);
      tx.update(dr, { unpaired_at: iso(), config_updated_at: iso() });
      tx.update(sr, {
        device_id: null,
        replacement_context: {
          previous_device_id: id,
          replacing_since: iso(),
          return_to: "camera",
        },
      });
    });
    return { ok: true };
  });
}
