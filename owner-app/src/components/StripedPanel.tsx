import type { CSSProperties, ReactNode } from 'react';
import { STRIPES } from '../lib/style';

interface Props {
  stripe?: string; // full repeating-linear-gradient string
  label?: string; // monospace placeholder label
  labelColor?: string;
  labelPadding?: string;
  fill?: boolean; // absolute inset 0 inside a positioned parent (default), otherwise block
  style?: CSSProperties;
  children?: ReactNode;
}

// Footage placeholder: striped panel with a monospace label. Replaced by real thumbnails once the pipeline produces them.
export function StripedPanel({ stripe = STRIPES[0], label, labelColor = 'rgba(242,239,233,.45)', labelPadding = '0 40px', fill = true, style, children }: Props) {
  return (
    <div style={{ ...(fill ? { position: 'absolute', inset: 0 } : { position: 'relative' }), background: stripe, ...style }}>
      {label && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: '12px ui-monospace,Menlo,monospace',
            color: labelColor,
            padding: labelPadding,
            textAlign: 'center',
          }}
        >
          {label}
        </div>
      )}
      {children}
    </div>
  );
}
