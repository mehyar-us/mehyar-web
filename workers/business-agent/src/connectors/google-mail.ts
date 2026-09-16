import { ProviderHTTP, query, segment } from "./http";
import { base64, buildReply } from "./mail";
import { gmailHistoryPage, gmailMessagePage, gmailProfileHistory } from "./mail-pages";
import {mailSnapshot} from './mail-snapshot';
import { ConnectorError, type ClientOptions, type ConnectorAuth, type MailMessage, type MailReceipt, type Operation, type Page, type ReplyInput, type WatchReceipt } from "./types";
const prefix = "https://www.googleapis.com/auth/";
const read = [prefix + "gmail.readonly", prefix + "gmail.modify", "https://mail.google.com/"];
export const GOOGLE_MAIL_OPERATIONS = {
  read: { name: "google.mail.read", effect: "read", scopes: [read] },
  reply: { name: "google.mail.reply", effect: "write", scopes: [read, [prefix + "gmail.send", prefix + "gmail.modify", "https://mail.google.com/"]] },
  watch: { name: "google.mail.watch", effect: "write", scopes: [read] },
} as const satisfies Record<string, Operation>;
interface GmailMessage { id: string; threadId: string; payload?: { headers?: { name: string; value: string }[]; [key: string]: unknown }; }
type GmailReference = { id: string; threadId: string };
export interface GmailHistory { id: string; messages?: GmailReference[]; messagesAdded?: { message: GmailReference }[]; messagesDeleted?: { message: GmailReference }[]; labelsAdded?: { message: GmailReference; labelIds: string[] }[]; labelsRemoved?: { message: GmailReference; labelIds: string[] }[]; }
function normalize(message: GmailMessage): MailMessage {
  const header = (name: string) => message.payload?.headers?.find((item) => item.name.toLowerCase() === name)?.value ?? "";
  return { id: message.id, threadId: message.threadId, subject: header("subject"), from: header("from"), replyTo: header("reply-to") || undefined, internetMessageId: header("message-id") || undefined, references: header("references") || undefined, body: message.payload };
}

/** Gmail v1; raw message bodies must be treated as untrusted provider content. */
export class GoogleMailClient {
  private readonly http: ProviderHTTP;
  constructor(auth: ConnectorAuth, options?: ClientOptions) { this.http = new ProviderHTTP(auth, "https://gmail.googleapis.com/gmail/v1/users/me/", options); }
  async profileHistory():Promise<string> {
    return gmailProfileHistory(await this.http.request<unknown>(GOOGLE_MAIL_OPERATIONS.read,'profile'),this.http.accountEmail);
  }
  async readSnapshot(messageId:string) {
    return mailSnapshot('google',await this.http.request<unknown>(GOOGLE_MAIL_OPERATIONS.read,`messages/${segment(messageId)}?format=full`),messageId);
  }
  async listMessages(pageToken?: string): Promise<Page<{ id: string; threadId: string }>> {
    const data = await this.http.request<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(GOOGLE_MAIL_OPERATIONS.read, query("messages", { maxResults: "100", includeSpamTrash: "true", pageToken }));
    return gmailMessagePage(data);
  }
  async readThread(threadId: string): Promise<MailMessage[]> {
    const data = await this.http.request<{ messages?: GmailMessage[] }>(GOOGLE_MAIL_OPERATIONS.read, `threads/${segment(threadId)}?format=full`);
    return (data.messages ?? []).map(normalize);
  }
  // https://developers.google.com/workspace/gmail/api/guides/sending
  async sendReply(input: ReplyInput): Promise<MailReceipt> {
    this.http.authorize(GOOGLE_MAIL_OPERATIONS.reply);
    const original = (await this.readThread(input.threadId)).find((message) => message.id === input.messageId);
    if (!original) throw new ConnectorError("not_found", "google.mail.reply_target");
    const mime = await buildReply(this.http.accountEmail, original, input);
    const data = await this.http.request<{ id: string; threadId: string }>(GOOGLE_MAIL_OPERATIONS.reply, "messages/send", {
      method: "POST", body: { threadId: input.threadId, raw: base64(mime.bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") },
    });
    if (!data.id || !data.threadId) throw new ConnectorError("ambiguous_write", "google.mail.reply_receipt");
    return { provider: "google", state: "accepted", id: data.id, threadId: data.threadId, internetMessageId: mime.internetMessageId };
  }
  // A 404 means the history cursor expired; full listMessages/readThread sync is required.
  async listHistory(startHistoryId: string, pageToken?: string): Promise<Page<GmailHistory>> {
    if (!/^\d{1,20}$/.test(startHistoryId)) throw new ConnectorError("invalid_input", "history_cursor");
    const data = await this.http.request<{ history?: GmailHistory[]; nextPageToken?: string; historyId: string }>(GOOGLE_MAIL_OPERATIONS.read, query("history", { startHistoryId, pageToken, maxResults: "100" }), { cursorStatuses: [404] });
    return gmailHistoryPage(data, startHistoryId);
  }
  // The Pub/Sub topic must belong to the authorized Google Cloud project and grant Gmail publish rights.
  async renewWatch(topicName: string): Promise<WatchReceipt> {
    if (!/^projects\/[A-Za-z0-9-]+\/topics\/[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/.test(topicName)) throw new ConnectorError("invalid_input", "pubsub_topic");
    const data = await this.http.request<{ historyId: string; expiration: string }>(GOOGLE_MAIL_OPERATIONS.watch, "watch", { method: "POST", body: { topicName } });
    return { cursor: data.historyId, expiresAt: new Date(Number(data.expiration)).toISOString() };
  }
  async stopWatch(): Promise<void> { await this.http.request(GOOGLE_MAIL_OPERATIONS.watch, "stop", { method: "POST" }); }
}
