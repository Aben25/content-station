import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { Settings } from './Settings';
const { session } = vi.hoisted(() => ({ session: { me: { shop: { name: 'Actual Studio', type: 'barbershop', delivery_hour: 11, hours: null } } } }));
vi.mock('../hooks/useSession', () => ({ useSession: () => session }));
it('shows configured shop facts without inventing settings or enabled services', () => {
  const html = renderToStaticMarkup(<Settings />);
  expect(html).toContain('Actual Studio');
  expect(html).toContain('11 AM');
  expect(html).toContain('Recording hours are not set.');
  expect(html).not.toContain('Mon to Sat, 9 to 7');
  expect(html).not.toMatch(/Face blur on|You and 1 staff|Next charge|text and push|P1/);
  expect(html).toContain('Team management is not available yet.');
  expect(html).toContain('Billing details are not available here.');
  expect(html).toContain('These settings are view-only.');
});
