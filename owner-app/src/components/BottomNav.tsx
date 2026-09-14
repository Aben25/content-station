import { R, navigate } from '../router';
import { st } from '../lib/style';

export type Tab = 'home' | 'camera' | 'settings';

const TABS: { name: string; key: Tab; radius: string; path: string }[] = [
  { name: 'Clips', key: 'home', radius: '4px', path: R.home },
  { name: 'Camera', key: 'camera', radius: '50%', path: R.camera },
  { name: 'Settings', key: 'settings', radius: '11px', path: R.settings },
];

export function BottomNav({ active }: { active: Tab }) {
  return (
    <div style={st('display:flex;border-top:1px solid rgba(23,22,20,.08);background:#F7F6F3;padding:8px 0 var(--bottom-nav);flex:none')}>
      {TABS.map((t) => {
        const color = active === t.key ? '#171614' : '#A39E95';
        return (
          <button
            key={t.key}
            onClick={() => navigate(t.path)}
            aria-current={active === t.key ? 'page' : undefined}
            style={{ ...st('flex:1;height:48px;border:0;background:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px'), color }}
          >
            <div style={{ width: 22, height: 22, borderRadius: t.radius, border: `2.5px solid ${color}`, boxSizing: 'border-box' }} />
            <div style={st('font-size:12px;font-weight:600')}>{t.name}</div>
          </button>
        );
      })}
    </div>
  );
}
