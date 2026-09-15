import { useCallback, useRef, useState } from 'react';
import { api } from '../api/index';
import { errorMessage, type Publication, type PublishingOverview } from '../api/types';
import { useToast } from './useToast';
import { usePolling } from './usePolling';

const ACTIVE = new Set(['preparing', 'sending', 'queued', 'uncertain']);

// Publications for one clip plus the shop's connected accounts. Polls while a
// publication is still in flight so the owner sees the outcome without reloading.
export function usePublications(clipId: string) {
  const toast = useToast();
  const [overview, setOverview] = useState<PublishingOverview | null>(null);
  const [publications, setPublications] = useState<Publication[] | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const active = !!publications?.some((p) => ACTIVE.has(p.state) || p.cancel_requested);

  // A poll that started before a publish finished must not hide the newer record:
  // server lists are merged by id, keeping whichever copy was updated last.
  const merge = (current: Publication[] | null, incoming: Publication[]) => {
    const byId = new Map((current ?? []).map((p) => [p.id, p]));
    for (const p of incoming) {
      const known = byId.get(p.id);
      if (!known || known.updated_at <= p.updated_at) byId.set(p.id, p);
    }
    return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  };

  const load = useCallback(async () => {
    const [o, list] = await Promise.all([
      api.publishingAccounts().catch(() => null),
      api.clipPublications(clipId).catch(() => null),
    ]);
    if (o) setOverview(o);
    if (list) setPublications((current) => merge(current, list));
  }, [clipId]);

  usePolling(load, active ? 10_000 : 60_000, true, active);

  const upsert = (p: Publication) => setPublications((current) => merge(current, [p]));

  const cancelRef = useRef(false);
  const cancel = async (p: Publication) => {
    if (cancelRef.current) return;
    cancelRef.current = true;
    setCancelling(p.id);
    try {
      upsert(await api.cancelPublication(p.id));
      toast('Cancelled.');
    } catch (err) {
      toast(errorMessage(err, "Couldn't cancel. Try again."));
      void load();
    } finally {
      cancelRef.current = false;
      setCancelling(null);
    }
  };

  return { overview, publications, cancelling, cancel, upsert, reload: load };
}
