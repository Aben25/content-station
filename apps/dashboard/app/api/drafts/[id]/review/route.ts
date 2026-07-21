import type { NextRequest } from "next/server";
import { backendFetch } from "@/lib/backend";

/// Approve/reject proxy. Publishing is the one destructive action the browser
/// can trigger, so it goes through the server with the owner token here.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/drafts/[id]/review">) {
  const { id } = await ctx.params;
  const body = await req.text();

  const upstream = await backendFetch(`/drafts/${encodeURIComponent(id)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
