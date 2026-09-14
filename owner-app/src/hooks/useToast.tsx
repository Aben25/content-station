import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Toast } from '../components/Toast';

interface ToastCtx {
  show: (text: string) => void;
}

const Ctx = createContext<ToastCtx>({ show: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((t: string) => {
    setText(t);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setText(null), 2400);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <Toast text={text} />
    </Ctx.Provider>
  );
}

export function useToast(): (text: string) => void {
  return useContext(Ctx).show;
}
