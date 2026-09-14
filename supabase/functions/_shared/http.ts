// Tiny router plus the error envelope from docs/CONTRACT.md.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-engine-key, x-cron-secret, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extra },
  });
}

export function empty(status = 204): Response {
  return new Response(null, { status, headers: CORS_HEADERS });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) return json({ error: { code: e.code, message: e.message } }, e.status);
  console.error("unhandled", e instanceof Error ? e.stack ?? e.message : String(e));
  return json({ error: { code: "internal", message: "Something went wrong on our side. Try again in a minute." } }, 500);
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  const text = await req.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(400, "bad_json", "The request body was not valid JSON.");
  }
}

export function requireString(body: Record<string, unknown>, key: string, max = 200): string {
  const v = body[key];
  if (typeof v !== "string" || v.trim() === "") throw new ApiError(400, "missing_field", `${key} is required.`);
  if (v.length > max) throw new ApiError(400, "field_too_long", `${key} is too long.`);
  return v.trim();
}

export function optionalString(body: Record<string, unknown>, key: string, max = 200): string | undefined {
  const v = body[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new ApiError(400, "bad_field", `${key} must be text.`);
  if (v.length > max) throw new ApiError(400, "field_too_long", `${key} is too long.`);
  return v.trim();
}

export interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
}

export type Handler = (ctx: Ctx) => Promise<Response | unknown> | Response | unknown;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
    return this;
  }
  get(p: string, h: Handler) { return this.add("GET", p, h); }
  post(p: string, h: Handler) { return this.add("POST", p, h); }
  patch(p: string, h: Handler) { return this.add("PATCH", p, h); }
  delete(p: string, h: Handler) { return this.add("DELETE", p, h); }

  async handle(req: Request, mountPath: string): Promise<Response> {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    const url = new URL(req.url);
    let path = url.pathname;
    const i = path.indexOf(mountPath);
    if (i >= 0) path = path.slice(i + mountPath.length);
    const parts = path.split("/").filter(Boolean);
    let methodMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let k = 0; k < parts.length; k++) {
        if (r.parts[k].startsWith(":")) params[r.parts[k].slice(1)] = decodeURIComponent(parts[k]);
        else if (r.parts[k] !== parts[k]) { ok = false; break; }
      }
      if (!ok) continue;
      methodMatched = true;
      if (r.method !== req.method) continue;
      try {
        const out = await r.handler({ req, url, params });
        if (out instanceof Response) return out;
        return json(out ?? { ok: true });
      } catch (e) {
        return errorResponse(e);
      }
    }
    if (methodMatched) return json({ error: { code: "method_not_allowed", message: "That method is not allowed here." } }, 405);
    return json({ error: { code: "not_found", message: "No such route." } }, 404);
  }
}
