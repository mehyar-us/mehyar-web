import { describe, expect, it, vi } from "vitest";
import { GoogleMailClient } from "../src/connectors/google-mail";
import { MicrosoftMailClient } from "../src/connectors/microsoft-mail";

const base = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta";
function clients(value: unknown) {
  const transport = vi.fn(async () => Response.json(value)) as unknown as typeof fetch;
  const auth = { accessToken: "fixture", accountEmail: "owner@example.test", grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly", "Mail.Read"] };
  return { google: new GoogleMailClient(auth, { fetch: transport }), microsoft: new MicrosoftMailClient(auth, { fetch: transport }) };
}
describe("mail synchronization page integrity", () => {
  it.each([null, {}, { historyId: 301 }, { historyId: "301", nextPageToken: "" },
    { historyId: "301", history: [{ id: "250", messagesAdded: [{}] }] },
    { historyId: "199" }, { historyId: "301", history: [{ id: "302" }] },
    { historyId: "301", history: [{ id: "250" }, { id: "249" }] },
  ])("rejects incomplete or regressing Gmail history without exposing a checkpoint: %j", async (page) => {
    await expect(clients(page).google.listHistory("200")).rejects.toMatchObject({ kind: "invalid_response" });
  });
  it("preserves 64-bit IDs and defers the checkpoint until the final page", async () => {
    const history = [{ id: "18446744073709551614", messagesDeleted: [{ message: { id: "m", threadId: "t" } }] }];
    expect(await clients({ history, historyId: "18446744073709551615", nextPageToken: "next" }).google.listHistory("18446744073709551613"))
      .toMatchObject({ items: history, nextCursor: "next", syncCursor: undefined });
    expect(await clients({ historyId: "18446744073709551615" }).google.listHistory("18446744073709551613"))
      .toMatchObject({ items: [], syncCursor: "18446744073709551615" });
  });
  it.each([null, {}, { value: [] }, { value: [], "@odata.nextLink": base, "@odata.deltaLink": base },
    { value: [{}], "@odata.deltaLink": base }, { value: [], "@odata.deltaLink": "https://attacker.test/token" },
    { value: [], "@odata.nextLink": base.replace("inbox", "other") },
    { value: [], "@odata.deltaLink": base + "#fragment" },
  ])("rejects malformed Graph pages and foreign checkpoint resources: %j", async (page) => {
    await expect(clients(page).microsoft.listChanges("inbox")).rejects.toMatchObject({ kind: "invalid_response" });
  });
  it("retains partial updates and removal tombstones on empty or nonempty rounds", async () => {
    const items = [{ id: "deleted", "@removed": { reason: "deleted" } }, { id: "partial", isRead: true }];
    expect(await clients({ value: items, "@odata.nextLink": base + "?$skiptoken=opaque" }).microsoft.listChanges("inbox"))
      .toEqual({ items, nextCursor: base + "?$skiptoken=opaque", syncCursor: undefined });
    expect(await clients({ value: [], "@odata.deltaLink": base + "?$deltatoken=opaque" }).microsoft.listChanges("inbox"))
      .toEqual({ items: [], nextCursor: undefined, syncCursor: base + "?$deltatoken=opaque" });
  });
});
