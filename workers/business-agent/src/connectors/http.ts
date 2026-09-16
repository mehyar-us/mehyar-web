import { ConnectorError, type ClientOptions, type ConnectorAuth, type Operation, type TimeWindow, type AppointmentInput } from "./types";

export function segment(value: string): string {
  if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value) || value === "." || value === "..") throw new ConnectorError("invalid_input", "resource_id");
  return encodeURIComponent(value);
}
export function singleLine(value: string, name: string, max = 1000): string {
  if (!value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new ConnectorError("invalid_input", name);
  return value;
}
export function email(value: string): string {
  if (value.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(value)) throw new ConnectorError("invalid_input", "email");
  return value;
}
export function windowInput(value: TimeWindow): void {
  const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!instant.test(value.start) || !instant.test(value.end) || !Number.isFinite(Date.parse(value.start)) || !Number.isFinite(Date.parse(value.end)) || Date.parse(value.start) >= Date.parse(value.end)) throw new ConnectorError("invalid_input", "time_window");
  // IANA time zones preserve DST semantics; never accept ambiguous bare local times.
  try { new Intl.DateTimeFormat("en", { timeZone: value.timeZone }).format(); }
  catch { throw new ConnectorError("invalid_input", "time_zone"); }
}
export function appointmentInput(input: AppointmentInput): void {
  windowInput(input); singleLine(input.title, "title", 500); singleLine(input.requestId, "request_id", 128);
  if (input.attendees.length > 50 || (input.description?.length ?? 0) > 20000) throw new ConnectorError("invalid_input", "appointment");
  input.attendees.forEach(email);
}
export function requireEtag(value: string) { return singleLine(value, "etag", 1024); }
export async function stableId(value: string): Promise<string> {
  singleLine(value, "request_id", 128);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mehyar:${value}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function query(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return path + (query.size ? `?${query}` : "");
}
export function cursorURL(cursor: string | undefined, initial: string, base: string, resourcePath: string): string {
  if (!cursor) return initial;
  let url: URL;
  try { url = new URL(cursor); } catch { throw new ConnectorError("invalid_input", "cursor"); }
  if (url.origin !== new URL(base).origin || url.pathname !== resourcePath || url.username || url.password || url.hash) throw new ConnectorError("invalid_input", "cursor");
  return url.href;
}
async function responseText(response: Response, operation: Operation): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let length = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    length += value.byteLength;
    if (length > 2_000_000) {
      await reader.cancel();
      throw new ConnectorError(operation.effect === "write" ? "ambiguous_write" : "invalid_response", operation.name);
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** No automatic retries: a lost response to a write requires reconciliation first. */
export class ProviderHTTP {
  readonly accountEmail: string;
  private readonly fetcher: typeof fetch;
  constructor(private readonly auth: ConnectorAuth, private readonly base: string, private readonly options: ClientOptions = {}) {
    this.accountEmail = email(auth.accountEmail);
    if (!auth.accessToken || /[\r\n]/.test(auth.accessToken)) throw new ConnectorError("invalid_input", "access_token");
    this.fetcher = options.fetch ?? fetch;
  }
  authorize(operation: Operation): void {
    const granted = new Set(this.auth.grantedScopes.map((scope) => scope.replace(/^https:\/\/graph\.microsoft\.com\//, "")));
    if (!operation.scopes.every((alternatives) => alternatives.some((scope) => granted.has(scope)))) throw new ConnectorError("insufficient_scope", operation.name);
  }
  async request<T>(operation: Operation, path: string, options: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: string; cursorStatuses?: number[] } = {}): Promise<T> {
    this.authorize(operation);
    const url = new URL(path, this.base);
    const base = new URL(this.base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.username || url.password || url.hash) throw new ConnectorError("invalid_input", operation.name);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15000);
    try {
      const response = await this.fetcher(url, {
        method: options.method ?? "GET", redirect: "manual", signal: controller.signal,
        headers: { accept: "application/json", ...(options.body === undefined ? {} : { "content-type": "application/json" }), ...options.headers, authorization: `Bearer ${this.auth.accessToken}` },
        ...(options.raw !== undefined ? { body: options.raw } : options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      if (!response.ok) {
        const status = response.status;
        const retry = response.headers.get("retry-after");
        const seconds = retry ? (/^\d+$/.test(retry) ? Number(retry) : Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000))) : undefined;
        const kind = options.cursorStatuses?.includes(status) ? "cursor_invalid"
          : status === 401 ? "reauthorization_required" : status === 403 ? "permission_denied"
          : status === 429 ? "rate_limited" : [409, 412].includes(status) ? "conflict"
          : status === 404 ? "not_found" : status >= 500 || status === 408 ? (operation.effect === "write" ? "ambiguous_write" : "retryable_read") : "provider_rejected";
        // Provider error bodies can contain PII or credential echoes; never surface them.
        await response.body?.cancel();
        throw new ConnectorError(kind, operation.name, status, Number.isFinite(seconds) ? seconds : undefined);
      }
      if ([202, 204].includes(response.status)) { await response.body?.cancel(); return undefined as T; }
      const text = await responseText(response, operation);
      try { return JSON.parse(text) as T; }
      catch { throw new ConnectorError(operation.effect === "write" ? "ambiguous_write" : "invalid_response", operation.name); }
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError(operation.effect === "write" ? "ambiguous_write" : "retryable_read", operation.name);
    } finally { clearTimeout(timer); }
  }
}
