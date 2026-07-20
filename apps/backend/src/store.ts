import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import type { VideoProbe } from "./processing.js";
import type { ContentPlan } from "./hermes.js";

export type DraftStatus =
  | "processing"
  | "needs_review"
  | "approved"
  | "rejected"
  | "error";

export interface CaptureRecord {
  captureId: string;
  filename: string;
  bytes: number;
  rawPath: string;
  thumbnailPath?: string;
  brandedPath?: string;
  probe?: VideoProbe;
  transcript?: string;
  srtPath?: string | null;
  plan?: ContentPlan;
  status: DraftStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/// JSON-file persistence — one file per capture under uploads/. Durable
/// enough for the pilot; swap for Postgres in Phase 4.
export class Store {
  private cache = new Map<string, CaptureRecord>();

  async get(captureId: string): Promise<CaptureRecord | undefined> {
    if (this.cache.has(captureId)) return this.cache.get(captureId);
    try {
      const raw = await readFile(this.recordPath(captureId), "utf8");
      const rec = JSON.parse(raw) as CaptureRecord;
      this.cache.set(captureId, rec);
      return rec;
    } catch {
      return undefined;
    }
  }

  async save(rec: CaptureRecord): Promise<void> {
    rec.updatedAt = new Date().toISOString();
    this.cache.set(rec.captureId, rec);
    await mkdir(path.dirname(this.recordPath(rec.captureId)), { recursive: true });
    await writeFile(this.recordPath(rec.captureId), JSON.stringify(rec, null, 2));
  }

  async list(): Promise<CaptureRecord[]> {
    const { readdir } = await import("node:fs/promises");
    let ids: string[] = [];
    try {
      const entries = await readdir(config.uploadDir, { withFileTypes: true });
      ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
    const records = await Promise.all(ids.map((id) => this.get(id)));
    return records
      .filter((r): r is CaptureRecord => Boolean(r))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private recordPath(captureId: string): string {
    return path.join(config.uploadDir, captureId, "record.json");
  }
}

export const store = new Store();
