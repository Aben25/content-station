"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { CAPTURES, firestore } from "@/lib/firebase";
import type { Capture } from "@/lib/types";
import ReviewClient from "./ReviewClient";

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() =>
    onSnapshot(doc(firestore(), CAPTURES, id), (snap) => {
      if (!snap.exists()) {
        setMissing(true);
        return;
      }
      setCapture({ id: snap.id, ...snap.data() } as Capture);
    }), [id]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/" className="text-sm text-zinc-400 hover:text-white">
        ← Back to drafts
      </Link>
      {missing ? (
        <p className="mt-6 text-sm text-zinc-500">That capture no longer exists.</p>
      ) : !capture ? (
        <p className="mt-6 text-sm text-zinc-500">Loading…</p>
      ) : (
        <>
          <h1 className="mt-2 mb-6 text-xl font-bold text-white">
            {capture.plan?.onScreenTitle ?? "Review draft"}
          </h1>
          <ReviewClient capture={capture} />
        </>
      )}
    </main>
  );
}
