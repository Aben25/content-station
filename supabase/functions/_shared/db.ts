import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from "./env.ts";

let admin: SupabaseClient | null = null;

// Service role client. Bypasses RLS. Only used server side.
export function db(): SupabaseClient {
  if (!admin) {
    admin = createClient(SUPABASE_URL(), SUPABASE_SERVICE_ROLE_KEY(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

// Anon client, used for auth calls on behalf of a phone number.
export function anon(): SupabaseClient {
  return createClient(SUPABASE_URL(), SUPABASE_ANON_KEY(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null || res.data === undefined) throw new Error(`${what}: no data`);
  return res.data;
}
