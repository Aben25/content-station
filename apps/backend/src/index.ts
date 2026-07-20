import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

const app = Fastify({ logger: true });

await app.register(multipart, {
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB cap for 30s 1080p clips
});

app.get("/health", async () => ({ status: "ok", service: "content-station-backend" }));

// Phase 1 ingest endpoint: station posts a video file, we store it and
// return a capture record. AI processing (Phase 2) hooks in after this.
app.post("/upload", async (req, reply) => {
  const file = await req.file();
  if (!file) {
    return reply.code(400).send({ error: "no file provided" });
  }

  const captureId = randomUUID();
  const captureDir = path.join(UPLOAD_DIR, captureId);
  await mkdir(captureDir, { recursive: true });

  const ext = path.extname(file.filename || "") || ".mp4";
  const filePath = path.join(captureDir, `raw${ext}`);
  await pipeline(file.file, createWriteStream(filePath));

  const { size } = await stat(filePath);
  req.log.info({ captureId, size, filename: file.filename }, "capture stored");

  return reply.code(201).send({
    captureId,
    filename: file.filename,
    bytes: size,
    status: "stored",
  });
});

// List captures — stub the dashboard will eventually consume.
app.get("/captures", async () => {
  const { readdir } = await import("node:fs/promises");
  try {
    const entries = await readdir(UPLOAD_DIR, { withFileTypes: true });
    return { captures: entries.filter((e) => e.isDirectory()).map((e) => e.name) };
  } catch {
    return { captures: [] };
  }
});

const port = Number(process.env.PORT ?? 3000);
try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
