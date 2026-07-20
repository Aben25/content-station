import path from "node:path";
import type { CaptureRecord } from "./store.js";

/// Postiz publishing layer. Only the backend talks to Postiz — the API key
/// never leaves this process. MVP behavior: create Postiz DRAFTS (never
/// auto-publish). Configured via POSTIZ_API_URL / POSTIZ_API_KEY /
/// POSTIZ_INTEGRATION_IDS in .env.
export interface PostizResult {
  draftId: string;
  mode: "live" | "stub";
}

interface PostizConfig {
  apiUrl: string;
  apiKey: string;
  integrations: string[];
}

interface UploadedMedia {
  id: string;
  path: string;
}

function postizConfig(): PostizConfig | null {
  const apiUrl = process.env.POSTIZ_API_URL;
  const apiKey = process.env.POSTIZ_API_KEY;
  if (!apiUrl || !apiKey) return null;
  return {
    apiUrl: apiUrl.replace(/\/$/, ""),
    apiKey,
    integrations: (process.env.POSTIZ_INTEGRATION_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

async function uploadMedia(cfg: PostizConfig, filePath: string): Promise<UploadedMedia> {
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "video/mp4" }), path.basename(filePath));

  const res = await fetch(`${cfg.apiUrl}/upload`, {
    method: "POST",
    headers: { Authorization: cfg.apiKey },
    body: form,
  });
  if (!res.ok) throw new Error(`Postiz media upload ${res.status}: ${await res.text()}`);
  return (await res.json()) as UploadedMedia;
}

/// Provider-specific settings required by the Postiz posts API.
function settingsFor(identifier: string): Record<string, unknown> {
  if (identifier === "tiktok") {
    return {
      __type: "tiktok",
      privacy_level: "PUBLIC_TO_EVERYONE",
      duet: false,
      stitch: false,
      comment: true,
      autoAddMusic: "no",
      brand_content_toggle: false,
      brand_organic_toggle: false,
      content_posting_method: "UPLOAD",
    };
  }
  if (identifier.startsWith("instagram")) {
    return { __type: identifier, post_type: "post" };
  }
  return { __type: identifier };
}

/// Fetch integration identifiers (tiktok, instagram, ...) for the IDs we
/// have configured, so each post gets the right settings schema.
async function fetchIntegrationTypes(cfg: PostizConfig): Promise<Map<string, string>> {
  const res = await fetch(`${cfg.apiUrl}/integrations`, {
    headers: { Authorization: cfg.apiKey },
  });
  if (!res.ok) throw new Error(`Postiz integrations ${res.status}: ${await res.text()}`);
  const list = (await res.json()) as Array<{ id: string; identifier: string }>;
  const map = new Map<string, string>();
  for (const i of list) {
    if (cfg.integrations.includes(i.id)) map.set(i.id, i.identifier);
  }
  return map;
}

/// Create a Postiz draft from an approved capture. When Postiz isn't
/// configured, returns a stub result so the approval flow is fully testable
/// before social accounts are connected.
export async function createPostizDraft(rec: CaptureRecord): Promise<PostizResult> {
  const cfg = postizConfig();
  const branded = rec.brandedPath ?? rec.rawPath;

  if (!cfg || cfg.integrations.length === 0) {
    console.log(`[postiz] not configured — stub draft for ${rec.captureId}`);
    return { draftId: `stub-${rec.captureId}`, mode: "stub" };
  }

  const media = await uploadMedia(cfg, branded);
  const integrationTypes = await fetchIntegrationTypes(cfg);

  const caption = rec.plan?.captions.tiktok ?? rec.plan?.captions.instagram ?? "";
  const hashtags = (rec.plan?.hashtags ?? []).join(" ");

  const res = await fetch(`${cfg.apiUrl}/posts`, {
    method: "POST",
    headers: { Authorization: cfg.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "draft",
      date: new Date().toISOString(),
      shortLink: false,
      tags: [],
      posts: cfg.integrations.map((id) => ({
        integration: { id },
        value: [
          {
            content: `${caption}\n\n${hashtags}`.trim(),
            image: [{ id: media.id, path: media.path }],
          },
        ],
        settings: settingsFor(integrationTypes.get(id) ?? ""),
      })),
    }),
  });
  if (!res.ok) throw new Error(`Postiz create post ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as Array<{ postId: string; integration: string }>;
  return { draftId: data[0]?.postId ?? "unknown", mode: "live" };
}
