import { useEffect, useRef } from 'react';

// Runs fn now and every intervalMs after the previous run settles.
// The first run always happens so a screen opened in a background tab has data when it is shown.
// Later runs pause while the tab is hidden and resume as soon as it is visible.
export function usePolling(fn: () => Promise<void> | void, intervalMs: number, enabled = true): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: number | undefined;
    const tick = async (force = false) => {
      if (stopped || (document.hidden && !force)) return;
      try {
        await fnRef.current();
      } catch {
        // the caller handles its own errors
      }
      if (!stopped && !document.hidden) timer = window.setTimeout(tick, intervalMs);
    };
    const onVisibility = () => {
      window.clearTimeout(timer);
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    void tick(true);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
}
