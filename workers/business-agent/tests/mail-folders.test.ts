import { describe, expect, it, vi } from "vitest";
import { MicrosoftMailClient } from "../src/connectors/microsoft-mail";

const root = "https://graph.microsoft.com/v1.0/me/mailFolders";
const folder = { id: "folder", displayName: "Customers", parentFolderId: "root", childFolderCount: 2, isHidden: false };
function client(value: unknown, scopes = ["Mail.Read"]) {
  const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(value));
  return { transport, mail: new MicrosoftMailClient({ accessToken: "fixture", accountEmail: "owner@example.test", grantedScopes: scopes }, { fetch: transport as typeof fetch }) };
}
describe("Outlook folder discovery", () => {
  it("requests hidden and visible root folders with explicit fields and preserves continuation", async () => {
    const next = root + "?$skiptoken=opaque";
    const { mail, transport } = client({ value: [folder], "@odata.nextLink": next });
    expect(await mail.listFolders()).toEqual({ items: [folder], nextCursor: next });
    const url = new URL(String(transport.mock.calls[0]![0]));
    expect(url.pathname).toBe("/v1.0/me/mailFolders");
    expect(url.searchParams.get("includeHiddenFolders")).toBe("true");
    expect(url.searchParams.get("$select")).toContain("childFolderCount");
    await mail.listFolders(undefined, next);
    expect(String(transport.mock.calls[1]![0])).toBe(next);
  });
  it("encodes child folder IDs and accepts a complete empty child collection", async () => {
    const { mail, transport } = client({ value: [] });
    expect(await mail.listFolders("parent/+=")).toEqual({ items: [], nextCursor: undefined });
    expect(new URL(String(transport.mock.calls[0]![0])).pathname).toBe("/v1.0/me/mailFolders/parent%2F%2B%3D/childFolders");
  });
  it.each([null, {}, { value: [{}] }, { value: [{ ...folder, childFolderCount: -1 }] },
    { value: [folder, folder] }, { value: [{ ...folder, parentFolderId: "folder" }] },
    { value: [], "@odata.nextLink": "" }, { value: [], "@odata.nextLink": "https://attacker.test/" },
    { value: [], "@odata.nextLink": root + "/other/childFolders" },
  ])("rejects malformed collections and foreign continuations: %j", async value => {
    await expect(client(value).mail.listFolders()).rejects.toMatchObject({ kind: "invalid_response" });
  });
  it("rejects children belonging to a different parent", async () => {
    await expect(client({ value: [folder] }).mail.listFolders("other")).rejects.toMatchObject({ kind: "invalid_response" });
    expect((await client({ value: [folder] }).mail.listFolders("root")).items).toEqual([folder]);
  });
  it("rejects foreign input cursors and missing consent before network access", async () => {
    const { mail, transport } = client({ value: [] });
    await expect(mail.listFolders("parent", root + "?$skiptoken=x")).rejects.toMatchObject({ kind: "invalid_input" });
    expect(transport).not.toHaveBeenCalled();
    const denied = client({ value: [] }, ["Mail.Send"]);
    await expect(denied.mail.listFolders()).rejects.toMatchObject({ kind: "insufficient_scope" });
    expect(denied.transport).not.toHaveBeenCalled();
  });
});
