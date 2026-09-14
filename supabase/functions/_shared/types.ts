// Loose row types. The database is the source of truth; these keep handlers readable.
// deno-lint-ignore-file no-explicit-any
export type Row = Record<string, any>;

export interface ShopRow extends Row {
  id: string;
  name: string;
  type: "barbershop" | "detailing" | "wrap" | "tattoo" | "other";
  instagram: string | null;
  phone: string | null;
  timezone: string;
  hours: Row | null;
  workstation: string | null;
  delivery_hour: number;
  plan: string;
}

export interface UserRow extends Row {
  id: string;
  phone: string | null;
  shop_id: string | null;
  role: "owner" | "staff";
}

export interface DeviceRow extends Row {
  id: string;
  shop_id: string;
  serial: string;
  status: string;
  status_code: string | null;
  status_since: string;
  pause_mode: "none" | "1h" | "today" | "indefinite";
  paused_until: string | null;
  framing_until: string | null;
  reference_frame_path: string | null;
  last_thumb_path: string | null;
  last_seen_at: string | null;
  wifi_strength: string | null;
  battery: number | null;
  thermal: string | null;
  storage_free_mb: number | null;
  recording_seconds_today: number;
  config_updated_at: string;
  unpaired_at: string | null;
}

export const DEVICE_STATUSES = [
  "waiting", "reading", "connecting", "framing", "recording", "paused",
  "nointernet", "reframe", "hot", "fault", "offline", "idle",
] as const;

export const SHOP_TYPES = ["barbershop", "detailing", "wrap", "tattoo", "other"] as const;

export function defaultWorkstation(type: string): string {
  switch (type) {
    case "barbershop": return "chair 1";
    case "detailing": return "the bay";
    case "wrap": return "the bay";
    case "tattoo": return "the station";
    default: return "the work area";
  }
}
