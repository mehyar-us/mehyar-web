import { email, singleLine, stableId } from "./http";
import { ConnectorError, type MailMessage, type ReplyInput } from "./types";

export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
}
export function mailbox(header: string): string {
  singleLine(header, "mailbox");
  const named = header.match(/^[^<>]*<([^<>]+)>$/);
  return email((named ? named[1] : header).trim());
}
function messageId(value: string): string {
  if (!/^<[^<>\s@]+@[^<>\s@]+>$/.test(value) || value.length > 254) throw new ConnectorError("invalid_input", "message_id");
  return value;
}
function encodedSubject(value: string): string {
  if (value === "") return "";
  singleLine(value, "subject", 500);
  const chunks: string[] = [];
  let chunk = "";
  for (const char of value) {
    if (new TextEncoder().encode(chunk + char).length > 42) { chunks.push(chunk); chunk = ""; }
    chunk += char;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map((part) => `=?UTF-8?B?${base64(new TextEncoder().encode(part))}?=`).join("\r\n ");
}

/** Only one verified reply recipient; arbitrary MIME/header input is never accepted. */
export async function buildReply(from: string, original: MailMessage, input: ReplyInput) {
  if (original.id !== input.messageId || original.threadId !== input.threadId || !original.internetMessageId) throw new ConnectorError("invalid_input", "reply_target");
  const recipient = mailbox(original.replyTo || original.from);
  if (recipient.toLowerCase() !== email(input.recipient).toLowerCase()) throw new ConnectorError("invalid_input", "reply_recipient");
  if (!input.text.trim() || new TextEncoder().encode(input.text).length > 128000) throw new ConnectorError("invalid_input", "reply_body");
  const sender = email(from);
  const parent = messageId(original.internetMessageId);
  const references = (original.references?.trim().split(/\s+/).filter(Boolean) ?? []).slice(-19).map(messageId);
  if (!references.includes(parent)) references.push(parent);
  const ownMessageId = `<${await stableId(input.requestId)}@${sender.split("@")[1]}>`;
  const lines = [
    `From: ${sender}`, `To: ${recipient}`, `Subject: ${encodedSubject(original.subject)}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: ${ownMessageId}`, `In-Reply-To: ${parent}`,
    `References: ${references.join("\r\n ")}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64", "", base64(new TextEncoder().encode(input.text)).match(/.{1,76}/g)!.join("\r\n"), "",
  ];
  return { bytes: new TextEncoder().encode(lines.join("\r\n")), internetMessageId: ownMessageId };
}
