export type Provider = "google" | "microsoft";
export interface ConnectorAuth { accessToken: string; grantedScopes: readonly string[]; accountEmail: string; }
export interface ClientOptions { fetch?: typeof fetch; timeoutMs?: number; }
export interface Operation { name: string; effect: "read" | "write"; scopes: readonly (readonly string[])[]; }
export interface Page<T> { items: T[]; nextCursor?: string; syncCursor?: string; }
export interface Calendar { id: string; name: string; timeZone?: string; canWrite: boolean; }
export interface TimeWindow { start: string; end: string; timeZone: string; }
export interface AppointmentInput extends TimeWindow {
  title: string; description?: string; attendees: string[]; requestId: string;
}
export interface AppointmentReceipt {
  provider: Provider; id: string; calendarId: string; etag?: string; url?: string;
  timeZone: string; state: "applied" | "accepted"; requestId?: string;
}
export interface Availability { busy: { start: string; end: string }[]; complete: boolean; nextCursor?: string; }
export interface MailMessage {
  id: string; threadId: string; subject: string; from: string; replyTo?: string;
  internetMessageId?: string; references?: string; body: unknown;
}
export interface ReplyInput { messageId: string; threadId: string; recipient: string; text: string; requestId: string; }
export interface MailReceipt { provider: Provider; state: "accepted"; id?: string; threadId: string; internetMessageId: string; }
export interface WatchReceipt { id?: string; resourceId?: string; expiresAt: string; cursor?: string; }
export type FailureKind = "invalid_input" | "insufficient_scope" | "reauthorization_required" | "permission_denied"
  | "rate_limited" | "conflict" | "cursor_invalid" | "not_found" | "retryable_read" | "ambiguous_write" | "provider_rejected" | "invalid_response";
export class ConnectorError extends Error {
  constructor(public readonly kind: FailureKind, public readonly operation: string, public readonly status?: number, public readonly retryAfterSeconds?: number) {
    super(`${operation}:${kind}`); this.name = "ConnectorError";
  }
}
