import { config } from "./config.js";

export interface ContentPlan {
  usable: boolean;
  angle: string;
  hookOptions: string[];
  selectedHook: string;
  onScreenTitle: string;
  captions: { instagram: string; tiktok: string; facebook: string };
  cta: string;
  hashtags: string[];
  platforms: string[];
  recommendedTime: string;
  warnings: string[];
}

interface PlanInput {
  transcript: string;
  probeWarnings: string[];
  /// What the camera saw. Absent when vision is disabled or failed, in which
  /// case the model is working from the transcript alone and may invent.
  scene?: { description: string; objects: string[] } | null;
}

const FALLBACK_HOOKS = [
  "You had to be here for this",
  "This just happened",
  "Wait for it…",
];

/// Ask the configured LLM for a structured content plan. Falls back to a
/// deterministic template plan when the LLM endpoint is unreachable, so the
/// pipeline always produces a reviewable draft.
export async function generateContentPlan(input: PlanInput): Promise<ContentPlan> {
  if (config.llmBaseUrl && config.llmApiKey) {
    try {
      const plan = await llmPlan(input);
      return enforceProhibited(plan);
    } catch (err) {
      console.warn("[hermes] LLM plan failed, using fallback:", err);
    }
  }

  // Deterministic fallback (LLM unreachable)
  const b = config.brand;
  const excerpt = (input.scene?.description || input.transcript).split(" ").slice(0, 12).join(" ");
  const hook = excerpt ? `"${excerpt}…"` : FALLBACK_HOOKS[0];
  return {
    usable: true,
    angle: "today at the business",
    hookOptions: [hook, ...FALLBACK_HOOKS.slice(1)],
    selectedHook: hook,
    onScreenTitle: `Today at ${b.businessName}`,
    captions: {
      instagram: `A moment from today at ${b.businessName}. ${b.defaultCta}`,
      tiktok: `things that happen at ${b.businessName} 👀 ${b.defaultCta}`,
      facebook: `Here's what happened at ${b.businessName} today. ${b.defaultCta}`,
    },
    cta: b.defaultCta,
    hashtags: ["#localbusiness", `#${b.category.replace(/\s+/g, "")}`, "#behindthescenes"],
    platforms: ["instagram", "tiktok", "facebook"],
    recommendedTime: "today 5:30 PM local",
    warnings: [
      ...input.probeWarnings,
      ...(input.transcript ? [] : ["no speech detected — relying on visuals"]),
      "AI plan generated without LLM (Hermes endpoint unreachable)",
    ],
  };
}

/// Hard guard: even if the LLM slips, prohibited claims never reach the
/// owner. Offending captions are replaced with a safe default and flagged.
function enforceProhibited(plan: ContentPlan): ContentPlan {
  const banned = config.brand.prohibitedClaims.map((s) => s.toLowerCase());
  if (banned.length === 0) return plan;

  const fields: Array<[keyof ContentPlan["captions"], string]> = [
    ["instagram", plan.captions.instagram],
    ["tiktok", plan.captions.tiktok],
    ["facebook", plan.captions.facebook],
  ];
  for (const [key, text] of fields) {
    const hit = banned.find((phrase) => text.toLowerCase().includes(phrase));
    if (hit) {
      plan.captions[key] = `A moment from today at ${config.brand.businessName}. ${config.brand.defaultCta}`;
      plan.warnings = [...(plan.warnings ?? []), `prohibited claim "${hit}" removed from ${key} caption`];
    }
  }
  return plan;
}

async function llmPlan(input: PlanInput): Promise<ContentPlan> {
  const b = config.brand;
  const system = `You are Hermes, the content director for ${b.businessName}, a ${b.category}${b.location ? ` in ${b.location}` : ""}.
Target audience: ${b.audience}. Brand tone: ${b.tone}.
Never use prohibited claims: ${b.prohibitedClaims.join(", ") || "none"}.
Default CTA: ${b.defaultCta}.
Return ONLY valid JSON matching this exact shape:
{"usable":bool,"angle":string,"hookOptions":[3 strings],"selectedHook":string,
"onScreenTitle":string,"captions":{"instagram":string,"tiktok":string,"facebook":string},
"cta":string,"hashtags":[strings],"platforms":[strings],"recommendedTime":string,"warnings":[strings]}`;

  const seen = input.scene?.description
    ? `What the camera actually shows: """${input.scene.description}"""
Visible items: ${input.scene.objects.join(", ") || "none listed"}`
    : `What the camera shows: (not analysed — do not describe specific products, tools or activities you cannot confirm)`;

  const user = `${seen}
Transcript: """${input.transcript || "(no speech)"}"""
Quality warnings: ${input.probeWarnings.join("; ") || "none"}

Write about this clip only. Every concrete claim — products, actions, people —
must be supported by what the camera shows or the transcript. If neither gives
you specifics, write something true and general about the business rather than
inventing detail.

Create the content plan for this 15-30s vertical clip.`;

  const res = await fetch(`${config.llmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.llmApiKey}`,
    },
    body: JSON.stringify({
      model: config.llmModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    }),
  });

  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("empty LLM response");

  const plan = JSON.parse(content) as ContentPlan;
  if (!plan.hookOptions?.length || !plan.captions) throw new Error("malformed plan");
  plan.warnings = [...(plan.warnings ?? []), ...input.probeWarnings];
  return plan;
}
