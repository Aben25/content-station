// Scheduled maintenance tick, daily SMS delivery and the inbound SMS webhook.
import type { Ctx } from "../context.js";
import type { Row } from "../lib/types.js";
import { equal } from "../lib/validate.js";
import { fail } from "../lib/errors.js";
import { localParts, localDate } from "../lib/time.js";
import { product } from "../lib/product.js";
import { randomUUID, createHmac } from "node:crypto";
import type { registerPublishing } from "./publishing.js";
type Publishing = ReturnType<typeof registerPublishing>;

export function registerMaintenance(ctx: Ctx, publishing: Publishing) {
  const { app, options, now, iso, db, cronSecret, base, collection, body, deleteObject, cleanupDeletion, revokeSource } = ctx;
  const smsMode = options.smsMode || process.env.SMS_MODE || "disabled";
  const sendSms =
    options.sendSms ||
    (async (phone: string, text: string) => {
      if (
        !process.env.TWILIO_ACCOUNT_SID ||
        !process.env.TWILIO_AUTH_TOKEN ||
        !process.env.TWILIO_FROM_PHONE
      )
        throw Error("SMS provider is not configured");
      const result = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          headers: {
            authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: phone,
            From: process.env.TWILIO_FROM_PHONE,
            Body: text,
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!result.ok) throw Error(`SMS provider returned ${result.status}`);
    });
  app.post("/internal/cron/tick", async (r) => {
    if (!equal(r.headers["x-cron-secret"], cronSecret))
      fail(401, "unauthorized", "Cron authentication failed.");
    let deleted = 0,
      delivered = 0,
      sms_failed = 0;
    const uploads = await collection("uploads").get();
    for (const upload of uploads.docs) {
      const expired = await db.runTransaction(async (tx) => {
        const snap = await tx.get(upload.ref),
          row = snap.data()!;
        if (
          row.state === "completed" ||
          row.deletion_state === "deleted" ||
          Date.parse(row.created_at) >=
            now() - product.rawRetentionHours * 3600000
        )
          return false;
        tx.update(upload.ref, { state: "expired", deletion_state: "pending" });
        return true;
      });
      if (expired) {
        try {
          await deleteObject(upload.data().path);
          await upload.ref.update({
            deletion_state: "deleted",
            deleted_at: iso(),
          });
          deleted++;
        } catch {
          /* Preserve the tombstone and retry the storage deletion. */
        }
      }
    }
    const processing = await collection("engine_jobs")
      .where("status", "==", "processing")
      .get();
    for (const candidate of processing.docs) {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(candidate.ref),
          j = snap.data()!;
        if (
          j.status === "processing" &&
          Date.parse(j.lease_expires_at) <= now()
        ) {
          tx.update(candidate.ref, {
            status: j.attempts >= 3 ? "failed" : "queued",
            lease_token: null,
            lease_expires_at: null,
            error: "Worker lease expired.",
          });
        }
      });
    }
    const segments = await collection("segments").get();
    for (const s of segments.docs) {
      const row = s.data();
      if (row.deletion_state === "deleted") continue;
      if (
        row.deletion_state === "pending" ||
        Date.parse(row.end_ts) < now() - product.rawRetentionHours * 3600000
      ) {
        await revokeSource(s.id);
        try {
          await cleanupDeletion(s.id);
          deleted++;
        } catch {
          /* Pending state remains retryable. */
        }
      }
    }
    const shops = await collection("shops").get();
    for (const s of shops.docs) {
      const shop = { ...s.data(), id: s.id } as Row;
      if (smsMode === "disabled" || !shop.phone) continue;
      const p = localParts(now(), shop.timezone);
      if (Number(p.hour) < shop.delivery_hour) continue;
      const date = localDate(now(), shop.timezone),
        noticeId = `${s.id}_${date}`,
        noticeRef = collection("notifications").doc(noticeId);
      const clips = (
        await collection("clips").where("shop_id", "==", s.id).get()
      ).docs.filter((c) => !c.data().delivered_at && !c.data().deletion_state);
      if (!clips.length) continue;
      const attempt = randomUUID();
      const acquired = await db.runTransaction(async (tx) => {
        const existing = await tx.get(noticeRef),
          n = existing.data();
        if (
          n &&
          (n.state === "sent" ||
            n.state === "dry_run" ||
            (n.state === "sending" && Date.parse(n.lease_expires_at) > now()))
        )
          return false;
        tx.set(noticeRef, {
          shop_id: s.id,
          state: "sending",
          attempt,
          lease_expires_at: new Date(now() + 60000).toISOString(),
          clip_ids: clips.map((c) => c.id),
          created_at: iso(),
        });
        return true;
      });
      if (!acquired) continue;
      try {
        if (smsMode !== "dry-run")
          await sendSms(
            shop.phone,
            `${product.name}: Your clips are ready. ${product.ownerAppUrl}/#/home`,
          );
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(noticeRef);
          if (snap.data()?.attempt !== attempt) return;
          const rows = await Promise.all(clips.map((c) => tx.get(c.ref)));
          tx.update(noticeRef, {
            state: smsMode === "dry-run" ? "dry_run" : "sent",
            sent_at: smsMode === "dry-run" ? null : iso(),
          });
          if (smsMode !== "dry-run")
            for (const c of rows)
              if (!c.data()?.deletion_state)
                tx.update(c.ref, { delivered_at: iso() });
        });
        if (smsMode !== "dry-run") delivered++;
      } catch (e) {
        sms_failed++;
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(noticeRef);
          if (snap.data()?.attempt === attempt)
            tx.update(noticeRef, {
              state: "failed",
              error: "SMS provider did not acknowledge delivery.",
              failed_at: iso(),
            });
        });
      }
    }
    const publications_checked = await publishing.reconcileDue();
    const pairs = await collection("pair_tokens").get();
    const expired = pairs.docs.filter(
      (p) => !p.data().device_id && Date.parse(p.data().expires_at) <= now(),
    );
    for (const p of expired) await p.ref.delete();
    return {
      ok: true,
      deleted,
      delivered,
      sms_failed,
      sms_mode: smsMode,
      publications_checked,
    };
  });
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) =>
      done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );
  app.post("/sms/inbound", async (r, reply) => {
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!token) fail(503, "sms_unconfigured", "SMS is not configured.");
    const b = body(r),
      url = process.env.TWILIO_INBOUND_URL || `${base}/sms/inbound`;
    let input = url;
    for (const k of Object.keys(b).sort()) input += k + b[k];
    if (
      !equal(
        r.headers["x-twilio-signature"],
        createHmac("sha1", token!).update(input).digest("base64"),
      )
    )
      fail(403, "invalid_signature", "Webhook authentication failed.");
    return reply
      .type("text/xml")
      .send(
        `<Response><Message>${product.name}: ${product.startUrl}</Message></Response>`,
      );
  });
}
