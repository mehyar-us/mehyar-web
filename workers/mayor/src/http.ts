export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  } });
}

export async function readJson(request: Request, maxBytes = 32_768): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'json_required', 'Send this request as JSON.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'invalid_body', 'A request body is required.');
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) { await reader.cancel(); throw new HttpError(413, 'body_too_large', 'This request is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new HttpError(400, 'invalid_json', 'The request could not be read.'); }
}

export function requireOrigin(request: Request, origin: string) {
  if (request.headers.get('origin') !== new URL(origin).origin) {
    throw new HttpError(403, 'invalid_origin', 'Open the app and try again.');
  }
}

export function requestKey(request: Request): string {
  const key = request.headers.get('x-idempotency-key');
  if (!key || !/^[a-zA-Z0-9_-]{16,128}$/.test(key)) {
    throw new HttpError(400, 'idempotency_key_required', 'A unique request key is required.');
  }
  return key;
}

export async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
