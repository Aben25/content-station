import { createReadStream } from "node:fs";
import path from "node:path";
import type { CaptureRecord } from "./store.js";

/// Postiz publishing layer. Only the backend talks to Postiz — the API key
/// never leaves this process. MVP behavior: create Postiz DRAFTS (never
/// auto-publish). Set POSTIZ_API_URL + POSTIZ_API_KEY to enable.
export interface PostizResult {
  draftId: string;
  mode: "live" | "stub";
}

interface PostizConfig {
  apiUrl: string;
  apiKey: string;
  integrations: string[]; // Postiz integration IDs for IG/TikTok/FB
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

async function uploadMedia(cfg: PostizConfig, filePath: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "video/mp4" }), path.basename(filePath));

  const res = await fetch(`${cfg.apiUrl}/media/upload`, {
    method: "POST",
    headers: { Authorization: cfg.apiKey },
    body: form,
  });
  if (!res.ok) throw new Error(`Postiz media upload ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

/// Create a Postiz draft from an approved capture. When Postiz isn't
/// configured, returns a stub result so the approval flow is fully testable
/// before social accounts are connected.
export async function createPostizDraft(rec: CaptureRecord): Promise<PostizResult> {
  const cfg = postizConfig();
  const branded = rec.brandedPath ?? rec.rawPath;

  if (!cfg) {
    console.log(`[postiz] not configured — stub draft for ${rec.captureId}`);
    return { draftId: `stub-${rec.captureId}`, mode: "stub" };
  }

  const mediaId = await uploadMedia(cfg, branded);

  const res = await fetch(`${cfg.apiUrl}/posts`, {
    method: "POST",
    headers: { Authorization: cfg.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "draft",
      media: [{ id: mediaId }],
      posts: cfg.integrations.map((integration) => ({
        integration,
        value: [
          {
            content: rec.plan?.captions.instagram ?? "",
            media: [{ id: mediaId }],
          },
        ],
      })),
    }),
  });
  if (!res.ok) throw new Error(`Postiz create post ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { id?: string };
  return { draftId: data.id ?? "unknown", mode: "live" };
}
