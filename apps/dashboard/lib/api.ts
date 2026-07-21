// Client-safe module: types, and the two calls the browser makes. The browser
// never talks to the backend directly — it goes through this app's own route
// handlers, so the owner token stays on the dashboard server. Server-side
// fetching lives in lib/backend.ts.

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

export interface Draft {
  captureId: string;
  status: "processing" | "needs_review" | "approved" | "rejected" | "error";
  createdAt: string;
  probe?: { durationSec: number; width: number; height: number; warnings: string[] };
  transcript?: string;
  plan?: ContentPlan;
  hasThumbnail: boolean;
  hasBrandedVideo: boolean;
  error?: string;
}

export interface DraftDetail extends Draft {
  postizDraftId?: string;
  approvedPlatforms?: string[];
}

export interface StationHealth {
  online: boolean;
  lastSeen: string | null;
  totalUploads: number;
  queue: { pending: number; running: boolean; completed: number; failed: number };
  retentionDays: number;
}

export async function submitReview(
  id: string,
  body: {
    action: "approve" | "reject";
    selectedHook?: string;
    captions?: Partial<ContentPlan["captions"]>;
    cta?: string;
    platforms?: string[];
  },
): Promise<{ captureId: string; status: string; postizDraftId?: string }> {
  const res = await fetch(`/api/drafts/${id}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `review ${res.status}`);
  }
  return res.json();
}

export function mediaUrl(id: string, kind: "raw" | "thumb" | "branded"): string {
  return `/api/media/${id}/${kind}`;
}
