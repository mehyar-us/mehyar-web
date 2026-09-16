import { ProviderHTTP, appointmentInput, query, requireEtag, segment, singleLine, stableId, windowInput } from "./http";
import { ConnectorError, type AppointmentInput, type AppointmentReceipt, type Availability, type Calendar, type ClientOptions, type ConnectorAuth, type Operation, type Page, type TimeWindow, type WatchReceipt } from "./types";

const scope = (suffix: string) => `https://www.googleapis.com/auth/${suffix}`;
const read = [scope("calendar.events.readonly"), scope("calendar.events"), scope("calendar.readonly"), scope("calendar")];
const write = [scope("calendar.events"), scope("calendar")];
export const GOOGLE_CALENDAR_OPERATIONS = {
  list: { name: "google.calendar.list", effect: "read", scopes: [[scope("calendar.calendarlist.readonly"), scope("calendar.calendarlist"), scope("calendar.readonly"), scope("calendar")]] },
  availability: { name: "google.calendar.availability", effect: "read", scopes: [[scope("calendar.freebusy"), scope("calendar.events.freebusy"), scope("calendar.readonly"), scope("calendar")]] },
  read: { name: "google.calendar.read", effect: "read", scopes: [read] },
  create: { name: "google.calendar.create", effect: "write", scopes: [write] },
  update: { name: "google.calendar.update", effect: "write", scopes: [write] },
  cancel: { name: "google.calendar.cancel", effect: "write", scopes: [write] },
  watch: { name: "google.calendar.watch", effect: "write", scopes: [read] },
} as const satisfies Record<string, Operation>;
export interface GoogleEvent {
  id: string; etag: string; status?: string; htmlLink?: string; summary?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string };
}

/** Calendar v3. Provider content remains untrusted input to any downstream agent. */
export class GoogleCalendarClient {
  private readonly http: ProviderHTTP;
  constructor(auth: ConnectorAuth, options?: ClientOptions) { this.http = new ProviderHTTP(auth, "https://www.googleapis.com/calendar/v3/", options); }
  async listCalendars(pageToken?: string): Promise<Page<Calendar>> {
    const data = await this.http.request<{ items?: { id: string; summary?: string; timeZone?: string; accessRole?: string }[]; nextPageToken?: string }>(GOOGLE_CALENDAR_OPERATIONS.list, query("users/me/calendarList", { maxResults: "250", pageToken }));
    return { items: (data.items ?? []).map((item) => ({ id: item.id, name: item.summary ?? item.id, timeZone: item.timeZone, canWrite: ["writer", "owner"].includes(item.accessRole ?? "") })), nextCursor: data.nextPageToken };
  }
  async listAvailability(calendarId: string, window: TimeWindow): Promise<Availability> {
    segment(calendarId); windowInput(window);
    const data = await this.http.request<{ calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> }>(GOOGLE_CALENDAR_OPERATIONS.availability, "freeBusy", {
      method: "POST", body: { timeMin: window.start, timeMax: window.end, timeZone: window.timeZone, items: [{ id: calendarId }] },
    });
    const calendar = data.calendars?.[calendarId];
    return { busy: calendar?.busy ?? [], complete: Boolean(calendar && !calendar.errors?.length && Array.isArray(calendar.busy)) };
  }
  async readAppointment(calendarId: string, eventId: string): Promise<GoogleEvent> {
    return this.http.request(GOOGLE_CALENDAR_OPERATIONS.read, `calendars/${segment(calendarId)}/events/${segment(eventId)}`);
  }
  private receipt(event: GoogleEvent, calendarId: string, input: AppointmentInput): AppointmentReceipt {
    if (!event.id || !event.etag) throw new ConnectorError("ambiguous_write", "google.calendar.receipt");
    return { provider: "google", id: event.id, calendarId, etag: event.etag, url: event.htmlLink, timeZone: event.start?.timeZone ?? input.timeZone, state: "applied", requestId: input.requestId };
  }
  private body(input: AppointmentInput) {
    appointmentInput(input);
    return { summary: input.title, description: input.description, start: { dateTime: input.start, timeZone: input.timeZone }, end: { dateTime: input.end, timeZone: input.timeZone }, attendees: input.attendees.map((email) => ({ email })) };
  }
  // https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
  async createAppointment(calendarId: string, input: AppointmentInput): Promise<AppointmentReceipt> {
    const event = await this.http.request<GoogleEvent>(GOOGLE_CALENDAR_OPERATIONS.create, `calendars/${segment(calendarId)}/events?sendUpdates=all`, {
      method: "POST", body: { ...this.body(input), id: await stableId(input.requestId) },
    });
    return this.receipt(event, calendarId, input);
  }
  async updateAppointment(calendarId: string, eventId: string, etag: string, input: AppointmentInput): Promise<AppointmentReceipt> {
    const event = await this.http.request<GoogleEvent>(GOOGLE_CALENDAR_OPERATIONS.update, `calendars/${segment(calendarId)}/events/${segment(eventId)}?sendUpdates=all`, {
      method: "PATCH", headers: { "if-match": requireEtag(etag) }, body: this.body(input),
    });
    return this.receipt(event, calendarId, input);
  }
  async cancelAppointment(calendarId: string, eventId: string, etag: string, timeZone: string): Promise<AppointmentReceipt> {
    singleLine(timeZone, "time_zone");
    await this.http.request(GOOGLE_CALENDAR_OPERATIONS.cancel, `calendars/${segment(calendarId)}/events/${segment(eventId)}?sendUpdates=all`, { method: "DELETE", headers: { "if-match": requireEtag(etag) } });
    return { provider: "google", id: eventId, calendarId, etag, timeZone, state: "applied" };
  }
  // Keep initial/sync query parameters identical. A 410 requires a full new sync.
  async listChanges(calendarId: string, cursor: { syncToken?: string; pageToken?: string } = {}): Promise<Page<GoogleEvent>> {
    const data = await this.http.request<{ items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string }>(GOOGLE_CALENDAR_OPERATIONS.read,
      query(`calendars/${segment(calendarId)}/events`, { showDeleted: "true", singleEvents: "false", maxResults: "250", ...cursor }), { cursorStatuses: [410] });
    return { items: data.items ?? [], nextCursor: data.nextPageToken, syncCursor: data.nextPageToken ? undefined : data.nextSyncToken };
  }
  // Renewal is a new channel ID; stop the previous channel after replacement succeeds.
  async watchCalendar(calendarId: string, input: { channelId: string; notificationURL: string; channelToken: string; expiration: string }): Promise<WatchReceipt> {
    const notification = new URL(input.notificationURL);
    if (notification.protocol !== "https:" || notification.username || notification.password || notification.hash || !/^\d+$/.test(input.expiration)) throw new ConnectorError("invalid_input", "calendar_watch");
    singleLine(input.channelId, "channel_id", 64); singleLine(input.channelToken, "channel_token", 256);
    const data = await this.http.request<{ id: string; resourceId: string; expiration: string }>(GOOGLE_CALENDAR_OPERATIONS.watch, `calendars/${segment(calendarId)}/events/watch`, {
      method: "POST", body: { id: input.channelId, type: "web_hook", address: notification.href, token: input.channelToken, expiration: input.expiration },
    });
    return { id: data.id, resourceId: data.resourceId, expiresAt: new Date(Number(data.expiration)).toISOString() };
  }
  async stopWatch(channelId: string, resourceId: string): Promise<void> {
    singleLine(channelId, "channel_id", 64); singleLine(resourceId, "resource_id");
    await this.http.request(GOOGLE_CALENDAR_OPERATIONS.watch, "channels/stop", { method: "POST", body: { id: channelId, resourceId } });
  }
}
