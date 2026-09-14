// Builders for the Config object (device) and CameraStatus (owner). Shapes in docs/CONTRACT.md.
import product from "./product.json" with { type: "json" };
import { db } from "./db.ts";
import { DEFAULT_HOURS, nextDeliveryAt } from "./hours.ts";
import { signedUrl } from "./storage.ts";
import type { DeviceRow, ShopRow } from "./types.ts";

export interface Config {
  server_time: string;
  updated_at: string;
  hours: Record<string, unknown>;
  hours_confirmed: boolean;
  timezone: string;
  paused_until: string | null;
  pause_mode: string;
  framing_until: string | null;
  reference_frame_url: string | null;
  unpaired: boolean;
  workstation: string;
}

export function referencePath(shopId: string, deviceId: string): string {
  return `${shopId}/device/${deviceId}/reference.jpg`;
}
export function previewPath(shopId: string, deviceId: string): string {
  return `${shopId}/device/${deviceId}/preview.jpg`;
}
export function latestThumbPath(shopId: string, deviceId: string): string {
  return `${shopId}/device/${deviceId}/latest.jpg`;
}

export async function buildConfig(device: DeviceRow, shop: ShopRow): Promise<Config> {
  return {
    server_time: new Date().toISOString(),
    updated_at: device.config_updated_at,
    hours: (shop.hours as Record<string, unknown> | null) ?? DEFAULT_HOURS,
    hours_confirmed: !!shop.hours,
    timezone: shop.timezone,
    paused_until: device.paused_until,
    pause_mode: device.pause_mode,
    framing_until: device.framing_until,
    reference_frame_url: await signedUrl("thumbs", device.reference_frame_path, 3600),
    unpaired: !!device.unpaired_at,
    workstation: shop.workstation ?? "the work area",
  };
}

export async function activeDevice(shopId: string): Promise<DeviceRow | null> {
  const { data } = await db()
    .from("devices")
    .select("*")
    .eq("shop_id", shopId)
    .is("unpaired_at", null)
    .order("paired_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as DeviceRow) ?? null;
}

export async function bumpConfig(deviceId: string, patch: Record<string, unknown> = {}): Promise<DeviceRow> {
  const { data, error } = await db()
    .from("devices")
    .update({ ...patch, config_updated_at: new Date().toISOString() })
    .eq("id", deviceId)
    .select("*")
    .single();
  if (error) throw new Error(`bump config: ${error.message}`);
  return data as DeviceRow;
}

export function effectiveStatus(device: DeviceRow, now = new Date()): string {
  if (device.unpaired_at) return "waiting";
  const stale = product.heartbeatAlertMinutes * 60000;
  if (device.last_seen_at && now.getTime() - Date.parse(device.last_seen_at) > stale) {
    if (!["waiting", "reading", "connecting"].includes(device.status)) return "offline";
  }
  return device.status;
}

export interface CameraStatus {
  device_id: string;
  status: string;
  status_code: string | null;
  status_since: string;
  paused_until: string | null;
  pause_mode: string;
  last_seen_at: string | null;
  wifi: string;
  thermal: string;
  battery: number | null;
  storage_free_mb: number | null;
  recording_seconds_today: number;
  last_thumb_url: string | null;
  hours: Record<string, unknown> | null;
  timezone: string;
  workstation: string;
  next_delivery_at: string;
}

export async function cameraStatus(device: DeviceRow, shop: ShopRow): Promise<CameraStatus> {
  const now = new Date();
  const status = effectiveStatus(device, now);
  const statusSince = status === "offline" && device.status !== "offline" ? (device.last_seen_at ?? device.status_since) : device.status_since;
  return {
    device_id: device.id,
    status,
    status_code: device.status_code,
    status_since: statusSince,
    paused_until: device.paused_until,
    pause_mode: device.pause_mode,
    last_seen_at: device.last_seen_at,
    wifi: device.wifi_strength ?? "none",
    thermal: device.thermal ?? "nominal",
    battery: device.battery,
    storage_free_mb: device.storage_free_mb,
    recording_seconds_today: device.recording_seconds_today ?? 0,
    last_thumb_url: await signedUrl("thumbs", device.last_thumb_path, 600),
    hours: (shop.hours as Record<string, unknown> | null) ?? null,
    timezone: shop.timezone,
    workstation: shop.workstation ?? "the work area",
    next_delivery_at: nextDeliveryAt(now, shop.timezone, shop.delivery_hour ?? product.deliveryHourLocal).toISOString(),
  };
}
