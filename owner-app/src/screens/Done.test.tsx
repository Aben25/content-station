import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { Done } from './Done';
vi.mock('../hooks/useSession', () => ({ useSession: () => ({ me: { shop: { delivery_hour: 11 } } }) }));
it('confirms setup without claiming an active camera, delivered clips or a future text', () => {
  const html = renderToStaticMarkup(<Done />);
  expect(html).not.toMatch(/camera is recording|First clips arrive|3 clips from today|It will look like this/);
  expect(html).toContain('recording schedule is saved');
  expect(html).toContain('captured and processed');
  expect(html).toContain('11 AM');
});
