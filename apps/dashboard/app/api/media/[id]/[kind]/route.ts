import type { NextRequest } from "next/server";
import { backendFetch } from "@/lib/backend";

const KINDS = new Set(["raw", "thumb", "branded"]);

/// Streams capture media from the backend so the browser never needs a token.
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/media/[id]/[kind]">) {
  const { id, kind } = await ctx.params;
  if (!KINDS.has(kind)) {
    return Response.json({ error: "unknown media kind" }, { status: 400 });
  }

  const upstream = await backendFetch(`/media/${encodeURIComponent(id)}/${kind}`);
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: "media not available" }, { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "private, no-store",
    },
  });
}
