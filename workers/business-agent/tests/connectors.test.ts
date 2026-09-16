import { describe, expect, it, vi } from "vitest";
import { GoogleCalendarClient, GoogleMailClient } from "../src/connectors/google";
import { MicrosoftCalendarClient, MicrosoftMailClient, MicrosoftSubscriptionClient } from "../src/connectors/microsoft";
import { buildReply } from "../src/connectors/mail";
import type { AppointmentInput, ConnectorAuth, MailMessage, ReplyInput } from "../src/connectors/types";

const googleAuth: ConnectorAuth = { accessToken: "fixture-google-private", accountEmail: "owner@example.test", grantedScopes: ["gmail.readonly", "gmail.send", "calendar.calendarlist.readonly", "calendar.events", "calendar.freebusy"].map((scope) => "https://www.googleapis.com/auth/" + scope) };
const msAuth: ConnectorAuth = { accessToken: "fixture-ms-private", accountEmail: "owner@example.test", grantedScopes: ["Mail.Read", "Mail.Send", "Calendars.ReadWrite"] };
const appointment: AppointmentInput = { title: "Consultation", start: "2026-11-01T01:30:00-04:00", end: "2026-11-01T01:45:00-04:00", timeZone: "America/New_York", attendees: ["client@example.test"], requestId: "request-12345" };
const original: MailMessage = { id: "msg-1", threadId: "thread-1", subject: "Booking café", from: "Client <client@example.test>", internetMessageId: "<original@example.test>", body: "untrusted input" };
const reply: ReplyInput = { messageId: original.id, threadId: original.threadId, recipient: "client@example.test", text: "We can meet at 10. ✓", requestId: "mail-request-123" };
function json(value: unknown, status = 200, headers: Record<string, string> = {}) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } }); }
function fixture(...responses: (Response | Error)[]) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(url)), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unexpected_fixture_call");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fetcher as typeof fetch, calls, fetcher };
}
function body(call: { init: RequestInit }) { return JSON.parse(call.init.body as string); }
function googleOriginal() { return { messages: [{ id: original.id, threadId: original.threadId, payload: { headers: [
  { name: "From", value: original.from }, { name: "Subject", value: original.subject }, { name: "Message-ID", value: original.internetMessageId },
] } }] }; }
function graphOriginal() { return { id: original.id, conversationId: original.threadId, subject: original.subject, from: { emailAddress: { address: "client@example.test" } }, internetMessageId: original.internetMessageId }; }

describe("direct calendar API contracts", () => {
  it("preserves Google pagination, free/busy coverage, stable create IDs, ETags and cancellation notifications", async () => {
    const io = fixture(json({ items: [{ id: "primary", summary: "Studio", accessRole: "owner", timeZone: "America/New_York" }], nextPageToken: "page2" }),
      json({ calendars: { primary: { busy: [], errors: [{ reason: "notFound" }] } } }),
      json({ id: "event-1", etag: '"e1"', htmlLink: "https://calendar.google.com/event" }),
      json({ id: "event-1", etag: '"e2"' }), new Response(null, { status: 204 }));
    const client = new GoogleCalendarClient(googleAuth, io);
    expect(await client.listCalendars()).toMatchObject({ items: [{ id: "primary", canWrite: true }], nextCursor: "page2" });
    expect(await client.listAvailability("primary", appointment)).toEqual({ busy: [], complete: false });
    expect(await client.createAppointment("primary", appointment)).toMatchObject({ id: "event-1", etag: '"e1"', timeZone: appointment.timeZone, state: "applied" });
    expect(body(io.calls[2]).id).toMatch(/^[a-f0-9]{64}$/);
    expect(body(io.calls[2]).start).toEqual({ dateTime: appointment.start, timeZone: appointment.timeZone });
    await client.updateAppointment("primary", "event-1", '"e1"', appointment);
    await client.cancelAppointment("primary", "event-1", '"e2"', appointment.timeZone);
    expect(io.calls[3].init.headers).toMatchObject({ "if-match": '"e1"' });
    expect(io.calls[4].url.searchParams.get("sendUpdates")).toBe("all");
    expect(io.calls.every((call) => call.url.origin === "https://www.googleapis.com" && call.init.redirect === "manual")).toBe(true);
  });
  it("uses Graph calendarView for personal accounts and exact UTC instants across the repeated DST hour", async () => {
    const next = "https://graph.microsoft.com/v1.0/me/calendars/calendar-1/calendarView?$skiptoken=next";
    const io = fixture(json({ value: [{ id: "busy", start: { dateTime: "2026-11-01T05:30:00", timeZone: "UTC" }, end: { dateTime: "2026-11-01T05:45:00", timeZone: "UTC" }, showAs: "busy" }], "@odata.nextLink": next }),
      json({ id: "event-1", "@odata.etag": 'W/"e1"', start: { timeZone: appointment.timeZone } }), json({ id: "event-1", "@odata.etag": 'W/"e2"' }));
    const client = new MicrosoftCalendarClient(msAuth, io);
    expect(await client.listAvailability("calendar-1", appointment)).toMatchObject({ busy: [{ start: "2026-11-01T05:30:00.000Z" }], complete: false, nextCursor: next });
    await client.createAppointment("calendar-1", appointment);
    expect(body(io.calls[1])).toMatchObject({ transactionId: appointment.requestId, start: { dateTime: "2026-11-01T05:30:00.000", timeZone: "UTC" } });
    await client.updateAppointment("calendar-1", "event-1", 'W/"e1"', appointment);
    expect(io.calls[2].init.headers).toMatchObject({ "if-match": 'W/"e1"' });
    expect(io.calls.every((call) => call.url.pathname.startsWith("/v1.0/"))).toBe(true);
  });
  it("will not report cancellation for an attendee's copy or a stale event version", async () => {
    const io = fixture(json({ id: "event-1", isOrganizer: false }), json({ id: "event-1", isOrganizer: true, "@odata.etag": "new" }));
    const client = new MicrosoftCalendarClient(msAuth, io);
    await expect(client.cancelAppointment("cal", "event-1", "old", "UTC")).rejects.toMatchObject({ kind: "permission_denied" });
    await expect(client.cancelAppointment("cal", "event-1", "old", "UTC")).rejects.toMatchObject({ kind: "conflict" });
    expect(io.calls.every((call) => call.init.method === "GET")).toBe(true);
  });
  it("fails before network on missing actual write grants, malformed addresses, bare local time, or missing ETag", async () => {
    const io = fixture();
    const client = new GoogleCalendarClient({ ...googleAuth, grantedScopes: ["https://www.googleapis.com/auth/calendar.events.readonly"] }, io);
    await expect(client.createAppointment("primary", appointment)).rejects.toMatchObject({ kind: "insufficient_scope" });
    await expect(client.createAppointment("primary", { ...appointment, attendees: ["a@example.test\r\nBcc: victim@example.test"] })).rejects.toMatchObject({ kind: "invalid_input" });
    await expect(client.createAppointment("primary", { ...appointment, start: "2026-11-01T01:30:00" })).rejects.toMatchObject({ kind: "invalid_input" });
    await expect(client.updateAppointment("primary", "event", "", appointment)).rejects.toMatchObject({ kind: "invalid_input" });
    expect(io.calls).toHaveLength(0);
  });
});

describe("mail reply boundaries and MIME bytes", () => {
  it("encodes UTF-8 and threading for Gmail and treats success as accepted, not delivery", async () => {
    const io = fixture(json(googleOriginal()), json({ id: "sent-id", threadId: original.threadId }));
    const receipt = await new GoogleMailClient(googleAuth, io).sendReply(reply);
    expect(receipt).toMatchObject({ id: "sent-id", state: "accepted" });
    const sent = body(io.calls[1]);
    expect(sent.threadId).toBe(original.threadId);
    const decoded = atob(sent.raw.replace(/-/g, "+").replace(/_/g, "/"));
    expect(decoded).toContain("In-Reply-To: <original@example.test>\r\n");
    expect(decoded).toContain("To: client@example.test\r\n");
    expect(decoded).toContain("Content-Transfer-Encoding: base64");
    expect(io.calls[1].url.href).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  });
  it("uses Graph's single-operation MIME reply without requiring Mail.ReadWrite", async () => {
    const io = fixture(json(graphOriginal()), new Response(null, { status: 202 }));
    const receipt = await new MicrosoftMailClient(msAuth, io).sendReply(reply);
    expect(receipt).toMatchObject({ provider: "microsoft", state: "accepted", threadId: original.threadId });
    expect(receipt.id).toBeUndefined();
    expect(io.calls[1].url.pathname).toBe("/v1.0/me/messages/msg-1/reply");
    expect(io.calls[1].init.headers).toMatchObject({ "content-type": "text/plain" });
    expect(atob(io.calls[1].init.body as string)).toContain("Message-ID:");
  });
  it("requires both selected read/send grants and refuses recipient substitution, header injection or changed thread", async () => {
    const io = fixture();
    await expect(new MicrosoftMailClient({ ...msAuth, grantedScopes: ["Mail.Read"] }, io).sendReply(reply)).rejects.toMatchObject({ kind: "insufficient_scope" });
    expect(io.calls).toHaveLength(0);
    await expect(buildReply(msAuth.accountEmail, original, { ...reply, recipient: "attacker@example.test" })).rejects.toMatchObject({ kind: "invalid_input" });
    await expect(buildReply(msAuth.accountEmail, { ...original, subject: "Subject\r\nBcc: attacker@example.test" }, reply)).rejects.toMatchObject({ kind: "invalid_input" });
    await expect(buildReply(msAuth.accountEmail, original, { ...reply, threadId: "another-thread" })).rejects.toMatchObject({ kind: "invalid_input" });
    await expect(buildReply(msAuth.accountEmail, { ...original, replyTo: "other@example.test" }, reply)).rejects.toMatchObject({ kind: "invalid_input" });
  });
});

describe("sync cursors, subscription renewal and request uncertainty", () => {
  it("only checkpoints Google history/sync cursors after the final page and flags expired history", async () => {
    const mailIO = fixture(json({ history: [], historyId: "300", nextPageToken: "second" }), json({ history: [], historyId: "301" }), json({}, 404));
    const mail = new GoogleMailClient(googleAuth, mailIO);
    expect(await mail.listHistory("200")).toEqual({ items: [], nextCursor: "second", syncCursor: undefined });
    expect(await mail.listHistory("200", "second")).toMatchObject({ syncCursor: "301" });
    await expect(mail.listHistory("100")).rejects.toMatchObject({ kind: "cursor_invalid", status: 404 });
    const calendarIO = fixture(json({ items: [], nextSyncToken: "new-cursor" }), json({}, 410));
    const calendar = new GoogleCalendarClient(googleAuth, calendarIO);
    expect(await calendar.listChanges("primary")).toMatchObject({ syncCursor: "new-cursor" });
    await expect(calendar.listChanges("primary", { syncToken: "expired" })).rejects.toMatchObject({ kind: "cursor_invalid" });
    expect(calendarIO.calls[1].url.searchParams.has("timeMin")).toBe(false);
  });
  it("does not send bearer tokens to an attacker URL, another mailbox or another folder through delta links", async () => {
    const io = fixture();
    const client = new MicrosoftMailClient(msAuth, io);
    for (const cursor of ["https://attacker.test/v1.0/me/mailFolders/inbox/messages/delta?token=x", "https://graph.microsoft.com/v1.0/users/other/messages/delta", "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta"]) {
      await expect(client.listChanges("inbox", cursor)).rejects.toMatchObject({ kind: "invalid_input" });
    }
    expect(io.calls).toHaveLength(0);
  });
  it("follows a valid Graph delta URL exactly and retains tombstones", async () => {
    const cursor = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=opaque%2Bvalue";
    const io = fixture(json({ value: [{ id: "deleted", "@removed": { reason: "deleted" } }], "@odata.deltaLink": cursor }), json({}, 410));
    const client = new MicrosoftMailClient(msAuth, io);
    expect(await client.listChanges("inbox", cursor)).toMatchObject({ items: [{ id: "deleted", "@removed": { reason: "deleted" } }], syncCursor: cursor });
    expect(io.calls[0].url.href).toBe(cursor);
    await expect(client.listChanges("inbox", cursor)).rejects.toMatchObject({ kind: "cursor_invalid" });
  });
  it("returns provider-confirmed watch expirations and uses Graph renew PATCH", async () => {
    const expiration = String(Date.now() + 3600000);
    const g = fixture(json({ historyId: "123", expiration }), json({ id: "channel", resourceId: "resource", expiration }), new Response(null, { status: 204 }));
    expect(await new GoogleMailClient(googleAuth, g).renewWatch("projects/fixture-project/topics/gmail-watch")).toMatchObject({ cursor: "123", expiresAt: new Date(Number(expiration)).toISOString() });
    const calendar = new GoogleCalendarClient(googleAuth, g);
    await calendar.watchCalendar("primary", { channelId: "channel", channelToken: "fixture-channel-secret", notificationURL: "https://agent.example.test/hooks/calendar", expiration });
    await calendar.stopWatch("channel", "resource");
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    const m = fixture(json({ id: "subscription", expirationDateTime: expiresAt }), json({ id: "subscription", expirationDateTime: expiresAt }));
    const subscriptions = new MicrosoftSubscriptionClient(msAuth, m);
    await subscriptions.create("mail", { notificationURL: "https://agent.example.test/hooks/graph", lifecycleURL: "https://agent.example.test/hooks/lifecycle", clientState: "fixture-secret", expiresAt });
    expect(await subscriptions.renew("mail", "subscription", expiresAt)).toMatchObject({ id: "subscription", expiresAt });
    expect(m.calls[1].init.method).toBe("PATCH");
    expect(body(m.calls[0]).resource).toBe("me/messages");
  });
  it.each([new Error("network failed"), json({}, 503), json({}, 408)])("never automatically resends ambiguous writes", async (failure) => {
    const io = fixture(failure);
    await expect(new GoogleCalendarClient(googleAuth, io).createAppointment("primary", appointment)).rejects.toMatchObject({ kind: "ambiguous_write" });
    expect(io.calls).toHaveLength(1);
  });
  it("classifies throttling and lost reads without exposing provider error bodies", async () => {
    const io = fixture(json({ error: "echo fixture-google-private" }, 429, { "retry-after": "30" }), new Error("network failed"));
    const client = new GoogleCalendarClient(googleAuth, io);
    await expect(client.listCalendars()).rejects.toMatchObject({ kind: "rate_limited", retryAfterSeconds: 30 });
    await expect(client.listCalendars()).rejects.toMatchObject({ kind: "retryable_read" });
  });
  it("aborts a stalled request and records an uncertain write without retrying", async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted")))));
    const client = new MicrosoftCalendarClient(msAuth, { fetch: fetcher as typeof fetch, timeoutMs: 10 });
    await expect(client.createAppointment("primary", appointment)).rejects.toMatchObject({ kind: "ambiguous_write" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
