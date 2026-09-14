import type { InputHTMLAttributes, ReactNode } from 'react';
import { S_INPUT, S_INPUT_PHONE, S_LABEL, st } from '../lib/style';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  size?: 18 | 20;
  right?: ReactNode; // Show/Hide toggle
}

export function Input({ label, size = 18, right, style, ...rest }: Props) {
  const base = st(size === 20 ? S_INPUT_PHONE : S_INPUT);
  const input = <input style={{ ...base, ...(right ? { flex: 1, padding: '0 72px 0 16px' } : { width: '100%' }), ...style }} {...rest} />;
  return (
    <div style={st('display:flex;flex-direction:column;gap:8px')}>
      <label style={st(S_LABEL)}>{label}</label>
      {right ? (
        <div style={st('position:relative;display:flex')}>
          {input}
          {right}
        </div>
      ) : (
        input
      )}
    </div>
  );
}
