import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { pipeline as pipe } from "node:stream/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { queue } from "./queue.js";
import { store, type CaptureRecord } from "./store.js";
import { enqueuePipeline, requeueInterrupted } from "./pipeline.js";

const app = Fastify({ logger: true });

await app.register(multipart, {
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB cap for 30s 1080p clips
});

// Dashboard runs on a different origin (localhost:3001, or the owner's
// phone on the LAN) — allow cross-origin reads and the review POST.
await app.register(cors, { origin: true });

app.get("/health", async () => ({ status: "ok", service: "content-station-backend", queue: queue.stats }));

// --- Capture ingest -------------------------------------------------------

app.post("/upload", async (req, reply) => {
  const file = await req.file();
  if (!file) {
    return reply.code(400).send({ error: "no file provided" });
  }

  const captureId = randomUUID();
  const captureDir = path.join(config.uploadDir, captureId);
  await mkdir(captureDir, { recursive: true });

  const ext = path.extname(file.filename || "") || ".mp4";
  const rawPath = path.join(captureDir, `raw${ext}`);
  await pipe(file.file, createWriteStream(rawPath));

  const { size } = await stat(rawPath);

  const rec: CaptureRecord = {
    captureId,
    filename: file.filename || `raw${ext}`,
    bytes: size,
    rawPath,
    status: "processing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.save(rec);
  enqueuePipeline(rec);

  req.log.info({ captureId, size }, "capture stored, pipeline queued");
  return reply.code(201).send({ captureId, bytes: size, status: "processing" });
});

// --- Drafts (dashboard API) ----------------------------------------------

app.get("/captures", async () => {
  const all = await store.list();
  return { captures: all.map((r) => ({ captureId: r.captureId, status: r.status, createdAt: r.createdAt })) };
});

app.get("/drafts", async () => {
  const all = await store.list();
  return {
    drafts: all.map((r) => ({
      captureId: r.captureId,
      status: r.status,
      createdAt: r.createdAt,
      probe: r.probe,
      transcript: r.transcript,
      plan: r.plan,
      hasThumbnail: Boolean(r.thumbnailPath),
      hasBrandedVideo: Boolean(r.brandedPath),
      error: r.error,
    })),
  };
});

app.get<{ Params: { id: string } }>("/drafts/:id", async (req, reply) => {
  const rec = await store.get(req.params.id);
  if (!rec) return reply.code(404).send({ error: "not found" });
  return rec;
});

app.post<{
  Params: { id: string };
  Body: {
    action: string;
    selectedHook?: string;
    captions?: { instagram?: string; tiktok?: string; facebook?: string };
    cta?: string;
    platforms?: string[];
  };
}>("/drafts/:id/review", async (req, reply) => {
  const rec = await store.get(req.params.id);
  if (!rec) return reply.code(404).send({ error: "not found" });
  if (rec.status !== "needs_review") return reply.code(409).send({ error: `draft is ${rec.status}` });

  const { action, selectedHook, captions, cta, platforms } = req.body ?? {};

  if (action === "approve") {
    // Apply owner edits before approving
    if (rec.plan) {
      if (selectedHook && rec.plan.hookOptions.includes(selectedHook)) {
        rec.plan.selectedHook = selectedHook;
      }
      if (captions) {
        rec.plan.captions = { ...rec.plan.captions, ...captions };
      }
      if (cta) rec.plan.cta = cta;
    }
    rec.approvedPlatforms = platforms?.length ? platforms : rec.plan?.platforms;

    try {
      const { createPostizDraft } = await import("./postiz.js");
      const result = await createPostizDraft(rec);
      rec.postizDraftId = result.draftId;
      req.log.info({ captureId: rec.captureId, postiz: result }, "approved → Postiz draft");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ captureId: rec.captureId, err: message }, "Postiz draft failed");
      return reply.code(502).send({ error: `Postiz failed: ${message}` });
    }
    rec.status = "approved";
  } else if (action === "reject") {
    rec.status = "rejected";
  } else {
    return reply.code(400).send({ error: "action must be approve|reject" });
  }

  await store.save(rec);
  return { captureId: rec.captureId, status: rec.status, postizDraftId: rec.postizDraftId };
});

// Media serving for the dashboard preview (dev only; use signed URLs later)
app.get<{ Params: { id: string; kind: string } }>("/media/:id/:kind", async (req, reply) => {
  const rec = await store.get(req.params.id);
  if (!rec) return reply.code(404).send({ error: "not found" });

  const map: Record<string, string | undefined> = {
    raw: rec.rawPath,
    thumb: rec.thumbnailPath,
    branded: rec.brandedPath,
  };
  const filePath = map[req.params.kind];
  if (!filePath) return reply.code(404).send({ error: "media not ready" });

  const { createReadStream } = await import("node:fs");
  reply.header("Content-Type", req.params.kind === "thumb" ? "image/jpeg" : "video/mp4");
  return reply.send(createReadStream(filePath));
});

// --- Startup ---------------------------------------------------------------

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  const recovered = await requeueInterrupted();
  if (recovered > 0) app.log.info(`requeued ${recovered} interrupted capture(s)`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
