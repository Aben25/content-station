import { useEffect, useRef, useState } from 'react';
import { toCanvas } from 'qrcode';
import { st } from '../lib/style';

// Renders the real pair payload at full content width, error correction L, 16px white padding, radius 20.
export function QRCode({ value }: { value: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(248);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize(Math.max(64, Math.floor(el.clientWidth - 32)));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !value) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    toCanvas(c, value, {
      errorCorrectionLevel: 'L',
      margin: 0,
      width: Math.round(size * dpr),
      color: { dark: '#171614', light: '#ffffff' },
    })
      .then(() => {
        // The library sets the CSS size to the pixel size. Bring it back to the layout size.
        c.style.width = `${size}px`;
        c.style.height = `${size}px`;
      })
      .catch(() => undefined);
  }, [value, size]);

  return (
    <div ref={box} style={st('width:100%;padding:16px;background:#fff;border-radius:20px;box-sizing:border-box;display:flex;justify-content:center')}>
      <canvas ref={canvas} aria-label="Pairing code" style={{ width: size, height: size }} />
    </div>
  );
}
