import "dotenv/config";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { config } from "./config.js";
import { db, bucket, CAPTURES, STATIONS } from "./firebase.js";
import {
  probeVideo,
  extractThumbnail,
  transcribe,
  renderBranded,
  measureMotion,
  extractFrames,
} from "./processing.js";
import { describeScene, type SceneDescription } from "./vision.js";
import { generateContentPlan } from "./hermes.js";
import { createPostizDraft } from "./postiz.js";
import type { CaptureRecord } from "./store.js";

/// The Mac worker.
///
/// Everything here is outbound: it polls Firestore for work, pulls footage from
/// Cloud Storage, runs whisper + ffmpeg locally, and writes results back. The
/// station never needs a route into this machine, which is what removes the
/// tunnel, the certificate and the fixed hostname from the system.
///
/// Two job types, both claimed with a transaction so a second worker (or a
/// restarted one) cannot pick up the same capture:
///   uploaded          → transcribe, plan, render  → needs_review
///   approve_requested → publish to Postiz         → approved
///
/// Postiz credentials stay on this machine — the dashboard can only ask for a
/// publish, never perform one.

const log = (captureId: string, msg: string) =>
  console.log(`[worker] ${new Date().toISOString()} ${captureId} ${msg}`);

/// Atomically move one capture from `status` to `claimedStatus`. Returns the
/// claimed snapshot, or null when there is nothing to do.
async function claimOne(status: string, claimedStatus: string): Promise<DocumentSnapshot | null> {
  const staleBefore = Timestamp.fromMillis(Date.now() - config.firebase.claimTimeoutMs);

  const candidates = await db()
    .collection(CAPTURES)
    .where("status", "in", [status, claimedStatus])
    .orderBy("createdAt")
    .limit(10)
    .get();

  for (const doc of candidates.docs) {
    const data = doc.data();
    // Re-claim a job whose worker died mid-flight, but leave live ones alone.
    if (data.status === claimedStatus) {
      const claimedAt: Timestamp | undefined = data.claimedAt;
      if (!claimedAt || claimedAt.toMillis() > staleBefore.toMillis()) continue;
      log(doc.id, `reclaiming stale ${claimedStatus} job from ${data.claimedBy ?? "unknown"}`);
    }

    const claimed = await db().runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      const freshData = fresh.data();
      if (!freshData) return false;
      const isPending = freshData.status === status;
      const isStale =
        freshData.status === claimedStatus &&
        (!freshData.claimedAt || freshData.claimedAt.toMillis() <= staleBefore.toMillis());
      if (!isPending && !isStale) return false;

      tx.update(doc.ref, {
        status: claimedStatus,
        claimedBy: config.firebase.workerId,
        claimedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });

    if (claimed) return doc;
  }

  return null;
}

/// Local scratch dir for one capture. Raw footage is pulled down, processed,
/// and the outputs pushed back; the retention sweeper cleans up local copies.
function workDir(captureId: string): string {
  return path.join(config.uploadDir, captureId);
}

async function uploadArtifact(captureId: string, localPath: string, name: string): Promise<string> {
  const destination = `captures/${captureId}/${name}`;
  await bucket().upload(localPath, { destination, resumable: false });
  return destination;
}

async function processCapture(doc: DocumentSnapshot): Promise<void> {
  const captureId = doc.id;
  const data = doc.data()!;
  const dir = workDir(captureId);
  await mkdir(dir, { recursive: true });

  const rawPath = path.join(dir, "raw.mp4");
  await bucket().file(data.storagePath).download({ destination: rawPath });
  log(captureId, `downloaded ${data.storagePath}`);

  const probe = await probeVideo(rawPath);

  // Cheapest gate first: a station films the same corner all day and most
  // clips show nothing happening. Discard those before paying to describe or
  // render them.
  if (config.cullStaticClips) {
    const motion = await measureMotion(rawPath);
    if (motion < config.motionThreshold) {
      await cull(doc, `nothing moving in frame (motion ${motion.toFixed(6)})`, { motion });
      return;
    }
  }

  const thumbnailPath = await extractThumbnail(rawPath, dir);

  // Look at the footage before writing about it.
  let scene: SceneDescription | null = null;
  try {
    const frames = await extractFrames(rawPath, dir, probe.durationSec, config.vision.frames);
    scene = await describeScene(frames);
    if (scene) log(captureId, `scene: ${scene.description.slice(0, 90)}`);
  } catch (err) {
    // Vision is an improvement, not a dependency — fall back to transcript-only.
    console.warn(`[worker] ${captureId} vision failed: ${err instanceof Error ? err.message : err}`);
  }

  if (scene && !scene.showsBusiness) {
    await cull(doc, scene.reason || "frames do not show the business", { scene });
    return;
  }

  let transcript = "";
  let srtPath: string | null = null;
  if (probe.hasAudio) {
    const result = await transcribe(rawPath, dir);
    transcript = result.text;
    srtPath = result.srtPath;
  }
  log(captureId, `transcribed ${transcript.length} chars`);

  const plan = await generateContentPlan({
    transcript,
    probeWarnings: probe.warnings,
    scene: scene ? { description: scene.description, objects: scene.objects } : null,
  });

  let brandedPath: string | undefined;
  if (plan.usable) {
    brandedPath = await renderBranded({
      rawPath,
      outDir: dir,
      title: plan.onScreenTitle,
      cta: plan.cta,
      brandColor: config.brand.primaryColor,
      srtPath,
      durationSec: probe.durationSec,
    });
  }

  const thumbStoragePath = await uploadArtifact(captureId, thumbnailPath, "thumbnail.jpg");
  const brandedStoragePath = brandedPath
    ? await uploadArtifact(captureId, brandedPath, "branded.mp4")
    : null;

  // Once a branded render exists in Storage, the raw upload is dead weight: the
  // owner reviews the render, and a copy stays on this machine until the
  // retention sweeper takes it. A 15s clip costs ~9 MB raw, so keeping both
  // roughly doubles the bill for footage nobody looks at twice.
  if (brandedStoragePath && config.deleteRawAfterRender) {
    await bucket().file(data.storagePath).delete({ ignoreNotFound: true });
    log(captureId, "raw removed from Storage (branded render kept)");
  }

  await doc.ref.update({
    status: "needs_review",
    processedBy: config.firebase.workerId,
    probe,
    transcript,
    plan,
    scene: scene ?? null,
    thumbStoragePath,
    brandedStoragePath,
    rawDeleted: Boolean(brandedStoragePath && config.deleteRawAfterRender),
    localBrandedPath: brandedPath ?? null,
    localThumbnailPath: thumbnailPath,
    localRawPath: rawPath,
    claimedBy: FieldValue.delete(),
    claimedAt: FieldValue.delete(),
    error: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  log(captureId, "→ needs_review");
}

/// Discard a capture that is not worth a human's attention, deleting its files
/// the same way a rejection does. The reason is kept so the owner can see what
/// is being filtered out and retune the thresholds rather than wonder where the
/// clips went.
async function cull(
  doc: DocumentSnapshot,
  reason: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const captureId = doc.id;
  await bucket().deleteFiles({ prefix: `captures/${captureId}/` });
  await rm(workDir(captureId), { recursive: true, force: true });
  await doc.ref.update({
    status: "culled",
    cullReason: reason,
    processedBy: config.firebase.workerId,
    storagePath: FieldValue.delete(),
    claimedBy: FieldValue.delete(),
    claimedAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
    ...extra,
  });
  log(captureId, `culled — ${reason}`);
}

/// The owner edited captions and asked for publication. Only this machine holds
/// the Postiz key, so publishing happens here.
async function publishCapture(doc: DocumentSnapshot): Promise<void> {
  const captureId = doc.id;
  const data = doc.data()!;

  // postiz.ts is shared with the legacy HTTP path, so shape the Firestore doc
  // into the record type it already understands.
  const rec: CaptureRecord = {
    captureId,
    filename: "raw.mp4",
    bytes: data.bytes ?? 0,
    rawPath: data.localRawPath ?? path.join(workDir(captureId), "raw.mp4"),
    thumbnailPath: data.localThumbnailPath,
    brandedPath: data.localBrandedPath ?? undefined,
    probe: data.probe,
    transcript: data.transcript,
    plan: data.plan,
    approvedPlatforms: data.approvedPlatforms ?? data.plan?.platforms,
    contentHash: data.contentHash,
    status: "needs_review",
    createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const result = await createPostizDraft(rec);
  await doc.ref.update({
    status: "approved",
    processedBy: config.firebase.workerId,
    postizDraftId: result.draftId,
    claimedBy: FieldValue.delete(),
    claimedAt: FieldValue.delete(),
    error: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  log(captureId, `→ approved (postiz ${result.draftId})`);
}

async function runJob(
  doc: DocumentSnapshot,
  handler: (doc: DocumentSnapshot) => Promise<void>,
  failureStatus: string,
): Promise<void> {
  try {
    await handler(doc);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] ${doc.id} failed: ${message}`);
    // A failed job parks in `error` with the reason attached rather than
    // retrying forever — the dashboard surfaces it to the owner.
    await doc.ref.update({
      status: failureStatus,
      error: message.slice(0, 2000),
      claimedBy: FieldValue.delete(),
      claimedAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

/// Mirror station approvals into custom auth claims.
///
/// Storage rules cannot read Firestore on this bucket, so `stationApproved`
/// travels in the station's ID token instead. The owner pairs a station by
/// flipping `approved` in Firestore from the dashboard; this turns that into a
/// claim. The station picks it up on its next token refresh.
async function syncStationClaims(): Promise<boolean> {
  // A missing field does not match `== null` in Firestore, so the drift check
  // happens in code rather than in the query.
  const snap = await db().collection(STATIONS).limit(50).get();
  let didWork = false;

  for (const doc of snap.docs) {
    const { approved, claimSynced } = doc.data() as { approved?: boolean; claimSynced?: boolean };
    const wanted = approved === true;
    if (claimSynced === wanted) continue;

    try {
      await getAuth().setCustomUserClaims(doc.id, wanted ? { stationApproved: true } : {});
      await doc.ref.update({ claimSynced: wanted, claimSyncedAt: FieldValue.serverTimestamp() });
      log(doc.id, wanted ? "approved → claim minted" : "approval revoked → claim cleared");
      didWork = true;
    } catch (err) {
      console.error(`[worker] claim sync ${doc.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return didWork;
}

/// Rejected footage is deleted outright — raw video of customers sitting on a
/// Mac in a gym is the liability this system most needs to avoid.
async function cleanupRejected(): Promise<boolean> {
  const snap = await db().collection(CAPTURES).where("status", "==", "rejected").limit(5).get();
  if (snap.empty) return false;

  for (const doc of snap.docs) {
    const data = doc.data();
    try {
      await bucket().deleteFiles({ prefix: `captures/${doc.id}/` });
      await rm(workDir(doc.id), { recursive: true, force: true });
      await doc.ref.update({
        status: "deleted",
        storagePath: FieldValue.delete(),
        brandedStoragePath: FieldValue.delete(),
        thumbStoragePath: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      log(doc.id, "rejected → files deleted");
    } catch (err) {
      console.error(`[worker] cleanup ${doc.id} failed:`, err instanceof Error ? err.message : err);
    }
    void data;
  }
  return true;
}

async function tick(): Promise<boolean> {
  if (await syncStationClaims()) return true;

  const pending = await claimOne("uploaded", "processing");
  if (pending) {
    await runJob(pending, processCapture, "error");
    return true;
  }

  const toPublish = await claimOne("approve_requested", "publishing");
  if (toPublish) {
    await runJob(toPublish, publishCapture, "publish_failed");
    return true;
  }

  return await cleanupRejected();
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} — finishing current job then exiting`);
    stopping = true;
  });
}

console.log(
  `[worker] ${config.firebase.workerId} polling ${config.firebase.projectId}/${CAPTURES} every ${config.firebase.pollIntervalMs}ms`,
);

while (!stopping) {
  let didWork = false;
  try {
    didWork = await tick();
  } catch (err) {
    // Network blips and Firestore hiccups must not kill the worker.
    console.error("[worker] poll failed:", err instanceof Error ? err.message : err);
  }
  // Back-to-back when there is a queue, idle poll when there is not.
  if (!didWork) await new Promise((r) => setTimeout(r, config.firebase.pollIntervalMs));
}

console.log("[worker] stopped");
process.exit(0);
