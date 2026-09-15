import { describe, expect, it } from 'vitest';
import type { Publication } from '../api/types';
import { canCancel, channelLine, inputValueToIso, localInputValue, publicationTitle } from './publishing';

const tz = 'America/Los_Angeles';
const base: Publication = {
  id: 'p', clip_id: 'c', kind: 'schedule', scheduled_at: '2026-09-16T16:30:17.000Z', requested_at: '2026-09-16T16:30:00.000Z', timezone: tz, caption: 'x',
  state: 'queued', late: false, cancel_requested: false, last_error: null, created_at: '', updated_at: '',
  channels: [{ account_id: 'a', provider: 'facebook', provider_label: 'Facebook Page', name: 'Shop', state: 'queued', live_url: null, error: null, updated_at: '' }],
};

describe('scheduled times are shop time', () => {
  it('converts a datetime-local value in the shop timezone to an instant', () => {
    expect(inputValueToIso('2026-09-16T09:30', tz)).toBe('2026-09-16T16:30:00.000Z');
    expect(inputValueToIso('2026-01-16T09:30', tz)).toBe('2026-01-16T17:30:00.000Z');
    expect(inputValueToIso('not a time', tz)).toBeNull();
  });
  it('renders an instant back into the same wall clock', () => {
    expect(localInputValue('2026-09-16T16:30:00.000Z', tz)).toBe('2026-09-16T09:30');
  });
});

describe('channel and publication labels', () => {
  const now = new Date('2026-09-15T17:00:00.000Z');
  it('describes queued, published, failed and cancelled channels', () => {
    expect(channelLine(base.channels[0], base, tz, now)).toBe('Scheduled for tomorrow at 9:30 AM');
    expect(channelLine({ ...base.channels[0], state: 'published' }, base, tz, now)).toBe('Published');
    expect(channelLine({ ...base.channels[0], state: 'failed', error: 'Token expired.' }, base, tz, now)).toBe('Failed. Token expired.');
    expect(channelLine({ ...base.channels[0], state: 'cancelled' }, base, tz, now)).toBe('Cancelled');
    expect(channelLine({ ...base.channels[0], state: 'uncertain' }, base, tz, now)).toContain('Checking');
    expect(channelLine(base.channels[0], { ...base, kind: 'now', scheduled_at: '2026-09-15T17:00:30.000Z' }, tz, now)).toBe('Publishing…');
    expect(channelLine(base.channels[0], { ...base, late: true }, tz, now)).toContain('longer than expected');
  });
  it('summarises the publication and knows when cancelling is possible', () => {
    expect(publicationTitle(base)).toBe('Scheduled');
    expect(publicationTitle({ ...base, kind: 'now' })).toBe('Publishing');
    expect(publicationTitle({ ...base, state: 'partial' })).toBe('Partly published');
    expect(canCancel(base)).toBe(true);
    expect(canCancel({ ...base, cancel_requested: true })).toBe(false);
    expect(canCancel({ ...base, channels: [{ ...base.channels[0], state: 'published' }] })).toBe(false);
  });
});
