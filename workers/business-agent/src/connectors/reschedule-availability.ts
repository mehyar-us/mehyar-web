import { z } from 'zod';
import { ConnectorError, type Page, type Provider, type TimeWindow } from './types';

export interface BusyAppointment { id: string; start: string; end: string; }
const id = z.string().min(1).max(2048);
const time = z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() });
const google = z.object({ items: z.array(z.object({ id, status: z.enum(['confirmed','tentative','cancelled']),
  transparency: z.enum(['opaque','transparent']).optional(), start: time.optional(), end: time.optional() })).max(250),
  nextPageToken: z.string().min(1).max(8192).optional() });
const graph = z.object({ value: z.array(z.object({ id, isCancelled: z.boolean(),
  showAs: z.enum(['free','tentative','busy','oof','workingElsewhere','unknown']), start: time.optional(), end: time.optional() })).max(100),
  '@odata.nextLink': z.string().min(1).max(8192).optional() });

/** Provider-filtered all-day Google events conservatively block this whole query window.
 * No customer text, attendee data or event subjects enter availability results. */
export function busyAppointments(provider: Provider, raw: unknown, window: TimeWindow): Page<BusyAppointment> {
  const fail = () => new ConnectorError('invalid_response', `${provider}.calendar.reschedule_availability`);
  const items: BusyAppointment[] = [];
  const add = (event: { id: string; start?: z.infer<typeof time>; end?: z.infer<typeof time> }) => {
    if (!event.start || !event.end) throw fail();
    if (provider === 'google' && event.start.date && event.end.date && !event.start.dateTime && !event.end.dateTime) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(event.start.date) || !/^\d{4}-\d{2}-\d{2}$/.test(event.end.date)
        || !(Date.parse(event.start.date) < Date.parse(event.end.date))) throw fail();
      items.push({ id: event.id, start: window.start, end: window.end }); return;
    }
    const instant = (value: z.infer<typeof time>) => {
      if (!value.dateTime || value.date !== undefined || (provider === 'microsoft' && value.timeZone !== 'UTC')) throw fail();
      const text = provider === 'microsoft' && !/(?:Z|[+-]\d{2}:\d{2})$/.test(value.dateTime) ? value.dateTime + 'Z' : value.dateTime;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) || !Number.isFinite(Date.parse(text))) throw fail();
      return new Date(text).toISOString();
    };
    const start = instant(event.start), end = instant(event.end);
    if (Date.parse(start) >= Date.parse(end)) throw fail();
    items.push({ id: event.id, start, end });
  };
  if (provider === 'google') {
    const parsed = google.safeParse(raw); if (!parsed.success) throw fail();
    for (const event of parsed.data.items) if (event.status !== 'cancelled' && event.transparency !== 'transparent') add(event);
    return { items, nextCursor: parsed.data.nextPageToken };
  }
  const parsed = graph.safeParse(raw); if (!parsed.success) throw fail();
  for (const event of parsed.data.value) if (!event.isCancelled && event.showAs !== 'free') add(event);
  return { items, nextCursor: parsed.data['@odata.nextLink'] };
}

/** Exact event-ID exclusion only; never subtract an interval from merged free/busy data,
 * which could also hide a second appointment occupying the same time. */
export async function requireRescheduleAvailability(
  client: { listBusyAppointments(calendarId: string, window: TimeWindow, cursor?: string): Promise<Page<BusyAppointment>> },
  calendarId: string, eventId: string, window: TimeWindow,
): Promise<void> {
  const seen = new Set<string>(); let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await client.listBusyAppointments(calendarId, window, cursor);
    if (result.items.some(event => event.id !== eventId && Date.parse(event.start) < Date.parse(window.end) && Date.parse(event.end) > Date.parse(window.start)))
      throw new ConnectorError('conflict', 'calendar.reschedule_availability');
    cursor = result.nextCursor;
    if (!cursor) return;
    if (seen.has(cursor)) break;
    seen.add(cursor);
  }
  throw new ConnectorError('invalid_response', 'calendar.reschedule_availability');
}
