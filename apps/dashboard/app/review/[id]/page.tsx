import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchDraft } from "@/lib/api";
import ReviewClient from "./ReviewClient";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await fetchDraft(id).catch(() => null);
  if (!draft) notFound();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/" className="text-sm text-zinc-400 hover:text-white">
        ← Back to drafts
      </Link>
      <h1 className="mt-2 mb-6 text-xl font-bold text-white">
        {draft.plan?.onScreenTitle ?? "Review draft"}
      </h1>
      <ReviewClient draft={draft} />
    </main>
  );
}
