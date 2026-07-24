import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const run = promisify(execFile);

export interface VideoProbe {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  codec: string;
  warnings: string[];
}

async function ffprobe(args: string[]): Promise<string> {
  const { stdout } = await run(config.ffprobe, args, { maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

async function ffmpeg(args: string[]): Promise<void> {
  await run(config.ffmpeg, args, { maxBuffer: 8 * 1024 * 1024 });
}

/// Inspect the raw capture: duration, orientation, audio, quality warnings.
export async function probeVideo(rawPath: string): Promise<VideoProbe> {
  const json = await ffprobe([
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    rawPath,
  ]);
  const meta = JSON.parse(json);
  const video = meta.streams?.find((s: any) => s.codec_type === "video");
  const audio = meta.streams?.find((s: any) => s.codec_type === "audio");

  const durationSec = Number(meta.format?.duration ?? 0);
  const width = Number(video?.width ?? 0);
  const height = Number(video?.height ?? 0);
  const [fpsNum, fpsDen] = String(video?.r_frame_rate ?? "0/1").split("/").map(Number);
  const fps = fpsDen ? fpsNum / fpsDen : 0;

  const warnings: string[] = [];
  if (durationSec < 3) warnings.push("clip very short (<3s)");
  if (durationSec > 60) warnings.push("clip longer than 60s — will be trimmed");
  if (!audio) warnings.push("no audio track");
  if (width > height) warnings.push("landscape orientation — will be padded to 9:16");
  if (height && height < 720) warnings.push("low resolution (<720p)");

  return {
    durationSec,
    width,
    height,
    fps: Math.round(fps * 100) / 100,
    hasAudio: Boolean(audio),
    codec: video?.codec_name ?? "unknown",
    warnings,
  };
}

/// Poster frame for the dashboard review card, taken ~20% into the clip.
export async function extractThumbnail(rawPath: string, outDir: string): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const out = path.join(outDir, "thumbnail.jpg");
  await ffmpeg(["-y", "-ss", "1", "-i", rawPath, "-frames:v", "1", "-q:v", "3", out]);
  return out;
}

/// Extract 16kHz mono WAV for whisper, then transcribe. Returns transcript
/// text and segments with timestamps (used later for burned-in subtitles).
export async function transcribe(
  rawPath: string,
  outDir: string,
): Promise<{ text: string; srtPath: string | null }> {
  await mkdir(outDir, { recursive: true });
  const wavPath = path.join(outDir, "audio.wav");
  await ffmpeg(["-y", "-i", rawPath, "-vn", "-ac", "1", "-ar", "16000", wavPath]);

  const outPrefix = path.join(outDir, "transcript");
  try {
    await run(config.whisperCli, [
      "-m", config.whisperModel,
      "-f", wavPath,
      "-l", config.whisperLanguage,
      "-osrt",
      "-of", outPrefix,
      "--no-prints",
    ], { maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    return { text: "", srtPath: null };
  }

  const srtPath = `${outPrefix}.srt`;
  let text = "";
  try {
    const srt = await readFile(srtPath, "utf8");
    text = srt
      .split("\n")
      .filter((l) => l && !/^\d+$/.test(l) && !l.includes("-->"))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return { text: "", srtPath: null }; // empty SRT — libass can't open it
  } catch {
    return { text: "", srtPath: null };
  }
  return { text, srtPath };
}

export interface RenderOptions {
  rawPath: string;
  outDir: string;
  title: string;
  cta: string;
  brandColor: string;
  srtPath?: string | null;
  durationSec: number;
}

const FONT_FILE = "/System/Library/Fonts/Supplemental/Arial.ttf";

/// Deterministic 9:16 render: scale/pad to 1080x1920, hook title at top,
/// end-card CTA for the last 2.5s, optional burned-in subtitles, H.264 + AAC.
export async function renderBranded(opts: RenderOptions): Promise<string> {
  await mkdir(opts.outDir, { recursive: true });
  const out = path.join(opts.outDir, "branded.mp4");

  const title = opts.title.replace(/'/g, "\\'").replace(/:/g, "\\:");
  const cta = opts.cta.replace(/'/g, "\\'").replace(/:/g, "\\:");
  const endCardStart = Math.max(opts.durationSec - 2.5, 0).toFixed(2);

  const filters: string[] = [
    "scale=1080:1920:force_original_aspect_ratio=decrease",
    "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
    `drawtext=fontfile='${FONT_FILE}':text='${title}':fontcolor=${opts.brandColor}:fontsize=64:borderw=3:bordercolor=black:x=(w-text_w)/2:y=140:enable='between(t,0,4)'`,
  ];

  if (opts.srtPath) {
    const escaped = opts.srtPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
    filters.push(`subtitles='${escaped}':force_style='FontName=Arial,FontSize=18,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=1,Outline=2,Alignment=2,MarginV=180'`);
  }

  filters.push(
    `drawtext=fontfile='${FONT_FILE}':text='${cta}':fontcolor=white:fontsize=52:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-220:enable='gte(t,${endCardStart})'`,
  );

  await ffmpeg([
    "-y",
    "-i", opts.rawPath,
    "-t", "45",
    "-vf", filters.join(","),
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "21",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    out,
  ]);
  return out;
}
