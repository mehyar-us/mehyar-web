import { describe, expect, it, vi } from 'vitest';
import { GoogleCalendarClient } from '../src/connectors/google-calendar';
import { MicrosoftCalendarClient } from '../src/connectors/microsoft-calendar';
import type { Provider } from '../src/connectors/types';

const input = { start: '2026-11-01T01:30:00-05:00', end: '2026-11-01T01:45:00-05:00', timeZone: 'America/New_York', requestId: 'reschedule-fixture' };
function original(provider: Provider) {
  return provider === 'google'
    ? { id: 'event', etag: 'old', status: 'confirmed', organizer: { self: true }, eventType: 'default', start: { dateTime: '2026-11-01T01:30:00-04:00' }, end: { dateTime: '2026-11-01T01:45:00-04:00' } }
    : { id: 'event', '@odata.etag': 'old', isOrganizer: true, isCancelled: false, isAllDay: false, type: 'singleInstance' };
}
function empty(provider: Provider) { return provider === 'google' ? { items: [] } : { value: [] }; }
function result(provider: Provider) {
  return provider === 'google'
    ? { id: 'event', etag: 'new', status: 'confirmed', start: { dateTime: input.start }, end: { dateTime: input.end } }
    : { id: 'event', '@odata.etag': 'new', isCancelled: false, start: { dateTime: '2026-11-01T06:30:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-01T06:45:00.0000000', timeZone: 'UTC' } };
}
function fixture(provider: Provider, responses: unknown[], write = true) {
  const fetcher = vi.fn(async () => {
    if (!responses.length) throw new Error('Unexpected provider request');
    const value = responses.shift();
    if (value instanceof Error) throw value;
    return value instanceof Response ? value : Response.json(value);
  });
  const auth = { accessToken: 'fixture', accountEmail: 'owner@example.test', grantedScopes: provider === 'google'
    ? [`https://www.googleapis.com/auth/calendar.events${write ? '' : '.readonly'}`] : [write ? 'Calendars.ReadWrite' : 'Calendars.Read'] };
  const options = { fetch: fetcher as typeof fetch };
  const client = provider === 'google' ? new GoogleCalendarClient(auth, options) : new MicrosoftCalendarClient(auth, options);
  return { client, fetcher };
}

describe.each(['google', 'microsoft'] as const)('%s time-only rescheduling', provider => {
  it('moves the second repeated DST hour without rewriting meeting content and validates the returned time', async () => {
    const { client, fetcher } = fixture(provider, [original(provider), empty(provider), result(provider)]);
    expect(await client.rescheduleAppointment('calendar', 'event', 'old', input)).toEqual({ provider, calendarId: 'calendar', id: 'event', etag: 'new', timeZone: input.timeZone, state: 'applied', requestId: input.requestId });
    const calls = fetcher.mock.calls as unknown as [URL, RequestInit][];
    expect(calls).toHaveLength(3);
    expect(calls[0][1].method).toBe('GET');
    expect(calls[2][1]).toMatchObject({ method: 'PATCH', headers: { 'if-match': 'old' } });
    const patch = JSON.parse(String(calls[2][1].body));
    expect(Object.keys(patch).sort()).toEqual(['end', 'start']);
    expect(patch.start).toEqual(provider === 'google' ? { dateTime: input.start, timeZone: input.timeZone } : { dateTime: '2026-11-01T06:30:00.000', timeZone: 'UTC' });
    if (provider === 'google') expect(calls[2][0].searchParams.get('sendUpdates')).toBe('all');
    else expect(calls[2][1].headers).toMatchObject({ Prefer: 'outlook.timezone="UTC"' });
  });
  it('requires write permission and valid absolute times before any request', async () => {
    const denied = fixture(provider, [], false);
    await expect(denied.client.rescheduleAppointment('calendar', 'event', 'old', input)).rejects.toMatchObject({ kind: 'insufficient_scope' });
    expect(denied.fetcher).not.toHaveBeenCalled();
    const allowed = fixture(provider, []);
    await expect(allowed.client.rescheduleAppointment('calendar', 'event', 'old', { ...input, start: '2026-11-01T01:30:00' })).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(allowed.client.rescheduleAppointment('calendar', 'event', '', input)).rejects.toMatchObject({ kind: 'invalid_input' });
    expect(allowed.fetcher).not.toHaveBeenCalled();
  });
  it('refuses stale, cancelled, foreign, recurring, all-day and incomplete events before writing', async () => {
    const changes = provider === 'google' ? [
      { etag: 'changed' }, { status: 'cancelled' }, { organizer: { self: false } }, { id: 'other' },
      { recurrence: ['RRULE:FREQ=DAILY'] }, { recurringEventId: 'series' }, { start: { date: '2026-11-01' } },
      { locked: true }, { eventType: 'outOfOffice' }, { organizer: undefined },
    ] : [
      { '@odata.etag': 'changed' }, { isCancelled: true }, { isOrganizer: false }, { id: 'other' },
      { type: 'seriesMaster' }, { type: 'occurrence' }, { type: 'exception' }, { isAllDay: true }, { type: undefined },
    ];
    for (const change of changes) {
      const { client, fetcher } = fixture(provider, [{ ...original(provider), ...change }]);
      await expect(client.rescheduleAppointment('calendar', 'event', 'old', input)).rejects.toHaveProperty('kind');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('surfaces an edit racing the read as conflict without retrying the patch', async () => {
    const { client, fetcher } = fixture(provider, [original(provider), empty(provider), Response.json({}, { status: 412 })]);
    await expect(client.rescheduleAppointment('calendar', 'event', 'old', input)).rejects.toMatchObject({ kind: 'conflict' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('checks identified appointments before dispatch and never hides a second overlapping booking', async () => {
    const event = (id: string) => provider === 'google'
      ? { id, status: 'confirmed', start: { dateTime: input.start }, end: { dateTime: input.end } }
      : { id, isCancelled: false, showAs: 'busy', start: { dateTime: '2026-11-01T06:30:00', timeZone: 'UTC' }, end: { dateTime: '2026-11-01T06:45:00', timeZone: 'UTC' } };
    for (const conflicting of [false, true]) {
      const events = [event('event'), ...(conflicting ? [event('other')] : [])];
      const { client, fetcher } = fixture(provider, [original(provider), provider === 'google' ? { items: events } : { value: events }, result(provider)]);
      if (conflicting) {
        await expect(client.rescheduleAppointment('calendar', 'event', 'old', input)).rejects.toMatchObject({ kind: 'conflict' });
        expect(fetcher).toHaveBeenCalledTimes(2);
        const calls = fetcher.mock.calls as unknown as [URL, RequestInit][];
        expect(calls.every(call => call[1].method === 'GET')).toBe(true);
      } else {
        await expect(client.rescheduleAppointment('calendar', 'event', 'old', input)).resolves.toMatchObject({ state: 'applied' });
        expect(fetcher).toHaveBeenCalledTimes(3);
      }
    }
  });
  it('does not retry or claim success when dispatch loses its response or returns incomplete evidence', async () => {
    for (const response of [new Error('connection lost'), null, {}, { ...result(provider), id: 'other' },
      { ...result(provider), start: { dateTime: '2026-11-01T05:30:00Z', timeZone: 'UTC' } },
      { ...result(provider), etag: undefined, '@odata.etag': undefined },
      { ...result(provider), status: 'cancelled', isCancelled: true },
      { ...result(provider), status: undefined, isCancelled: undefined }]) {
      const { client, fetcher } = fixture(provider, [original(provider), empty(provider), response]);
      await expect(client.rescheduleAppointment('calendar', 'event', 'old', input)).rejects.toMatchObject({ kind: 'ambiguous_write' });
      expect(fetcher).toHaveBeenCalledTimes(3);
    }
  });
});
