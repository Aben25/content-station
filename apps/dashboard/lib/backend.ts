import type { Draft, DraftDetail, StationHealth } from "./api";

// Server-only. Holds the owner token, which must never reach the browser —
// every export here is called from server components or route handlers.

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";

function ownerToken(): string {
  if (typeof window !== "undefined") {
    throw new Error("lib/backend.ts must not be imported into client code");
  }
  const token = process.env.OWNER_TOKEN;
  if (!token) throw new Error("OWNER_TOKEN is not set in the dashboard environment");
  return token;
}

/// Proxy a request to the backend with the owner token attached. Returns the
/// raw Response so route handlers can stream media through untouched.
export async function backendFetch(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BACKEND_URL}${pathAndQuery}`, {
    ...init,
    cache: "no-store",
    headers: { ...init.headers, Authorization: `Bearer ${ownerToken()}` },
  });
}

async function backendJson<T>(path: string): Promise<T> {
  const res = await backendFetch(path);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

export async function fetchDrafts(): Promise<Draft[]> {
  return (await backendJson<{ drafts: Draft[] }>("/drafts")).drafts;
}

export async function fetchDraft(id: string): Promise<DraftDetail> {
  return backendJson<DraftDetail>(`/drafts/${id}`);
}

export async function fetchStationHealth(): Promise<StationHealth> {
  return backendJson<StationHealth>("/station/health");
}
