const DEFAULT_API_BASE_URL = "";

export const MEHYARSOFT_API_BASE_URL = (
  import.meta.env.VITE_MEHYARSOFT_API_BASE_URL || DEFAULT_API_BASE_URL
).replace(/\/$/, "");

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue | undefined };
type ApiPayload = Record<string, JsonValue | undefined>;

export type IntakeFormType = "contact" | "audit" | "booking" | "newsletter" | "phone_help";

export interface IntakePayload extends ApiPayload {
  form_type: IntakeFormType;
  name?: string;
  email: string;
  phone?: string;
  company?: string;
  website?: string;
  service_interest?: string;
  budget_range?: string;
  timeline?: string;
  message?: string;
  consent_contact: boolean;
  consent_marketing?: boolean;
  turnstile_token: string;
  hp_field?: string;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
  };
}

export interface UnsubscribePayload extends ApiPayload {
  email: string;
  reason?: string;
  source: string;
}

export interface AdminLoginPayload extends ApiPayload {
  email: string;
  password: string;
}

export interface AdminSession {
  token: string;
  expiresAt?: string;
}

export interface AdminMetrics {
  leads: number;
  contactRequests: number;
  auditRequests: number;
  bookingRequests: number;
  newsletterRequests: number;
  suppressions: number;
  updatedAt?: string;
}

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sanitizePayload(payload: ApiPayload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== "")
  );
}

function endpoint(path: string) {
  return `${MEHYARSOFT_API_BASE_URL}${path}`;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(endpoint(path), {
    ...init,
    headers,
  });
  const data = await parseResponse(response);

  if (!response.ok || (data && typeof data === "object" && "ok" in data && data.ok === false)) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String((data as { message: unknown }).message)
        : `MehyarSoft API request failed with status ${response.status}`;
    throw new ApiError(message, response.status, data);
  }

  return data as T;
}

function postJson<T>(path: string, payload: ApiPayload, token?: string) {
  return apiFetch<T>(path, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: JSON.stringify(sanitizePayload(payload)),
  });
}

export const mehyarSoftApi = {
  submitIntake(payload: IntakePayload) {
    return postJson<{ ok: boolean; lead_id?: string; message?: string }>("/api/intake", payload);
  },

  createLead(payload: IntakePayload) {
    return this.submitIntake({ ...payload, form_type: "contact" });
  },

  createAuditRequest(payload: IntakePayload) {
    return this.submitIntake({ ...payload, form_type: "audit" });
  },

  createBookingRequest(payload: IntakePayload) {
    return this.submitIntake({ ...payload, form_type: "booking" });
  },

  unsubscribe(payload: UnsubscribePayload) {
    return postJson<{ ok: boolean; status?: string; message?: string }>("/api/suppressions/unsubscribe", payload);
  },

  login(payload: AdminLoginPayload) {
    return postJson<AdminSession>("/api/admin/auth/login", payload);
  },

  getMetrics(token: string) {
    return apiFetch<AdminMetrics>("/api/admin/metrics", {
      headers: { Authorization: `Bearer ${token}` },
    });
  },
};
