"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitReview, mediaUrl, type DraftDetail } from "@/lib/api";

const PLATFORMS = ["instagram", "tiktok", "facebook"] as const;

export default function ReviewClient({ draft }: { draft: DraftDetail }) {
  const router = useRouter();
  const plan = draft.plan;

  const [hook, setHook] = useState(plan?.selectedHook ?? "");
  const [caption, setCaption] = useState(plan?.captions.instagram ?? "");
  const [cta, setCta] = useState(plan?.cta ?? "");
  const [platforms, setPlatforms] = useState<string[]>(plan?.platforms ?? [...PLATFORMS]);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const togglePlatform = (p: string) =>
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const submit = async (action: "approve" | "reject") => {
    setBusy(action);
    setError(null);
    try {
      await submitReview(draft.captureId, {
        action,
        selectedHook: hook,
        captions: { instagram: caption, tiktok: caption, facebook: caption },
        cta,
        platforms,
      });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl bg-black border border-zinc-800">
        <video
          src={mediaUrl(draft.captureId, "branded")}
          controls
          playsInline
          className="mx-auto max-h-[60vh] w-auto"
        />
      </div>

      {plan && plan.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-800 bg-amber-950/40 p-4">
          <div className="text-sm font-semibold text-amber-300">Warnings</div>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-200/80">
            {plan.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {plan && (
        <div>
          <label className="text-sm font-semibold text-zinc-300">Hook</label>
          <div className="mt-2 space-y-2">
            {plan.hookOptions.map((h) => (
              <button
                key={h}
                onClick={() => setHook(h)}
                className={`block w-full rounded-lg border p-3 text-left text-sm transition-colors ${
                  hook === h
                    ? "border-sky-500 bg-sky-950/40 text-white"
                    : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600"
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="text-sm font-semibold text-zinc-300">Caption</label>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={4}
          className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm text-white focus:border-sky-500 focus:outline-none"
        />
        {plan && (
          <div className="mt-1 text-xs text-zinc-500">{plan.hashtags.join(" ")}</div>
        )}
      </div>

      <div>
        <label className="text-sm font-semibold text-zinc-300">Call to action</label>
        <input
          value={cta}
          onChange={(e) => setCta(e.target.value)}
          className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm text-white focus:border-sky-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="text-sm font-semibold text-zinc-300">Platforms</label>
        <div className="mt-2 flex gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => togglePlatform(p)}
              className={`rounded-full px-4 py-2 text-sm font-medium capitalize transition-colors ${
                platforms.includes(p)
                  ? "bg-sky-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex gap-3 pb-8">
        <button
          onClick={() => submit("reject")}
          disabled={busy !== null}
          className="flex-1 rounded-xl border border-red-800 bg-red-950/30 py-3 font-semibold text-red-300 hover:bg-red-950/60 disabled:opacity-50"
        >
          {busy === "reject" ? "Rejecting…" : "Reject"}
        </button>
        <button
          onClick={() => submit("approve")}
          disabled={busy !== null || platforms.length === 0}
          className="flex-[2] rounded-xl bg-sky-600 py-3 font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {busy === "approve" ? "Approving…" : "Approve to Postiz"}
        </button>
      </div>
    </div>
  );
}
