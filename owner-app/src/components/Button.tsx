import type { ButtonHTMLAttributes, CSSProperties } from 'react';
import { S_BACK, S_GHOST_DARK, S_PRIMARY, S_REPORT_BTN, S_SHEET_BTN, st } from '../lib/style';

// Every variant is an exact style string from the prototype.
const VARIANTS = {
  // 56 tall, radius 14
  primary: S_PRIMARY,
  primaryAmber: 'height:56px;border:0;border-radius:14px;background:#E08A2E;color:#171614;font-size:17px;font-weight:600',
  danger: 'height:56px;border:0;border-radius:14px;background:#C94B32;color:#fff;font-size:17px;font-weight:600',
  // 48 tall, radius 12
  secondary: 'height:48px;border-radius:12px;border:1px solid rgba(23,22,20,.14);background:none;font-size:16px;font-weight:500;color:#171614',
  secondaryFilled: 'height:48px;border:0;border-radius:12px;background:#171614;color:#fff;font-size:16px;font-weight:600',
  cancel: 'height:48px;border:0;background:none;font-size:16px;color:#6F6B64',
  // 44 tall
  pill: 'height:44px;padding:0 16px;border-radius:22px;font-size:16px;font-weight:500',
  ghostDark: S_GHOST_DARK,
  // sheets
  sheet: S_SHEET_BTN,
  report: S_REPORT_BTN,
  // text
  back: S_BACK,
  backDark: 'height:40px;padding:0 14px;border-radius:20px;border:0;background:rgba(255,255,255,.12);color:#F2EFE9;font-size:15px',
  link: 'background:none;border:0;padding:0;font-size:15px;color:#6F6B64;text-decoration:underline',
} as const;

export type ButtonVariant = keyof typeof VARIANTS;

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  selected?: boolean; // pill only
  style?: CSSProperties;
}

export function Button({ variant = 'primary', selected, style, disabled, type = 'button', ...rest }: Props) {
  let base: CSSProperties = st(VARIANTS[variant]);
  if (variant === 'pill') {
    base = {
      ...base,
      border: `1px solid ${selected ? '#171614' : 'rgba(23,22,20,.14)'}`,
      background: selected ? '#171614' : '#fff',
      color: selected ? '#fff' : '#171614',
    };
  }
  const merged: CSSProperties = { ...base, ...(disabled ? { opacity: 0.6, cursor: 'default' } : {}), ...style };
  return <button type={type} disabled={disabled} style={merged} {...rest} />;
}
