import type { Timestamp } from "firebase/firestore";

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

/// Status flow. The station writes `uploaded`; the Mac worker drives everything
/// except `approve_requested` and `rejected`, which the owner writes here.
export type CaptureStatus =
  | "uploaded"
  | "processing"
  | "needs_review"
  | "approve_requested"
  | "publishing"
  | "approved"
  | "rejected"
  | "error"
  | "publish_failed";

export interface Capture {
  id: string;
  stationId: string;
  status: CaptureStatus;
  storagePath: string;
  thumbStoragePath?: string;
  brandedStoragePath?: string | null;
  transcript?: string;
  plan?: ContentPlan;
  probe?: { durationSec: number; width: number; height: number; warnings: string[] };
  postizDraftId?: string;
  approvedPlatforms?: string[];
  error?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Station {
  id: string;
  name?: string;
  pairingCode: string;
  approved: boolean;
  appVersion?: string;
  lastSeenAt?: Timestamp;
  createdAt?: Timestamp;
}
