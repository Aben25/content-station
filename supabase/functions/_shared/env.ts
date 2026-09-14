// Environment access in one place. Secrets never get logged.
export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name);
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing env ${name}`);
  }
  return v;
}

export function envOptional(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v === "" ? undefined : v;
}

export const SUPABASE_URL = () => env("SUPABASE_URL");
export const SUPABASE_ANON_KEY = () => env("SUPABASE_ANON_KEY");
export const SUPABASE_SERVICE_ROLE_KEY = () => env("SUPABASE_SERVICE_ROLE_KEY");
export const DEVICE_JWT_SECRET = () => env("DEVICE_JWT_SECRET", "dev-only-device-secret-change-me");
export const PAIR_ENC_KEY = () => env("PAIR_ENC_KEY", "dev-only-pair-key-change-me");
export const ENGINE_API_KEY = () => envOptional("ENGINE_API_KEY");
export const ENGINE_WEBHOOK_URL = () => envOptional("ENGINE_WEBHOOK_URL");
export const CRON_SECRET = () => envOptional("CRON_SECRET");
export const GOOGLE_PLACES_API_KEY = () => envOptional("GOOGLE_PLACES_API_KEY");
export const TWILIO_ACCOUNT_SID = () => envOptional("TWILIO_ACCOUNT_SID");
export const TWILIO_AUTH_TOKEN = () => envOptional("TWILIO_AUTH_TOKEN");
export const TWILIO_MESSAGE_SERVICE_SID = () => envOptional("TWILIO_MESSAGE_SERVICE_SID");
export const TWILIO_FROM = () => envOptional("TWILIO_FROM");
export const OPS_ALERT_PHONE = () => envOptional("OPS_ALERT_PHONE");
