import { z } from "zod";
import { cursorURL } from "./http";
import { ConnectorError, type Page } from "./types";

const identifier = z.string().min(1).max(2048).regex(/^[^\u0000-\u001f\u007f]+$/).refine(value => value !== "." && value !== "..");
const folder = z.object({
  id: identifier,
  displayName: z.string().min(1).max(2048),
  parentFolderId: identifier,
  childFolderCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  isHidden: z.boolean(),
});
export type MailFolder = z.infer<typeof folder>;
const page = z.object({
  value: z.array(folder).max(1000),
  "@odata.nextLink": z.string().min(1).max(16384).regex(/^[^\u0000-\u0020\u007f]+$/).optional(),
});

/** A folder collection is not a recursive inventory. Callers must traverse children and every continuation. */
export function graphFolderPage(value: unknown, base: string, resource: string, parentId?: string): Page<MailFolder> {
  const parsed = page.safeParse(value);
  if (!parsed.success) throw new ConnectorError("invalid_response", "microsoft.mail.folders");
  const items = parsed.data.value;
  if (new Set(items.map(item => item.id)).size !== items.length || items.some(item =>
    item.id === item.parentFolderId || (parentId !== undefined && item.parentFolderId !== parentId))) {
    throw new ConnectorError("invalid_response", "microsoft.mail.folders");
  }
  const nextCursor = parsed.data["@odata.nextLink"];
  if (nextCursor) {
    try { cursorURL(nextCursor, "", base, resource); }
    catch { throw new ConnectorError("invalid_response", "microsoft.mail.folders"); }
  }
  return { items, nextCursor };
}
