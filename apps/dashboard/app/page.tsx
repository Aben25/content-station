import Link from "next/link";
import { fetchDrafts, mediaUrl, type Draft } from "@/lib/api";

export const dynamic = "force-dynamic";

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 text-center">
      <div className="text-3xl font-bold text-white">{value}</div>
      <div className="text-xs uppercase tracking-wide text-zinc-400 mt-1">{label}</div>
    </div>
  );
}

function DraftCard({ draft }: { draft: Draft }) {
  const title = draft.plan?.onScreenTitle ?? "Processing…";
  const angle = draft.plan?.angle ?? "";
  const statusColor =
    draft.status === "needs_review"
      ? "bg-amber-500/20 text-amber-300"
      : draft.status === "approved"
        ? "bg-green-500/20 text-green-300"
        : draft.status === "rejected"
          ? "bg-red-500/20 text-red-300"
          : draft.status === "error"
            ? "bg-red-500/20 text-red-300"
            : "bg-zinc-700/40 text-zinc-300";

  const inner = (
    <div className="flex gap-4 rounded-xl bg-zinc-900 border border-zinc-800 p-4 hover:border-zinc-600 transition-colors">
      <div className="w-20 shrink-0 overflow-hidden rounded-lg bg-zinc-800 aspect-[9/16]">
        {draft.hasThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUrl(draft.captureId, "thumb")}
            alt={title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-600 text-xs">
            video
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-white truncate">{title}</div>
        <div className="text-sm text-zinc-400 truncate">{angle}</div>
        <span
          className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}
        >
          {draft.status.replace("_", " ")}
        </span>
      </div>
      {draft.status === "needs_review" && (
        <div className="self-center text-sm font-medium text-sky-400">Review →</div>
      )}
    </div>
  );

  return draft.status === "needs_review" ? (
    <Link href={`/review/${draft.captureId}`}>{inner}</Link>
  ) : (
    inner
  );
}

export default async function Home() {
  const drafts = await fetchDrafts().catch(() => [] as Draft[]);

  const today = new Date().toDateString();
  const todays = drafts.filter((d) => new Date(d.createdAt).toDateString() === today);
  const needsReview = drafts.filter((d) => d.status === "needs_review");
  const approved = drafts.filter((d) => d.status === "approved");
  const processing = drafts.filter((d) => d.status === "processing");

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold text-white">Content Station</h1>
      <p className="text-sm text-zinc-400 mt-1">Today</p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <StatCard label="Captured" value={todays.length} />
        <StatCard label="Ready" value={needsReview.length} />
        <StatCard label="Posted" value={approved.length} />
      </div>

      {processing.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Processing
          </h2>
          <div className="space-y-3">
            {processing.map((d) => (
              <DraftCard key={d.captureId} draft={d} />
            ))}
          </div>
        </>
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        Drafts needing review
      </h2>
      {needsReview.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
          Nothing waiting. Capture a moment on the station to get started.
        </p>
      ) : (
        <div className="space-y-3">
          {needsReview.map((d) => (
            <DraftCard key={d.captureId} draft={d} />
          ))}
        </div>
      )}

      {approved.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Approved
          </h2>
          <div className="space-y-3">
            {approved.map((d) => (
              <DraftCard key={d.captureId} draft={d} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
