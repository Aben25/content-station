import { st } from '../lib/style';

export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div style={st('position:fixed;left:20px;right:20px;top:var(--toast-top);display:flex;justify-content:center;pointer-events:none;z-index:60')}>
      <div role="status" style={st('padding:12px 18px;border-radius:14px;background:#171614;color:#fff;font-size:15px;font-weight:500;box-shadow:0 8px 24px rgba(0,0,0,.2)')}>
        {text}
      </div>
    </div>
  );
}
