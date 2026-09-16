import { z } from "zod";
import { cursorURL } from "./http";
import { ConnectorError } from "./types";

const identifier = z.string().min(1).max(2048).regex(/^[^\u0000-\u001f\u007f]+$/);
const token = z.string().min(1).max(16384).regex(/^[^\u0000-\u0020\u007f]+$/);
const historyId = z.string().regex(/^\d{1,20}$/);
const message = z.object({ id: identifier, threadId: identifier }).passthrough();
const change = z.object({ message }).passthrough();
const labelChange = change.extend({ labelIds: z.array(identifier) });
const gmailPage = z.object({
  history: z.array(z.object({
    id: historyId, messages: z.array(message).optional(),
    messagesAdded: z.array(change).optional(), messagesDeleted: z.array(change).optional(),
    labelsAdded: z.array(labelChange).optional(), labelsRemoved: z.array(labelChange).optional(),
  }).passthrough()).optional(),
  nextPageToken: token.optional(), historyId,
});

/** Validate the whole page before exposing any checkpoint or change to the caller. */
export function gmailHistoryPage(value: unknown, start: string) {
  const parsed = gmailPage.safeParse(value);
  if (!parsed.success) throw new ConnectorError("invalid_response", "google.mail.history");
  const data = parsed.data;
  let previous = BigInt(start);
  for (const record of data.history ?? []) {
    const current = BigInt(record.id);
    if (current <= previous || current > BigInt(data.historyId)) throw new ConnectorError("invalid_response", "google.mail.history_order");
    previous = current;
  }
  if (BigInt(data.historyId) < BigInt(start)) throw new ConnectorError("invalid_response", "google.mail.history_regression");
  return { items: data.history ?? [], nextCursor: data.nextPageToken, syncCursor: data.nextPageToken ? undefined : data.historyId };
}

const graphPage = z.object({
  // Delta removals and partial updates need not contain conversationId or message bodies.
  value: z.array(z.object({ id: identifier, "@removed": z.object({ reason: z.string() }).optional() }).passthrough()),
  "@odata.nextLink": token.optional(), "@odata.deltaLink": token.optional(),
}).refine((page) => Boolean(page["@odata.nextLink"]) !== Boolean(page["@odata.deltaLink"]));

export function graphMailPage(value: unknown, base: string, resource: string) {
  const parsed = graphPage.safeParse(value);
  if (!parsed.success) throw new ConnectorError("invalid_response", "microsoft.mail.delta");
  const data = parsed.data;
  const next = data["@odata.nextLink"], sync = data["@odata.deltaLink"];
  try { cursorURL(next ?? sync, "", base, resource); }
  catch { throw new ConnectorError("invalid_response", "microsoft.mail.delta_cursor"); }
  return { items: data.value, nextCursor: next, syncCursor: sync };
}
