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
  const rawWidth = Number(video?.width ?? 0);
  const rawHeight = Number(video?.height ?? 0);
  const [fpsNum, fpsDen] = String(video?.r_frame_rate ?? "0/1").split("/").map(Number);
  const fps = fpsDen ? fpsNum / fpsDen : 0;

  // iPhones record in the sensor's native landscape and set a rotation flag,
  // so the raw dimensions say 1280x720 for footage that displays as portrait.
  // ffmpeg rotates on decode, and judging orientation on the raw numbers
  // produced a false "landscape" warning on every clip — which then reached the
  // LLM and had it writing advice about cropping that was never going to happen.
  const rotation = Math.abs(
    Number(
      video?.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ??
        video?.tags?.rotate ??
        0,
    ),
  );
  const quarterTurned = rotation === 90 || rotation === 270;
  const width = quarterTurned ? rawHeight : rawWidth;
  const height = quarterTurned ? rawWidth : rawHeight;

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
  try {
    const srt = await readFile(srtPath, "utf8");
    const cleaned = stripHallucinatedCues(srt);
    if (!cleaned.text) {
      // Nothing but noise. Drop the SRT too: burning it in would put invented
      // subtitles on screen, and feeding it to the LLM would have it writing
      // about things nobody said.
      return { text: "", srtPath: null };
    }
    if (cleaned.rewritten) await writeFile(srtPath, cleaned.srt, "utf8");
    return { text: cleaned.text, srtPath };
  } catch {
    return { text: "", srtPath: null };
  }
}

/// Whisper invents content when handed silence — "(Müzik - Jenerik)",
/// "[Music]", "♪♪♪", "Thanks for watching!" — and with language auto-detection
/// it will happily do so in a language nobody in the room speaks. On a station
/// filming a quiet shop this is the common case, not the edge case, so cues
/// that are pure non-speech annotation are removed before anything downstream
/// sees them.
function stripHallucinatedCues(srt: string): { text: string; srt: string; rewritten: boolean } {
  const NON_SPEECH = /^[\s]*[([\[【♪~-]*[\s]*(m[uü]zik|music|musique|müzik|jenerik|applause|alkış|silence|sessizlik|sous-titr\w*|amara\.org|thanks for watching|thank you for watching|subscribe|altyaz\w*)[^)\]】]*[)\]】]?[\s]*$/i;
  const PUNCTUATION_ONLY = /^[\s♪~.,!?…\-–—*]*$/;

  const blocks = srt.split(/\n\s*\n/).filter((b) => b.trim());
  const kept: string[] = [];
  const spoken: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const timing = lines.findIndex((l) => l.includes("-->"));
    if (timing === -1) continue;
    const body = lines.slice(timing + 1).join(" ").replace(/\s+/g, " ").trim();
    if (!body || PUNCTUATION_ONLY.test(body) || NON_SPEECH.test(body)) continue;
    kept.push(block);
    spoken.push(body);
  }

  const rewritten = kept.length !== blocks.length;
  // Renumber so the SRT stays valid after removals.
  const srtOut = kept
    .map((block, i) => {
      const lines = block.split("\n");
      const timing = lines.findIndex((l) => l.includes("-->"));
      return [String(i + 1), ...lines.slice(timing)].join("\n");
    })
    .join("\n\n");

  return { text: spoken.join(" ").trim(), srt: srtOut ? `${srtOut}\n` : "", rewritten };
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
/// Fit a line of copy inside the 1080px frame.
///
/// drawtext neither wraps nor shrinks: a title longer than the frame is simply
/// clipped at both edges, which is what happened to "15s Faster Drilling Demo |
/// No Talking, Just Results". Models will not reliably respect a length limit
/// in a prompt, so the renderer takes responsibility — wrap to two lines, shrink
/// to fit, and only truncate when even the smallest size overflows.
function fitText(
  raw: string,
  { maxFontSize, minFontSize, maxLines }: { maxFontSize: number; minFontSize: number; maxLines: number },
): { lines: string[]; fontSize: number } {
  const SAFE_WIDTH = 980; // 1080 frame less a comfortable margin
  // Arial's average advance is close to 0.52em across mixed-case text; the
  // border adds a couple of pixels per glyph.
  const widthOf = (line: string, size: number) => line.length * size * 0.52;

  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: [], fontSize: maxFontSize };

  for (let size = maxFontSize; size >= minFontSize; size -= 2) {
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (widthOf(candidate, size) <= SAFE_WIDTH) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    if (lines.length <= maxLines && lines.every((l) => widthOf(l, size) <= SAFE_WIDTH)) {
      return { lines: lines.map(escapeDrawText), fontSize: size };
    }
  }

  // Still too long at the smallest size — keep what fits and mark the cut.
  const perLine = Math.floor(SAFE_WIDTH / (minFontSize * 0.52));
  const clipped: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= perLine) current = candidate;
    else {
      clipped.push(current);
      current = word;
      if (clipped.length === maxLines) break;
    }
  }
  if (clipped.length < maxLines && current) clipped.push(current);
  const trimmed = clipped.slice(0, maxLines);
  trimmed[trimmed.length - 1] = `${trimmed[trimmed.length - 1].replace(/\s+\S*$/, "")}…`;
  return { lines: trimmed.map(escapeDrawText), fontSize: minFontSize };
}

/// drawtext treats these as syntax, so they have to survive as literals.
function escapeDrawText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

/// One drawtext filter per line, stacked by line height. Embedding newlines in
/// a single drawtext is unreliable: the filtergraph parser consumes the escape
/// before drawtext sees it.
function drawLines(
  block: { lines: string[]; fontSize: number },
  { color, firstBaselineY, enable }: { color: string; firstBaselineY: number; enable: string },
): string[] {
  const lineHeight = Math.round(block.fontSize * 1.15);
  return block.lines.map(
    (line, i) =>
      `drawtext=fontfile='${FONT_FILE}':text='${line}':fontcolor=${color}:fontsize=${block.fontSize}:borderw=3:bordercolor=black:x=(w-text_w)/2:y=${firstBaselineY + i * lineHeight}:enable='${enable}'`,
  );
}

export async function renderBranded(opts: RenderOptions): Promise<string> {
  await mkdir(opts.outDir, { recursive: true });
  const out = path.join(opts.outDir, "branded.mp4");

  const titleBlock = fitText(opts.title, { maxFontSize: 64, minFontSize: 40, maxLines: 2 });
  const ctaBlock = fitText(opts.cta, { maxFontSize: 52, minFontSize: 34, maxLines: 2 });
  const endCardStart = Math.max(opts.durationSec - 2.5, 0).toFixed(2);

  const filters: string[] = [
    "scale=1080:1920:force_original_aspect_ratio=decrease",
    "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
    ...drawLines(titleBlock, {
      color: opts.brandColor,
      firstBaselineY: 140,
      enable: "between(t,0,4)",
    }),
  ];

  if (opts.srtPath) {
    const escaped = opts.srtPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
    filters.push(`subtitles='${escaped}':force_style='FontName=Arial,FontSize=18,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=1,Outline=2,Alignment=2,MarginV=180'`);
  }

  filters.push(
    ...drawLines(ctaBlock, {
      color: "white",
      firstBaselineY: 1920 - 220 - (ctaBlock.lines.length - 1) * Math.round(ctaBlock.fontSize * 1.15),
      enable: `gte(t,${endCardStart})`,
    }),
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

/// Mean scene-change score across the clip: how much the picture actually
/// moves. A mounted station films the same corner all day, so most clips show
/// an empty shop and nothing else. Real handheld footage measures around 0.013;
/// a genuinely static frame measures 0.000003 — four orders of magnitude apart,
/// which is enough separation to throw away dead clips before spending anything
/// on describing them.
export async function measureMotion(rawPath: string): Promise<number> {
  try {
    const { stdout, stderr } = await run(
      config.ffmpeg,
      ["-v", "error", "-i", rawPath, "-vf", "select='gt(scene,0)',metadata=print:file=-", "-an", "-f", "null", "-"],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    // metadata=print writes to stdout; ffmpeg's own logging goes to stderr.
    const scores = [...`${stdout}${stderr}`.matchAll(/scene_score=([0-9.]+)/g)].map((m) => Number(m[1]));
    // No readings at all means the measurement did not work, not that the clip
    // is empty. Fail open: culling is an optimisation and must never be the
    // reason real footage is thrown away.
    if (!scores.length) return Number.POSITIVE_INFINITY;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  } catch {
    // Never let the culling stage be the reason a capture fails.
    return Number.POSITIVE_INFINITY;
  }
}

/// Evenly spaced stills for the vision pass. One frame from the middle would
/// miss a customer who walks in at the end.
export async function extractFrames(
  rawPath: string,
  outDir: string,
  durationSec: number,
  count = 3,
): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = Math.max(0, durationSec * ((i + 1) / (count + 1)));
    const out = path.join(outDir, `frame-${i}.jpg`);
    try {
      await ffmpeg(["-y", "-ss", at.toFixed(2), "-i", rawPath, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "5", out]);
      paths.push(out);
    } catch {
      // A frame we cannot grab is simply one fewer frame to describe.
    }
  }
  return paths;
}
