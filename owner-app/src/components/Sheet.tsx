import type { ReactNode } from 'react';

interface Props {
  onClose: () => void;
  children: ReactNode;
  overlay?: string; // pause: rgba(23,22,20,.4), delete and report: rgba(0,0,0,.5)
  shadow?: boolean; // pause sheet only
  gap?: number; // 14, report uses 10
}

// Bottom sheet: 8px inset above the safe area, 28 radius, paper background.
export function Sheet({ onClose, children, overlay = 'rgba(0,0,0,.5)', shadow = false, gap = 14 }: Props) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: overlay, zIndex: 40 }} />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          left: 8,
          right: 8,
          bottom: 'var(--sheet-inset)',
          background: '#F7F6F3',
          borderRadius: 28,
          padding: '22px 20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap,
          color: '#171614',
          boxShadow: shadow ? '0 -8px 40px rgba(0,0,0,.2)' : undefined,
          zIndex: 41,
        }}
      >
        {children}
      </div>
    </>
  );
}
