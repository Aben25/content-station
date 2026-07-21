import path from "node:path";
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
  whisperModel:
    process.env.WHISPER_MODEL ?? path.join(TOOLS, "models/ggml-base.en.bin"),

  auth: {
    stationToken: process.env.STATION_TOKEN ?? "",
    ownerToken: process.env.OWNER_TOKEN ?? "",
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
} as const;
