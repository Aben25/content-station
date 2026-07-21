import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";

/// Two roles share one backend:
///   station — the mounted iPhone. May only push captures and ping.
///   owner   — the dashboard. May read, review, publish and delete.
/// Anything not listed is owner-only, so a new route is private by default.
const PUBLIC_ROUTES = new Set(["/health"]);
const STATION_ROUTES = new Set(["/upload", "/station/ping"]);

export type Role = "station" | "owner";

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/// Accepts `Authorization: Bearer <token>` or `X-Station-Token: <token>`.
function presentedToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  const station = req.headers["x-station-token"];
  if (typeof station === "string" && station.length > 0) return station;
  return null;
}

declare module "fastify" {
  interface FastifyRequest {
    role?: Role;
  }
}

/// Fails closed: without configured tokens the server refuses to boot rather
/// than silently exposing publish-capable routes through the tunnel.
export function registerAuth(app: FastifyInstance): void {
  const { stationToken, ownerToken } = config.auth;
  if (!stationToken || !ownerToken) {
    throw new Error(
      "STATION_TOKEN and OWNER_TOKEN must be set in apps/backend/.env — refusing to start unauthenticated",
    );
  }
  if (constantTimeEquals(stationToken, ownerToken)) {
    throw new Error("STATION_TOKEN and OWNER_TOKEN must differ");
  }

  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "OPTIONS") return;

    const route = req.url.split("?")[0];
    if (PUBLIC_ROUTES.has(route)) return;

    const token = presentedToken(req);
    if (!token) {
      return reply.code(401).send({ error: "missing token" });
    }

    if (constantTimeEquals(token, ownerToken)) {
      req.role = "owner";
      return;
    }

    if (constantTimeEquals(token, stationToken)) {
      req.role = "station";
      if (STATION_ROUTES.has(route)) return;
      return reply.code(403).send({ error: "station token cannot access this route" });
    }

    req.log.warn({ route, ip: req.ip }, "rejected request with invalid token");
    return reply.code(401).send({ error: "invalid token" });
  });
}
