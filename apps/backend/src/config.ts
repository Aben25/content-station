import path from "node:path";
import os from "node:os";

const TOOLS = path.resolve(os.homedir(), "Projects/content-station/tools");

export const config = {
  port: Number(process.env.PORT ?? 3000),
  uploadDir: path.resolve(process.cwd(), "uploads"),
  ffmpeg: process.env.FFMPEG_PATH ?? path.join(TOOLS, "bin/ffmpeg"),
  ffprobe: process.env.FFPROBE_PATH ?? path.join(TOOLS, "bin/ffprobe"),
  whisperCli: process.env.WHISPER_CLI ?? "/tmp/whisper.cpp/build/bin/whisper-cli",
  whisperModel:
    process.env.WHISPER_MODEL ?? path.join(TOOLS, "models/ggml-base.en.bin"),

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
    primaryColor: process.env.BRAND_COLOR ?? "#FFFFFF",
    defaultCta: process.env.DEFAULT_CTA ?? "Come see us today!",
    prohibitedClaims: (process.env.PROHIBITED_CLAIMS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },

  // Pilot hardening
  rawRetentionDays: Number(process.env.RAW_RETENTION_DAYS ?? 7),
} as const;
