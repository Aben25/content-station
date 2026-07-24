import path from "node:path";
import { homedir, hostname } from "node:os";
import { fileURLToPath } from "node:url";

// apps/backend/src/config.ts → repo root → tools/. Resolved from this file so
// the backend runs from a clone in any directory, not just ~/Projects.
const TOOLS = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../tools");

/// ffmpeg's drawtext wants `0xRRGGBB`, not `#RRGGBB`, and rejects an empty
/// string outright — which is what an unquoted `BRAND_COLOR=#FFFFFF` produces,
/// since dotenv reads the `#` as a comment. Normalise, and fall back to white
/// so a bad brand colour can never break every render.
function ffmpegColor(raw: string | undefined): string {
  const hex = (raw ?? "").trim().replace(/^#/, "").replace(/^0x/i, "");
  return /^[0-9a-f]{6}$/i.test(hex) ? `0x${hex.toUpperCase()}` : "0xFFFFFF";
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3001",
  uploadDir: path.resolve(process.cwd(), "uploads"),
  ffmpeg: process.env.FFMPEG_PATH ?? path.join(TOOLS, "bin/ffmpeg"),
  ffprobe: process.env.FFPROBE_PATH ?? path.join(TOOLS, "bin/ffprobe"),
  whisperCli: process.env.WHISPER_CLI ?? path.join(TOOLS, "whisper/whisper-cli"),
  // Multilingual model by default — the .en model transcribes non-English
  // speech as nonsense rather than failing, which is worse than no transcript.
  // `auto` lets whisper detect; set WHISPER_LANGUAGE=am (Amharic), en, etc. to
  // pin it when the station's language is known.
  whisperModel:
    process.env.WHISPER_MODEL ?? path.join(TOOLS, "models/ggml-base.bin"),
  whisperLanguage: process.env.WHISPER_LANGUAGE ?? "auto",

  auth: {
    stationToken: process.env.STATION_TOKEN ?? "",
    ownerToken: process.env.OWNER_TOKEN ?? "",
  },

  // The Mac worker pulls jobs from Firestore instead of accepting inbound
  // uploads, so the station never needs a route into this machine.
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID ?? "lemekeru",
    bucket: process.env.FIREBASE_STORAGE_BUCKET ?? "lemekeru-content-station",
    serviceAccountPath:
      process.env.FIREBASE_SERVICE_ACCOUNT ??
      path.join(homedir(), ".config/content-station/worker-sa.json"),
    pollIntervalMs: Number(process.env.WORKER_POLL_MS ?? 5000),
    workerId: process.env.WORKER_ID ?? `${hostname()}-${process.pid}`,
    // A claim older than this is treated as a dead worker and retried.
    claimTimeoutMs: Number(process.env.WORKER_CLAIM_TIMEOUT_MS ?? 15 * 60 * 1000),
  },

  // Hermes content plan generation. Uses an OpenAI-compatible endpoint.
  // Default: local Hermes proxy (hermes proxy start --provider nous) which
  // forwards to the Nous Portal subscription with real credentials.
  llmBaseUrl: process.env.CONTENT_LLM_BASE_URL ?? "http://127.0.0.1:8645/v1",
  llmApiKey: process.env.CONTENT_LLM_API_KEY ?? "content-station",
  llmModel: process.env.CONTENT_LLM_MODEL ?? "x-ai/grok-4.5",

  brand: {
    businessName: process.env.BUSINESS_NAME ?? "Demo Business",
    category: process.env.BUSINESS_CATEGORY ?? "local business",
    location: process.env.BUSINESS_LOCATION ?? "",
    timezone: process.env.BUSINESS_TIMEZONE ?? "America/New_York",
    audience: process.env.TARGET_AUDIENCE ?? "local customers",
    tone: process.env.BRAND_TONE ?? "friendly and energetic",
    primaryColor: ffmpegColor(process.env.BRAND_COLOR),
    defaultCta: process.env.DEFAULT_CTA ?? "Come see us today!",
    prohibitedClaims: (process.env.PROHIBITED_CLAIMS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },

  // Pilot hardening
  rawRetentionDays: Number(process.env.RAW_RETENTION_DAYS ?? 7),

  // Look at the footage before writing about it. Without this the content
  // model only ever sees the transcript, and a silent clip leaves it inventing.
  vision: {
    enabled: (process.env.VISION_ENABLED ?? "true") !== "false",
    model: process.env.VISION_MODEL ?? process.env.CONTENT_LLM_MODEL ?? "stepfun/step-3.7-flash:free",
    maxTokens: Number(process.env.VISION_MAX_TOKENS ?? 3000),
    frames: Number(process.env.VISION_FRAMES ?? 3),
  },

  // Discard clips where nothing moves before spending anything on describing
  // them. Handheld footage measures ~0.013, a static frame ~0.000003.
  motionThreshold: Number(process.env.MOTION_THRESHOLD ?? 0.0005),
  cullStaticClips: (process.env.CULL_STATIC_CLIPS ?? "true") !== "false",

  // Delete the raw upload from Cloud Storage once a branded render exists.
  // Set DELETE_RAW_AFTER_RENDER=false to keep originals for re-editing.
  deleteRawAfterRender: (process.env.DELETE_RAW_AFTER_RENDER ?? "true") !== "false",
} as const;
