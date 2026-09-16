import { describe, expect, it, vi } from 'vitest';
import { GoogleCalendarClient } from '../src/connectors/google-calendar';
import { MicrosoftCalendarClient } from '../src/connectors/microsoft-calendar';
import { busyAppointments, requireRescheduleAvailability } from '../src/connectors/reschedule-availability';

const window = { start: '2026-11-01T06:30:00.100Z', end: '2026-11-01T06:45:00.100Z', timeZone: 'America/New_York' };
const busy = (id: string, start = window.start, end = window.end) => ({ id, start, end });
const google = (id: string) => ({ id, status: 'confirmed', start: { dateTime: window.start }, end: { dateTime: window.end } });
const graph = (id: string) => ({ id, isCancelled: false, showAs: 'busy', start: { dateTime: '2026-11-01T06:30:00.1000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-01T06:45:00.1000000', timeZone: 'UTC' } });

describe('reschedule availability', () => {
  it('excludes only the exact moved event and preserves another event occupying the same interval', async () => {
    await expect(requireRescheduleAvailability({ listBusyAppointments: async () => ({ items: [busy('self')] }) }, 'calendar', 'self', window)).resolves.toBeUndefined();
    await expect(requireRescheduleAvailability({ listBusyAppointments: async () => ({ items: [busy('self'), busy('other')] }) }, 'calendar', 'self', window)).rejects.toMatchObject({ kind: 'conflict' });
  });
  it('uses exclusive overlap boundaries and continues through an empty page to find a later conflict', async () => {
    const read = vi.fn(async (_calendar: string, _window: unknown, cursor?: string) => cursor
      ? { items: [busy('other')] } : { items: [], nextCursor: 'next' });
    await expect(requireRescheduleAvailability({ listBusyAppointments: read }, 'calendar', 'self', window)).rejects.toMatchObject({ kind: 'conflict' });
    expect(read).toHaveBeenNthCalledWith(2, 'calendar', window, 'next');
    await expect(requireRescheduleAvailability({ listBusyAppointments: async () => ({ items: [
      busy('before', '2026-11-01T06:00:00Z', window.start), busy('after', window.end, '2026-11-01T07:00:00Z'),
    ] }) }, 'calendar', 'self', window)).resolves.toBeUndefined();
  });
  it('refuses incomplete inventory on cursor loops or the ten-page limit', async () => {
    for (const loop of [true, false]) {
      let calls = 0;
      await expect(requireRescheduleAvailability({ listBusyAppointments: async () => ({ items: [], nextCursor: loop ? (++calls, 'loop') : String(++calls) }) }, 'calendar', 'self', window)).rejects.toMatchObject({ kind: 'invalid_response' });
      expect(calls).toBe(loop ? 2 : 10);
    }
  });
  it('preserves recurring instance IDs and blocks all-day events while ignoring explicit free/cancelled events', () => {
    expect(busyAppointments('google', { items: [google('series_instance'), { id: 'all-day', status: 'confirmed', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } },
      { id: 'cancelled', status: 'cancelled' }, { id: 'free', status: 'confirmed', transparency: 'transparent' }] }, window).items).toEqual([busy('series_instance'), busy('all-day')]);
    expect(busyAppointments('microsoft', { value: [graph('series_instance'), { ...graph('free'), showAs: 'free' }, { ...graph('cancelled'), isCancelled: true }] }, window).items).toEqual([busy('series_instance')]);
  });
  it('rejects unknown structure and incomplete time information instead of returning availability', () => {
    for (const value of [null, {}, { items: [null] }, { items: [{ ...google('event'), start: {} }] }, { items: [{ ...google('event'), status: undefined }] }])
      expect(() => busyAppointments('google', value, window)).toThrow();
    for (const value of [{}, { value: [{ ...graph('event'), isCancelled: undefined }] }, { value: [{ ...graph('event'), start: { dateTime: window.start, timeZone: 'Eastern Standard Time' } }] }])
      expect(() => busyAppointments('microsoft', value, window)).toThrow();
  });
  it('requests expanded Google occurrences and widens fractional-second bounds without returning private fields', async () => {
    const fetcher = vi.fn(async () => Response.json({ items: [{ ...google('event'), summary: 'private', attendees: [{ email: 'private@example.test' }] }], nextPageToken: 'page2' }));
    const client = new GoogleCalendarClient({ accessToken: 'fixture', accountEmail: 'owner@example.test', grantedScopes: ['https://www.googleapis.com/auth/calendar.events'] }, { fetch: fetcher as typeof fetch });
    expect(await client.listBusyAppointments('calendar', window)).toEqual({ items: [busy('event')], nextCursor: 'page2' });
    const calls = fetcher.mock.calls as unknown as [URL, RequestInit][];
    expect(Object.fromEntries(calls[0][0].searchParams)).toMatchObject({ timeMin: '2026-11-01T06:30:00.000Z', timeMax: '2026-11-01T06:45:01.000Z', singleEvents: 'true', showDeleted: 'false', showHiddenInvitations: 'true' });
  });
  it('uses UTC calendarView and refuses continuation URLs outside the selected calendar', async () => {
    const fetcher = vi.fn(async () => Response.json({ value: [graph('event')] }));
    const client = new MicrosoftCalendarClient({ accessToken: 'fixture', accountEmail: 'owner@example.test', grantedScopes: ['Calendars.ReadWrite'] }, { fetch: fetcher as typeof fetch });
    expect(await client.listBusyAppointments('calendar', window)).toEqual({ items: [busy('event')], nextCursor: undefined });
    const calls = fetcher.mock.calls as unknown as [URL, RequestInit][];
    expect(calls[0][0].pathname).toBe('/v1.0/me/calendars/calendar/calendarView');
    expect(calls[0][1].headers).toMatchObject({ Prefer: 'outlook.timezone="UTC"' });
    for (const cursor of ['https://attacker.test/v1.0/me/calendars/calendar/calendarView', 'https://graph.microsoft.com/v1.0/me/calendars/other/calendarView'])
      await expect(client.listBusyAppointments('calendar', window, cursor)).rejects.toMatchObject({ kind: 'invalid_input' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
