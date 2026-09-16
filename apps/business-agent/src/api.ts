export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = "request_failed",
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError(
      "We couldn't reach your workspace. Check your connection and try again.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data?.error;
    throw new ApiError(
      typeof error === "object"
        ? error?.message || "This request could not be completed."
        : data?.message ||
          (typeof error === "string"
            ? error.replaceAll("_", " ")
            : "This request could not be completed."),
      response.status,
      error?.code,
    );
  }
  if (!data)
    throw new ApiError(
      "The workspace returned an unexpected response. Please try again.",
    );
  return data as T;
}

export const post = <T>(
  path: string,
  data: unknown,
  headers?: Record<string, string>,
) => api<T>(path, { method: "POST", body: JSON.stringify(data), headers });

export type User = { id: string; name: string; email: string };
export type Tenant = {
  id: string;
  name: string;
  website?: string;
  goal?: string;
  status: string;
  agentName?: string;
  planId?: string;
  paused?: boolean;
};
export type Message = {
  briefSuggestions?:{field:string;value:string;sourceMessageId:string}[];
  id: string;
  role: string;
  content: string;
  createdAt?: string;
};
export type Memory = {
  id: string;
  key: string;
  value: unknown;
  source?: string;
  sourceUrl?: string;
  updatedAt?: string;
};
export type Connection = {
  id: string;
  provider: string;
  status: string;
  email?: string;
  accountEmail?: string;
  capabilities?: string[];
};
export type Activity = {
  id: string;
  title?: string;
  action?: string;
  type?: string;
  description?: string;
  status?: string;
  createdAt?: string;
};
export type Snapshot = {
  tenant: Tenant;
  membership: { role: string };
  connections: Connection[];
  activity: Activity[];
  memory: Memory[];
  usage?: Record<string, unknown>;
  approvals?: { id: string; title: string; status: string }[];
};
export type Provider = {
  configured: boolean;
  capabilities: {
    id: string;
    label: string;
    enabled: boolean;
    reason?: string;
  }[];
};
export type AuthCapabilities = {
  providers: { google: Provider; microsoft: Provider };
};
export type Grant = {
  id: string;
  provider: string;
  tenantId: string | null;
  grantedScopes: string[];
  selectedCapabilities: string[];
  grantedCapabilities: string[];
  status: string;
  lastAuthorizedAt?: string;
};
export type Catalog = {
  version: string;
  brand: string;
  currency: string;
  commerceEnabled: boolean;
  plans: Record<string, unknown>[];
  addons: Record<string, unknown>[];
  trial?: Record<string, unknown>;
};

export function displayValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
