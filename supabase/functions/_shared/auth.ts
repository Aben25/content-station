import { anon, db } from "./db.ts";
import { ApiError } from "./http.ts";
import { verifyDeviceJwt } from "./jwt.ts";
import { CRON_SECRET, ENGINE_API_KEY } from "./env.ts";
import type { DeviceRow, ShopRow, UserRow } from "./types.ts";

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export interface OwnerCtx {
  user: UserRow;
  shop: ShopRow | null;
}

export async function requireOwner(req: Request): Promise<OwnerCtx> {
  const token = bearer(req);
  if (!token) throw new ApiError(401, "not_signed_in", "Sign in to continue.");
  const { data, error } = await anon().auth.getUser(token);
  if (error || !data?.user) throw new ApiError(401, "session_expired", "Your session ended. Sign in again.");
  const authUser = data.user;
  let { data: user } = await db().from("users").select("*").eq("id", authUser.id).maybeSingle();
  if (!user) {
    const ins = await db().from("users").insert({ id: authUser.id, phone: authUser.phone ?? null }).select("*").single();
    if (ins.error) throw new Error(`create user: ${ins.error.message}`);
    user = ins.data;
  }
  let shop: ShopRow | null = null;
  if (user.shop_id) {
    const { data: s } = await db().from("shops").select("*").eq("id", user.shop_id).maybeSingle();
    shop = (s as ShopRow) ?? null;
  }
  return { user: user as UserRow, shop };
}

export async function requireShop(req: Request): Promise<OwnerCtx & { shop: ShopRow }> {
  const ctx = await requireOwner(req);
  if (!ctx.shop) throw new ApiError(409, "no_shop", "Set up your shop first.");
  return ctx as OwnerCtx & { shop: ShopRow };
}

export interface DeviceCtx {
  device: DeviceRow;
  shop: ShopRow;
}

export async function requireDevice(req: Request, opts: { allowUnpaired?: boolean } = {}): Promise<DeviceCtx> {
  const token = bearer(req);
  if (!token) throw new ApiError(401, "no_device_token", "Device token missing.");
  const claims = await verifyDeviceJwt(token);
  if (!claims) throw new ApiError(401, "bad_device_token", "Device token is not valid. Re-scan the QR from your phone.");
  const { data: device } = await db().from("devices").select("*").eq("id", claims.sub).maybeSingle();
  if (!device) throw new ApiError(401, "unknown_device", "This camera is not registered. Re-scan the QR from your phone.");
  if (device.unpaired_at && !opts.allowUnpaired) {
    throw new ApiError(401, "device_unpaired", "This camera was replaced. Re-scan the QR from your phone.");
  }
  const { data: shop } = await db().from("shops").select("*").eq("id", device.shop_id).maybeSingle();
  if (!shop) throw new ApiError(401, "unknown_shop", "This camera's shop no longer exists.");
  return { device: device as DeviceRow, shop: shop as ShopRow };
}

export function requireEngine(req: Request): void {
  const key = ENGINE_API_KEY();
  if (!key) throw new ApiError(503, "engine_not_configured", "ENGINE_API_KEY is not set on the backend.");
  if (req.headers.get("x-engine-key") !== key) throw new ApiError(401, "bad_engine_key", "Engine key did not match.");
}

export function requireCron(req: Request): void {
  const secret = CRON_SECRET();
  if (!secret) throw new ApiError(503, "cron_not_configured", "CRON_SECRET is not set on the backend.");
  if (req.headers.get("x-cron-secret") !== secret) throw new ApiError(401, "bad_cron_secret", "Cron secret did not match.");
}
