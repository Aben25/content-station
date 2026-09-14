import type { CSSProperties } from 'react';

// Inline CSS string to React style object, cached. Keeps the handoff values verbatim.
const styleCache = new Map<string, CSSProperties>();

export function st(css: string): CSSProperties {
  const hit = styleCache.get(css);
  if (hit) return hit;
  const out: Record<string, string> = {};
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const k = decl.slice(0, i).trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    if (k) out[k] = decl.slice(i + 1).trim();
  }
  const style = out as CSSProperties;
  styleCache.set(css, style);
  return style;
}

export const FONT = 'Outfit,system-ui,sans-serif';
export const MONO = 'ui-monospace,Menlo,monospace';

// Shared style strings lifted from the prototype.
export const S_INPUT = 'height:56px;border:1px solid rgba(23,22,20,.14);border-radius:14px;padding:0 16px;font:500 18px Outfit,system-ui,sans-serif;background:#fff;color:#171614';
export const S_INPUT_PHONE = 'height:56px;border:1px solid rgba(23,22,20,.14);border-radius:14px;padding:0 16px;font:500 20px Outfit,system-ui,sans-serif;background:#fff;color:#171614';
export const S_LABEL = 'font-size:13px;font-weight:500;color:#6F6B64';
export const S_PRIMARY = 'height:56px;border:0;border-radius:14px;background:#171614;color:#fff;font-size:17px;font-weight:600';
export const S_BACK = 'background:none;border:0;padding:8px 0;font-size:15px;color:#6F6B64';
export const S_STEP = 'font-size:13px;color:#6F6B64';
export const S_H1 = 'font-size:28px;font-weight:600;line-height:1.15';
export const S_ROW = 'display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border:0;border-bottom:1px solid rgba(23,22,20,.08);background:none;text-align:left;gap:12px';
export const S_SHEET_BTN = 'height:56px;border-radius:14px;border:1px solid rgba(23,22,20,.14);background:#fff;font-size:17px;font-weight:500;color:#171614;display:flex;justify-content:space-between;align-items:center;padding:0 18px';
export const S_REPORT_BTN = 'height:52px;border-radius:14px;border:1px solid rgba(23,22,20,.14);background:#fff;font-size:16px;font-weight:500;color:#171614;text-align:left;padding:0 18px';
export const S_GHOST_DARK = 'flex:1;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:none;color:#F2EFE9;font-size:14px;font-weight:500';
export const S_ERROR = 'font-size:15px;color:#C94B32;line-height:1.4';

// Page containers. Top and bottom paddings come from the safe area variables in styles.css.
export const S_PAGE_HERO = 'flex:1;display:flex;flex-direction:column;padding:var(--top-hero) 24px var(--bottom-page);gap:28px;overflow-y:auto';
export const S_PAGE = 'flex:1;display:flex;flex-direction:column;padding:var(--top-page) 24px var(--bottom-page);gap:24px;overflow-y:auto';
export const S_SCROLL = 'flex:1;overflow:auto;display:flex;flex-direction:column';
export const S_MONO_LABEL = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:12px ui-monospace,Menlo,monospace;color:rgba(242,239,233,.45);padding:0 40px;text-align:center';

// Footage placeholders
export const STRIPES = [
  'repeating-linear-gradient(135deg,#3a3835 0 14px,#2c2a27 14px 28px)',
  'repeating-linear-gradient(135deg,#34322f 0 14px,#262421 14px 28px)',
  'repeating-linear-gradient(135deg,#403d39 0 14px,#302e2a 14px 28px)',
];
export const STRIPE_SMALL = 'repeating-linear-gradient(135deg,#3a3835 0 8px,#2c2a27 8px 16px)';
export const STRIPE_TINY = 'repeating-linear-gradient(135deg,#3a3835 0 6px,#2c2a27 6px 12px)';
export const STRIPE_PREVIEW = 'repeating-linear-gradient(135deg,#1c1b19 0 14px,#171614 14px 28px)';
export const STRIPE_LIGHT = 'repeating-linear-gradient(135deg,#ECEAE5 0 8px,#E4E1DA 8px 16px)';

// Stable stripe variant for a clip id so the same clip looks the same on Home and in detail.
export function stripeFor(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return STRIPES[sum % STRIPES.length];
}
