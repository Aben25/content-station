import { readFile } from "node:fs/promises";
import { config } from "./config.js";

/// What the camera actually saw.
///
/// Without this the content model was writing from the transcript alone, and a
/// silent clip left it with nothing at all — so it invented. A real capture of
/// a desk and two laptops became "1 WRENCH = 3 JOBS DONE". Everything here
/// exists to make the copy answerable to the footage.
export interface SceneDescription {
  /// Plain description of the frames, fed to the content model.
  description: string;
  /// Concrete things visible, useful for hashtags and product mentions.
  objects: string[];
  /// Whether the frames show the business at all. False kills the draft.
  showsBusiness: boolean;
  /// Why, in the model's words — surfaced to the owner when a clip is rejected.
  reason: string;
}

const SYSTEM = `You describe still frames from a shop's security-style camera so a copywriter can write social posts that match the footage. Report only what is visible. Never guess at products, activities or people that are not in frame.`;

function userPrompt(business: string, category: string): string {
  return `These frames are from one short vertical clip filmed at "${business}", a ${category}.

Return ONLY valid JSON:
{"description": string, "objects": [string], "showsBusiness": boolean, "reason": string}

- description: 1-3 sentences on what is visible and what, if anything, is happening.
- objects: concrete things you can actually see.
- showsBusiness: true only if the frames plausibly show this business — its premises, stock, staff, customers or work being done. Personal desks, private homes, screens, or an empty room with nothing relevant are false.
- reason: one sentence explaining the showsBusiness verdict.`;
}

async function toDataURL(framePath: string): Promise<string> {
  const bytes = await readFile(framePath);
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

/// Describe the frames. Returns null when vision is disabled or unavailable —
/// the pipeline then falls back to its previous transcript-only behaviour
/// rather than failing the capture.
export async function describeScene(framePaths: string[]): Promise<SceneDescription | null> {
  if (!config.vision.enabled || !framePaths.length) return null;

  const content: unknown[] = [
    { type: "text", text: userPrompt(config.brand.businessName, config.brand.category) },
  ];
  for (const framePath of framePaths) {
    content.push({ type: "image_url", image_url: { url: await toDataURL(framePath) } });
  }

  const res = await fetch(`${config.llmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.llmApiKey}` },
    body: JSON.stringify({
      model: config.vision.model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
      // Reasoning models spend most of their budget thinking; too small a
      // ceiling returns an empty message rather than an error.
      max_tokens: config.vision.maxTokens,
      temperature: 0.2,
    }),
  });

  if (!res.ok) throw new Error(`vision ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as any;
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("empty vision response");

  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("vision response was not JSON");
  const parsed = JSON.parse(json) as Partial<SceneDescription>;

  return {
    description: String(parsed.description ?? "").trim(),
    objects: Array.isArray(parsed.objects) ? parsed.objects.map(String) : [],
    // Absent verdict is treated as "shows the business" so a malformed reply
    // never silently discards footage.
    showsBusiness: parsed.showsBusiness !== false,
    reason: String(parsed.reason ?? "").trim(),
  };
}
