// Owner clip listing, captions, events and deletion.
import type { Ctx } from "../context.js";
import type { Row } from "../lib/types.js";
import { fail } from "../lib/errors.js";
import { localDate } from "../lib/time.js";
import { str } from "../lib/validate.js";
import type { registerPublishing } from "./publishing.js";
type Publishing = ReturnType<typeof registerPublishing>;

export function registerClips(ctx: Ctx, publishing: Publishing) {
  const { app, now, iso, db, collection, ownerShop, body, presentClip, ownedClip, cleanupDeletion, revokeSource } = ctx;
  app.get("/clips", async (r) => {
    const { shop } = await ownerShop(r),
      date = (r.query as Row).date || localDate(now(), shop.timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      fail(400, "invalid_date", "Choose a valid date.");
    const rows = (
      await collection("clips").where("shop_id", "==", shop.id).get()
    ).docs
      .map((s) => ({ ...s.data(), id: s.id }) as Row)
      .filter((c) => !c.deletion_state);
    const groups: Record<string, number> = {};
    for (const c of rows) {
      const d = localDate(Date.parse(c.created_at), shop.timezone);
      if (d < date) groups[d] = (groups[d] || 0) + 1;
    }
    return {
      date,
      clips: rows
        .filter(
          (c) => localDate(Date.parse(c.created_at), shop.timezone) === date,
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(presentClip),
      older: Object.entries(groups)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, count]) => ({ date, count })),
    };
  });
  app.get("/clips/:id", async (r) => presentClip(await ownedClip(r)));
  app.patch("/clips/:id", async (r) => {
    const c = await ownedClip(r),
      caption = str(body(r).caption, "caption", 2200);
    await collection("clips").doc(c.id).update({ caption });
    return presentClip({ ...c, caption });
  });
  app.post("/clips/:id/event", async (r) => {
    const c = await ownedClip(r),
      b = body(r);
    if (!["open", "share", "skip", "report"].includes(b.type))
      fail(400, "invalid_event", "Provide a valid clip action.");
    const status = (
      {
        open: "viewed",
        share: "shared",
        skip: "skipped",
        report: "reported",
      } as Row
    )[b.type];
    const batch = db.batch();
    batch.create(collection("clip_events").doc(), {
      clip_id: c.id,
      shop_id: c.shop_id,
      type: b.type,
      reason: typeof b.reason === "string" ? b.reason.slice(0, 1000) : null,
      created_at: iso(),
    });
    batch.update(collection("clips").doc(c.id), { status });
    await batch.commit();
    return presentClip({ ...c, status });
  });
  app.delete("/clips/:id", async (r) => {
    const c = await ownedClip(r, true);
    if (c.deletion_state === "deleted") return { ok: true };
    await revokeSource(c.segment_id, c.id);
    await publishing.cancelForClip(c.shop_id, c.id);
    try {
      await cleanupDeletion(c.segment_id);
    } catch {
      fail(
        503,
        "deletion_pending",
        "Your clip is hidden. File deletion will retry shortly.",
      );
    }
    return { ok: true };
  });
}
