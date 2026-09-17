const API_BASE = "/api/admin/center/";

interface ApiEnvelope {
  ok: boolean;
  error?: string;
}

/**
 * Fetch a center API endpoint and return the parsed JSON.
 * Throws with the server's error message when the envelope says ok:false
 * or the HTTP status is not ok.
 */
export async function api<T extends ApiEnvelope>(path: string, token: string | null): Promise<T> {
  const url = `${API_BASE}${path.replace(/^\/+/, "")}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Network request failed");
  }

  let body: T | null = null;
  try {
    body = (await res.json()) as T;
  } catch {
    body = null;
  }

  if (!res.ok) {
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  if (!body) {
    throw new Error("Empty response from server");
  }
  if (body.ok === false) {
    throw new Error(body.error || "Request failed");
  }
  return body;
}
