import { ProviderHTTP, cursorURL, query, segment, singleLine } from "./http";
import { base64, buildReply } from "./mail";
import { graphMailPage } from "./mail-pages";
import {mailSnapshot} from './mail-snapshot';
import { ConnectorError, type ClientOptions, type ConnectorAuth, type MailMessage, type MailReceipt, type Operation, type Page, type ReplyInput } from "./types";
import { GRAPH_BASE } from "./microsoft-calendar";
const read = ["Mail.Read", "Mail.ReadWrite"];
export const MICROSOFT_MAIL_OPERATIONS = {
  read: { name: "microsoft.mail.read", effect: "read", scopes: [read] },
  reply: { name: "microsoft.mail.reply", effect: "write", scopes: [read, ["Mail.Send"]] },
} as const satisfies Record<string, Operation>;
export interface GraphMessage {
  id: string; conversationId: string; subject?: string; internetMessageId?: string; body?: unknown;
  from?: { emailAddress: { address: string } }; replyTo?: { emailAddress: { address: string } }[];
  internetMessageHeaders?: { name: string; value: string }[]; "@removed"?: { reason: string };
}
export type GraphMessageChange = Pick<GraphMessage, "id"> & Partial<Omit<GraphMessage, "id">>;
interface GraphPage { value: GraphMessage[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string; }
const fields = "id,conversationId,subject,internetMessageId,from,replyTo,body,internetMessageHeaders";
function normalize(message: GraphMessage): MailMessage {
  if ((message.replyTo?.length ?? 0) > 1) throw new ConnectorError("invalid_response", "microsoft.mail.multiple_reply_recipients");
  return { id: message.id, threadId: message.conversationId, subject: message.subject ?? "", from: message.from?.emailAddress.address ?? "", replyTo: message.replyTo?.[0]?.emailAddress.address,
    internetMessageId: message.internetMessageId, references: message.internetMessageHeaders?.find((header) => header.name.toLowerCase() === "references")?.value, body: message.body };
}

/** Graph v1.0. No application-wide mailbox permissions and no auto-send retries. */
export class MicrosoftMailClient {
  private readonly http: ProviderHTTP;
  constructor(auth: ConnectorAuth, options?: ClientOptions) { this.http = new ProviderHTTP(auth, GRAPH_BASE, options); }
  async readSnapshot(folderId:string,messageId:string) {
    const value=await this.http.request<unknown>(MICROSOFT_MAIL_OPERATIONS.read,query(`me/mailFolders/${segment(folderId)}/messages/${segment(messageId)}`,{'$select':fields}),
      {headers:{Prefer:'IdType="ImmutableId", outlook.body-content-type="text"'}});
    return mailSnapshot('microsoft',value,messageId);
  }
  async readThread(conversationId: string, cursor?: string): Promise<Page<MailMessage>> {
    singleLine(conversationId, "conversation_id", 2048);
    const initial = query("me/messages", { "$filter": `conversationId eq '${conversationId.replace(/'/g, "''")}'`, "$select": fields, "$top": "100" });
    const data = await this.http.request<GraphPage>(MICROSOFT_MAIL_OPERATIONS.read, cursorURL(cursor, initial, GRAPH_BASE, "/v1.0/me/messages"), { headers: { Prefer: 'IdType="ImmutableId"' } });
    return { items: data.value.map(normalize), nextCursor: data["@odata.nextLink"] };
  }
  async readMessage(messageId: string): Promise<MailMessage> {
    const data = await this.http.request<GraphMessage>(MICROSOFT_MAIL_OPERATIONS.read, query(`me/messages/${segment(messageId)}`, { "$select": fields }), { headers: { Prefer: 'IdType="ImmutableId"' } });
    return normalize(data);
  }
  // https://learn.microsoft.com/en-us/graph/api/message-reply?view=graph-rest-1.0
  async sendReply(input: ReplyInput): Promise<MailReceipt> {
    this.http.authorize(MICROSOFT_MAIL_OPERATIONS.reply);
    const original = await this.readMessage(input.messageId);
    const mime = await buildReply(this.http.accountEmail, original, input);
    await this.http.request(MICROSOFT_MAIL_OPERATIONS.reply, `me/messages/${segment(input.messageId)}/reply`, { method: "POST", headers: { "content-type": "text/plain", Prefer: 'IdType="ImmutableId"' }, raw: base64(mime.bytes) });
    // 202 only acknowledges submission. Graph does not return the sent message ID here.
    return { provider: "microsoft", state: "accepted", threadId: input.threadId, internetMessageId: mime.internetMessageId };
  }
  async listChanges(folderId: string, cursor?: string): Promise<Page<GraphMessageChange>> {
    const path = `me/mailFolders/${segment(folderId)}/messages/delta`;
    const initial = query(path, { "$select": "id,conversationId,internetMessageId,subject,from,replyTo,body" });
    const data = await this.http.request<GraphPage>(MICROSOFT_MAIL_OPERATIONS.read, cursorURL(cursor, initial, GRAPH_BASE, "/v1.0/" + path), { cursorStatuses: [410], headers: { Prefer: 'IdType="ImmutableId", odata.maxpagesize=100' } });
    return graphMailPage(data, GRAPH_BASE, "/v1.0/" + path);
  }
}
