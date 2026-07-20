const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3000";

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

export async function fetchDrafts(): Promise<Draft[]> {
  const res = await fetch(`${API_BASE}/drafts`, { cache: "no-store" });
  if (!res.ok) throw new Error(`drafts ${res.status}`);
  return (await res.json()).drafts;
}

export async function fetchDraft(id: string): Promise<DraftDetail> {
  const res = await fetch(`${API_BASE}/drafts/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`draft ${res.status}`);
  return res.json();
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
  const res = await fetch(`${API_BASE}/drafts/${id}/review`, {
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
  return `${API_BASE}/media/${id}/${kind}`;
}
