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

  // Hermes content plan generation. Uses an OpenAI-compatible endpoint —
  // set CONTENT_LLM_BASE_URL + CONTENT_LLM_API_KEY to enable real plans.
  llmBaseUrl: process.env.CONTENT_LLM_BASE_URL ?? "",
  llmApiKey: process.env.CONTENT_LLM_API_KEY ?? "",
  llmModel: process.env.CONTENT_LLM_MODEL ?? "openai/gpt-4o-mini",

  brand: {
    businessName: process.env.BUSINESS_NAME ?? "Demo Business",
    category: process.env.BUSINESS_CATEGORY ?? "local business",
    primaryColor: process.env.BRAND_COLOR ?? "#FFFFFF",
    defaultCta: process.env.DEFAULT_CTA ?? "Come see us today!",
    prohibitedClaims: (process.env.PROHIBITED_CLAIMS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
} as const;
