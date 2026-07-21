"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { CAPTURES, STATIONS, firestore } from "@/lib/firebase";
import { useStorageUrl } from "@/lib/useStorageUrl";
import type { Capture, Station } from "@/lib/types";

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 text-center">
      <div className="text-3xl font-bold text-white">{value}</div>
      <div className="text-xs uppercase tracking-wide text-zinc-400 mt-1">{label}</div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  needs_review: "bg-amber-500/20 text-amber-300",
  approved: "bg-green-500/20 text-green-300",
  rejected: "bg-red-500/20 text-red-300",
  error: "bg-red-500/20 text-red-300",
  publish_failed: "bg-red-500/20 text-red-300",
};

function DraftCard({ capture }: { capture: Capture }) {
  const thumb = useStorageUrl(capture.thumbStoragePath);
  const title = capture.plan?.onScreenTitle ?? "Processing…";
  const statusColor = STATUS_COLORS[capture.status] ?? "bg-zinc-700/40 text-zinc-300";

  const inner = (
    <div className="flex gap-4 rounded-xl bg-zinc-900 border border-zinc-800 p-4 hover:border-zinc-600 transition-colors">
      <div className="w-20 shrink-0 overflow-hidden rounded-lg bg-zinc-800 aspect-[9/16]">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt={title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-600 text-xs">video</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-white truncate">{title}</div>
        <div className="text-sm text-zinc-400 truncate">{capture.plan?.angle ?? ""}</div>
        <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
          {capture.status.replace(/_/g, " ")}
        </span>
        {capture.error && (
          <div className="mt-1 text-xs text-red-400 line-clamp-2">{capture.error}</div>
        )}
      </div>
      {capture.status === "needs_review" && (
        <div className="self-center text-sm font-medium text-sky-400">Review →</div>
      )}
    </div>
  );

  return capture.status === "needs_review" ? (
    <Link href={`/review/${capture.id}`}>{inner}</Link>
  ) : (
    inner
  );
}

/// Pairing: a station registers itself unapproved with a 6-character code and
/// stays inert until the owner types that code here.
function StationCard({ stations }: { stations: Station[] }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pending = stations.filter((s) => !s.approved);
  const approved = stations.filter((s) => s.approved);

  const pair = async () => {
    setBusy(true);
    setError(null);
    const match = pending.find((s) => s.pairingCode === code.trim().toUpperCase());
    if (!match) {
      setError("No station is waiting with that code.");
      setBusy(false);
      return;
    }
    try {
      await updateDoc(doc(firestore(), STATIONS, match.id), { approved: true });
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "pairing failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm">
      {approved.map((s) => {
        const seen = s.lastSeenAt?.toDate?.();
        const online = seen ? Date.now() - seen.getTime() < 5 * 60 * 1000 : false;
        return (
          <div key={s.id} className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${online ? "bg-green-500" : "bg-zinc-600"}`} />
            <span className="text-zinc-300">
              {s.name ?? "Station"} {online ? "online" : "offline"}
              {seen && ` · last seen ${seen.toLocaleTimeString()}`}
            </span>
          </div>
        );
      })}

      {approved.length === 0 && pending.length === 0 && (
        <p className="text-zinc-500">No station paired yet.</p>
      )}

      {pending.length > 0 && (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <p className="text-zinc-400">
            {pending.length} station{pending.length > 1 ? "s" : ""} waiting to pair. Enter the code
            shown on the iPhone.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={6}
              placeholder="ABC123"
              className="w-32 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono tracking-widest text-white"
            />
            <button
              onClick={pair}
              disabled={busy || code.length !== 6}
              className="rounded-lg bg-white px-3 py-1.5 font-semibold text-black disabled:opacity-40"
            >
              Pair
            </button>
          </div>
          {error && <p className="mt-2 text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [stations, setStations] = useState<Station[]>([]);

  useEffect(() => {
    const q = query(collection(firestore(), CAPTURES), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setCaptures(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Capture));
    });
  }, []);

  useEffect(() =>
    onSnapshot(collection(firestore(), STATIONS), (snap) => {
      setStations(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Station));
    }), []);

  const today = new Date().toDateString();
  const todays = captures.filter((c) => c.createdAt?.toDate?.().toDateString() === today);
  const needsReview = captures.filter((c) => c.status === "needs_review");
  const approved = captures.filter((c) => c.status === "approved");
  const inFlight = captures.filter((c) =>
    ["uploaded", "processing", "approve_requested", "publishing"].includes(c.status),
  );
  const failed = captures.filter((c) => c.status === "error" || c.status === "publish_failed");

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold text-white">Content Station</h1>
      <p className="text-sm text-zinc-400 mt-1">Today</p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <StatCard label="Captured" value={todays.length} />
        <StatCard label="Ready" value={needsReview.length} />
        <StatCard label="Posted" value={approved.length} />
      </div>

      <StationCard stations={stations} />

      {failed.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-red-400">
            Needs attention
          </h2>
          <div className="space-y-3">
            {failed.map((c) => (
              <DraftCard key={c.id} capture={c} />
            ))}
          </div>
        </>
      )}

      {inFlight.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Processing
          </h2>
          <div className="space-y-3">
            {inFlight.map((c) => (
              <DraftCard key={c.id} capture={c} />
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
          {needsReview.map((c) => (
            <DraftCard key={c.id} capture={c} />
          ))}
        </div>
      )}

      {approved.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Approved
          </h2>
          <div className="space-y-3">
            {approved.map((c) => (
              <DraftCard key={c.id} capture={c} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
