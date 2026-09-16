import { z } from 'zod';
import { requireEtag, singleLine, windowInput } from './http';
import { ConnectorError, type AppointmentReceipt, type Provider, type TimeWindow } from './types';

export interface RescheduleInput extends TimeWindow { requestId: string; }
export function rescheduleInput(input: RescheduleInput, etag: string): void {
  windowInput(input); requireEtag(etag); singleLine(input.requestId, 'request_id', 128);
}
const googleEvent = z.object({
  id: z.string(), etag: z.string(), status: z.enum(['confirmed', 'tentative', 'cancelled']),
  organizer: z.object({ self: z.boolean().optional() }),
  eventType: z.string(), locked: z.boolean().optional(),
  recurrence: z.array(z.string()).optional(), recurringEventId: z.string().optional(),
  start: z.object({ dateTime: z.string().optional(), date: z.string().optional() }),
  end: z.object({ dateTime: z.string().optional(), date: z.string().optional() }),
  endTimeUnspecified: z.boolean().optional(),
});
const graphEvent = z.object({
  id: z.string(), '@odata.etag': z.string(), isOrganizer: z.boolean(), isCancelled: z.boolean(),
  isAllDay: z.boolean(), type: z.enum(['singleInstance', 'occurrence', 'exception', 'seriesMaster']),
});

/** Only the single timed-event contract is handled here. Series/occurrence and all-day
 * edits need separately reviewed policies; missing provider fields never grant permission.
 * The caller still owns calendar selection, customer verification, availability and locks. */
export function requireReschedulable(provider: Provider, raw: unknown, eventId: string, etag: string): void {
  const operation = `${provider}.calendar.reschedule`;
  if (provider === 'google') {
    const parsed = googleEvent.safeParse(raw);
    if (!parsed.success) throw new ConnectorError('invalid_response', operation);
    const event = parsed.data;
    if (event.id !== eventId) throw new ConnectorError('invalid_response', operation);
    if (event.etag !== etag || event.status === 'cancelled') throw new ConnectorError('conflict', operation);
    if (event.organizer.self !== true || event.locked === true) throw new ConnectorError('permission_denied', operation);
    if (event.eventType !== 'default' || event.recurrence !== undefined || event.recurringEventId !== undefined
      || !event.start.dateTime || !event.end.dateTime || event.start.date !== undefined || event.end.date !== undefined
      || event.endTimeUnspecified === true) throw new ConnectorError('invalid_input', operation);
  } else {
    const parsed = graphEvent.safeParse(raw);
    if (!parsed.success) throw new ConnectorError('invalid_response', operation);
    const event = parsed.data;
    if (event.id !== eventId) throw new ConnectorError('invalid_response', operation);
    if (event['@odata.etag'] !== etag || event.isCancelled) throw new ConnectorError('conflict', operation);
    if (!event.isOrganizer) throw new ConnectorError('permission_denied', operation);
    if (event.isAllDay || event.type !== 'singleInstance') throw new ConnectorError('invalid_input', operation);
  }
}

const returnedEvent = z.object({ id: z.string(), etag: z.string().optional(), '@odata.etag': z.string().optional(),
  status: z.string().optional(), isCancelled: z.boolean().optional(),
  start: z.object({ dateTime: z.string(), timeZone: z.string().optional() }),
  end: z.object({ dateTime: z.string(), timeZone: z.string().optional() }),
});
export function rescheduleReceipt(provider: Provider, raw: unknown, calendarId: string, eventId: string, input: RescheduleInput): AppointmentReceipt {
  const fail = () => new ConnectorError('ambiguous_write', `${provider}.calendar.reschedule`);
  const parsed = returnedEvent.safeParse(raw);
  if (!parsed.success) throw fail();
  const event = parsed.data;
  if (provider === 'google' ? !['confirmed', 'tentative'].includes(event.status ?? '') : event.isCancelled !== false) throw fail();
  const etag = provider === 'google' ? event.etag : event['@odata.etag'];
  if (event.id !== eventId || !etag || etag.length > 1024 || /[\u0000-\u001f\u007f]/.test(etag)) throw fail();
  for (const key of ['start', 'end'] as const) {
    const value = event[key];
    if (provider === 'microsoft' && value.timeZone !== 'UTC') throw fail();
    const instant = provider === 'microsoft' && !/(?:Z|[+-]\d{2}:\d{2})$/.test(value.dateTime) ? value.dateTime + 'Z' : value.dateTime;
    if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(instant) || Date.parse(instant) !== Date.parse(input[key])) throw fail();
  }
  return { provider, id: eventId, calendarId, etag, timeZone: input.timeZone, state: 'applied', requestId: input.requestId };
}
