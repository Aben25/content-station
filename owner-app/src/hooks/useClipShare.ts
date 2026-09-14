import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index';
import { errorMessage, type Clip } from '../api/types';
import { prepareClipShare, shareClip, type PreparedShare } from '../lib/share';
import { useToast } from './useToast';

export function useClipShare() {
  const toast = useToast();
  const prepared = useRef<PreparedShare | null>(null);
  const active = useRef(false);
  const alive = useRef(true);
  const [state, setState] = useState<{ id: string; phase: 'preparing' | 'ready' | 'sharing' } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; prepared.current = null; }; }, []);
  const share = async (clip: Clip) => {
    if (active.current) return;
    active.current = true;
    try {
      const cached = prepared.current;
      if (cached?.clip.id === clip.id) {
        // Invoke immediately in this click's call stack; state updates follow it.
        const resultPromise = shareClip({ ...cached.clip, caption: clip.caption }, { file: cached.file });
        setState({ id: clip.id, phase: 'sharing' });
        const result = await resultPromise;
        if (result === 'shared') api.clipEvent(clip.id, 'share').catch(() => undefined);
        if (result === 'unavailable') toast('Sharing is unavailable. Try Download instead.');
        prepared.current = null;
        if (alive.current) setState(null);
      } else {
        prepared.current = null;
        setState({ id: clip.id, phase: 'preparing' });
        const result = await prepareClipShare(clip, { refresh: id => api.clip(id) });
        if (!alive.current) return;
        prepared.current = result;
        setState({ id: clip.id, phase: 'ready' });
      }
    } catch (err) {
      prepared.current = null;
      if (alive.current) { setState(null); toast(errorMessage(err, "Couldn't share this clip. Try again.")); }
    } finally { active.current = false; }
  };
  const label = (id: string) => state?.id !== id ? 'Share' : state.phase === 'preparing' ? 'Preparing…' : state.phase === 'sharing' ? 'Sharing…' : 'Share now';
  return { share, label, busy: state?.phase === 'preparing' || state?.phase === 'sharing' };
}
