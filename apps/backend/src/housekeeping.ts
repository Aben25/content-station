import { readdir, stat, unlink, rm } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { store } from "./store.js";

/// Pilot hardening: privacy + housekeeping.

/// Permanently delete one capture: record + all media files.
export async function deleteCapture(captureId: string): Promise<boolean> {
  const rec = await store.get(captureId);
  if (!rec) return false;
  await rm(path.join(config.uploadDir, captureId), { recursive: true, force: true });
  store.evict(captureId);
  return true;
}

/// Delete raw video older than RAW_RETENTION_DAYS (default 7, spec allows
/// 1–30). Branded renders and records are kept so approved drafts still
/// work; only the unedited footage is purged.
export async function sweepRetention(): Promise<{ purged: string[] }> {
  const cutoff = Date.now() - config.rawRetentionDays * 24 * 60 * 60 * 1000;
  const purged: string[] = [];

  let ids: string[] = [];
  try {
    const entries = await readdir(config.uploadDir, { withFileTypes: true });
    ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return { purged };
  }

  for (const id of ids) {
    const dir = path.join(config.uploadDir, id);
    try {
      const raw = path.join(dir, "raw.mp4");
      const info = await stat(raw);
      if (info.mtimeMs < cutoff) {
        await unlink(raw);
        // audio.wav is derived from raw and equally unedited — purge it too
        await unlink(path.join(dir, "audio.wav")).catch(() => {});
        purged.push(id);
      }
    } catch {
      // no raw.mp4 (already purged) — nothing to do
    }
  }
  return { purged };
}

/// Run the retention sweep once a day while the server is up.
export function startRetentionTimer(): void {
  const DAY = 24 * 60 * 60 * 1000;
  setInterval(() => {
    sweepRetention()
      .then(({ purged }) => {
        if (purged.length) console.log(`[retention] purged raw video for ${purged.length} capture(s)`);
      })
      .catch((err) => console.error("[retention] sweep failed:", err));
  }, DAY).unref();
}
