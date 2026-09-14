import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api/index';
import { errorMessage, type Me } from '../api/types';
import { browserTimezone } from '../lib/format';

export type SessionStatus = 'loading' | 'out' | 'in';

export interface SessionState {
  status: SessionStatus;
  me: Me | null;
  error: string | null;
  refresh: () => Promise<Me | null>;
  setMe: (me: Me) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);
export const SessionProvider = Ctx.Provider;

export function useSessionState(): SessionState {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [me, setMeState] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<Me | null> => {
    let session = null;
    try {
      session = await api.getSession();
    } catch {
      session = null;
    }
    if (!session) {
      setStatus('out');
      setMeState(null);
      setError(null);
      return null;
    }
    try {
      const m = await api.me();
      setMeState(m);
      setError(null);
      setStatus('in');
      return m;
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        await api.signOut().catch(() => undefined);
        setStatus('out');
        setMeState(null);
        setError(null);
        return null;
      }
      setError(errorMessage(e, "Couldn't load your shop. Check your connection and try again."));
      setStatus('in');
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api.signOut().catch(() => undefined);
    setStatus('out');
    setMeState(null);
    setError(null);
  }, []);

  const setMe = useCallback((m: Me) => {
    setMeState(m);
    setStatus('in');
  }, []);

  return { status, me, error, refresh, setMe, signOut };
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider is missing');
  return v;
}

export function useShopTimezone(): string {
  const { me } = useSession();
  return me?.shop?.timezone ?? browserTimezone();
}
