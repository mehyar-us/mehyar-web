import { ProviderHTTP, appointmentInput, cursorURL, query, requireEtag, segment, singleLine, windowInput } from "./http";
import { ConnectorError, type AppointmentInput, type AppointmentReceipt, type Availability, type Calendar, type ClientOptions, type ConnectorAuth, type Operation, type Page, type TimeWindow } from "./types";
export const GRAPH_BASE = "https://graph.microsoft.com/v1.0/";
const read = ["Calendars.Read", "Calendars.ReadWrite"];
export const MICROSOFT_CALENDAR_OPERATIONS = {
  read: { name: "microsoft.calendar.read", effect: "read", scopes: [read] },
  create: { name: "microsoft.calendar.create", effect: "write", scopes: [["Calendars.ReadWrite"]] },
  update: { name: "microsoft.calendar.update", effect: "write", scopes: [["Calendars.ReadWrite"]] },
  cancel: { name: "microsoft.calendar.cancel", effect: "write", scopes: [["Calendars.ReadWrite"]] },
} as const satisfies Record<string, Operation>;
export interface GraphEvent {
  id: string; "@odata.etag"?: string; "@removed"?: { reason: string }; subject?: string;
  webLink?: string; isCancelled?: boolean; isOrganizer?: boolean; showAs?: string;
  start?: { dateTime: string; timeZone: string }; end?: { dateTime: string; timeZone: string };
}
interface GraphPage<T> { value: T[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string; }
function absoluteTime(instant: string) {
  // UTC avoids interpreting the repeated autumn DST hour as the wrong instant.
  // The request/receipt retain the owner's zone and the response uses Prefer timezone.
  return { dateTime: new Date(instant).toISOString().replace(/Z$/, ""), timeZone: "UTC" };
}
function utc(value: { dateTime: string; timeZone: string }): string {
  if (value.timeZone !== "UTC") throw new ConnectorError("invalid_response", "microsoft.calendar.time_zone");
  const instant = /(?:Z|[+-]\d{2}:\d{2})$/.test(value.dateTime) ? value.dateTime : value.dateTime + "Z";
  if (!Number.isFinite(Date.parse(instant))) throw new ConnectorError("invalid_response", "microsoft.calendar.time");
  return new Date(instant).toISOString();
}

/** Microsoft Graph v1.0 global cloud; national clouds require a separate reviewed adapter. */
export class MicrosoftCalendarClient {
  private readonly http: ProviderHTTP;
  constructor(auth: ConnectorAuth, options?: ClientOptions) { this.http = new ProviderHTTP(auth, GRAPH_BASE, options); }
  async listCalendars(cursor?: string): Promise<Page<Calendar>> {
    const path = cursorURL(cursor, "me/calendars?$top=100", GRAPH_BASE, "/v1.0/me/calendars");
    const data = await this.http.request<GraphPage<{ id: string; name: string; canEdit: boolean }>>(MICROSOFT_CALENDAR_OPERATIONS.read, path);
    return { items: data.value.map((item) => ({ id: item.id, name: item.name, canWrite: item.canEdit })), nextCursor: data["@odata.nextLink"] };
  }
  // calendarView supports personal Outlook accounts, unlike getSchedule.
  async listAvailability(calendarId: string, window: TimeWindow, cursor?: string): Promise<Availability> {
    windowInput(window);
    const path = `me/calendars/${segment(calendarId)}/calendarView`;
    const url = cursorURL(cursor, query(path, { startDateTime: window.start, endDateTime: window.end, "$top": "100", "$select": "id,start,end,showAs,isCancelled" }), GRAPH_BASE, "/v1.0/" + path);
    const data = await this.http.request<GraphPage<GraphEvent>>(MICROSOFT_CALENDAR_OPERATIONS.read, url, { headers: { Prefer: 'outlook.timezone="UTC"' } });
    let complete = !data["@odata.nextLink"];
    const busy: Availability["busy"] = [];
    for (const event of data.value) {
      if (event.isCancelled || event.showAs === "free") continue;
      if (!event.start || !event.end) { complete = false; continue; }
      busy.push({ start: utc(event.start), end: utc(event.end) });
    }
    return { busy, complete, nextCursor: data["@odata.nextLink"] };
  }
  async readAppointment(calendarId: string, eventId: string): Promise<GraphEvent> {
    return this.http.request(MICROSOFT_CALENDAR_OPERATIONS.read, `me/calendars/${segment(calendarId)}/events/${segment(eventId)}`);
  }
  private body(input: AppointmentInput) {
    appointmentInput(input);
    return { subject: input.title, body: { contentType: "text", content: input.description ?? "" }, start: absoluteTime(input.start), end: absoluteTime(input.end), attendees: input.attendees.map((address) => ({ emailAddress: { address }, type: "required" })) };
  }
  private receipt(event: GraphEvent, calendarId: string, input: AppointmentInput): AppointmentReceipt {
    if (!event.id || !event["@odata.etag"]) throw new ConnectorError("ambiguous_write", "microsoft.calendar.receipt");
    return { provider: "microsoft", id: event.id, calendarId, etag: event["@odata.etag"], url: event.webLink, timeZone: event.start?.timeZone ?? input.timeZone, state: "applied", requestId: input.requestId };
  }
  // https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0
  async createAppointment(calendarId: string, input: AppointmentInput): Promise<AppointmentReceipt> {
    const data = await this.http.request<GraphEvent>(MICROSOFT_CALENDAR_OPERATIONS.create, `me/calendars/${segment(calendarId)}/events`, { method: "POST", body: { ...this.body(input), transactionId: input.requestId }, headers: { Prefer: `outlook.timezone="${input.timeZone}"` } });
    return this.receipt(data, calendarId, input);
  }
  async updateAppointment(calendarId: string, eventId: string, etag: string, input: AppointmentInput): Promise<AppointmentReceipt> {
    const data = await this.http.request<GraphEvent>(MICROSOFT_CALENDAR_OPERATIONS.update, `me/calendars/${segment(calendarId)}/events/${segment(eventId)}`, { method: "PATCH", body: this.body(input), headers: { "if-match": requireEtag(etag), Prefer: `outlook.timezone="${input.timeZone}"` } });
    return this.receipt(data, calendarId, input);
  }
  // Organizer deletion sends cancellation notices; attendees only remove their own copy.
  async cancelAppointment(calendarId: string, eventId: string, etag: string, timeZone: string): Promise<AppointmentReceipt> {
    this.http.authorize(MICROSOFT_CALENDAR_OPERATIONS.cancel);
    singleLine(timeZone, "time_zone"); requireEtag(etag);
    const original = await this.readAppointment(calendarId, eventId);
    if (!original.isOrganizer) throw new ConnectorError("permission_denied", "microsoft.calendar.cancel_organizer");
    if (original["@odata.etag"] !== etag) throw new ConnectorError("conflict", "microsoft.calendar.cancel");
    await this.http.request(MICROSOFT_CALENDAR_OPERATIONS.cancel, `me/calendars/${segment(calendarId)}/events/${segment(eventId)}`, { method: "DELETE", headers: { "if-match": etag } });
    return { provider: "microsoft", id: eventId, calendarId, etag, timeZone, state: "applied" };
  }
  // v1.0 delta supports the default calendar view. Arbitrary-calendar delta is not claimed.
  async listChanges(window: TimeWindow, cursor?: string): Promise<Page<GraphEvent>> {
    windowInput(window);
    const path = cursorURL(cursor, query("me/calendarView/delta", { startDateTime: window.start, endDateTime: window.end }), GRAPH_BASE, "/v1.0/me/calendarView/delta");
    const data = await this.http.request<GraphPage<GraphEvent>>(MICROSOFT_CALENDAR_OPERATIONS.read, path, { cursorStatuses: [410], headers: { Prefer: 'outlook.timezone="UTC", odata.maxpagesize=100' } });
    return { items: data.value, nextCursor: data["@odata.nextLink"], syncCursor: data["@odata.nextLink"] ? undefined : data["@odata.deltaLink"] };
  }
}
