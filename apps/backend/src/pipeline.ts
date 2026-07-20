import path from "node:path";
import { config } from "./config.js";
import { queue } from "./queue.js";
import { store, type CaptureRecord } from "./store.js";
import { probeVideo, extractThumbnail, transcribe, renderBranded } from "./processing.js";
import { generateContentPlan } from "./hermes.js";

/// Full Phase 2 pipeline for one capture:
/// inspect → thumbnail → transcribe → Hermes plan → branded render → draft.
/// Runs inside the job queue; failures are recorded on the capture record.
export function enqueuePipeline(rec: CaptureRecord, attempt = 1): void {
  queue.enqueue(async () => {
    try {
      await runPipeline(rec);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[pipeline] ${rec.captureId} attempt ${attempt} failed: ${message}`);
      if (attempt < 2) {
        enqueuePipeline(rec, attempt + 1); // one retry for transient tool errors
      } else {
        rec.status = "error";
        rec.error = message;
        await store.save(rec);
      }
    }
  });
}

async function runPipeline(rec: CaptureRecord): Promise<void> {
  const dir = path.dirname(rec.rawPath);

    rec.probe = await probeVideo(rec.rawPath);
    await store.save(rec);

    rec.thumbnailPath = await extractThumbnail(rec.rawPath, dir);
    await store.save(rec);

    if (rec.probe.hasAudio) {
      const { text, srtPath } = await transcribe(rec.rawPath, dir);
      rec.transcript = text;
      rec.srtPath = srtPath;
    } else {
      rec.transcript = "";
      rec.srtPath = null;
    }
    await store.save(rec);

    rec.plan = await generateContentPlan({
      transcript: rec.transcript ?? "",
      probeWarnings: rec.probe.warnings,
    });
    await store.save(rec);

    if (rec.plan.usable) {
      rec.brandedPath = await renderBranded({
        rawPath: rec.rawPath,
        outDir: dir,
        title: rec.plan.onScreenTitle,
        cta: rec.plan.cta,
        brandColor: config.brand.primaryColor,
        srtPath: rec.srtPath,
        durationSec: rec.probe.durationSec,
      });
    }

    rec.status = "needs_review";
    await store.save(rec);
    console.log(`[pipeline] ${rec.captureId} → needs_review`);
}

/// Recover captures that were mid-processing when the server last stopped.
export async function requeueInterrupted(): Promise<number> {
  const all = await store.list();
  const stuck = all.filter((r) => r.status === "processing" && !r.brandedPath);
  for (const rec of stuck) enqueuePipeline(rec);
  return stuck.length;
}
