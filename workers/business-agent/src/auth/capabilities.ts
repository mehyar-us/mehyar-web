export type OAuthProvider = "google" | "microsoft";

export interface AuthEnv {
  AGENT_DB: D1Database;
  APP_ORIGIN: string;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  GOOGLE_ENABLED_CAPABILITIES?: string;
  MICROSOFT_ENABLED_CAPABILITIES?: string;
}

export const CAPABILITIES = {
  google: [
    { id: "gmail_read", label: "Read business email", scopes: ["https://www.googleapis.com/auth/gmail.readonly"] },
    { id: "gmail_send", label: "Send business email", scopes: ["https://www.googleapis.com/auth/gmail.send"] },
    { id: "calendar_read", label: "Check calendar availability", scopes: ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events.readonly", "https://www.googleapis.com/auth/calendar.freebusy"] },
    { id: "calendar_manage", label: "Manage appointments", scopes: ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"] },
    { id: "drive_read", label: "Import Drive documents I select", scopes: ["https://www.googleapis.com/auth/drive.readonly"] },
  ],
  microsoft: [
    { id: "mail_read", label: "Read business email", scopes: ["Mail.Read"] },
    { id: "mail_send", label: "Send business email", scopes: ["Mail.Send"] },
    { id: "calendar_read", label: "Check calendar availability", scopes: ["Calendars.Read"] },
    { id: "calendar_manage", label: "Manage appointments", scopes: ["Calendars.ReadWrite"] },
  ],
} as const;

export function providerConfigured(env: AuthEnv, provider: OAuthProvider): boolean {
  return Boolean(env.BETTER_AUTH_SECRET && (provider === "google"
    ? env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    : env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET));
}

function enabledCapabilities(env: AuthEnv, provider: OAuthProvider): Set<string> {
  const raw = provider === "google" ? env.GOOGLE_ENABLED_CAPABILITIES : env.MICROSOFT_ENABLED_CAPABILITIES;
  return new Set((raw ?? "").split(",").map((item) => item.trim()).filter(Boolean));
}

export function capabilityStatus(env: AuthEnv) {
  return { providers: Object.fromEntries((["google", "microsoft"] as const).map((provider) => {
    const configured = providerConfigured(env, provider);
    const enabled = enabledCapabilities(env, provider);
    return [provider, {
      configured,
      capabilities: CAPABILITIES[provider].map(({ id, label }) => ({
        id, label,
        enabled: configured && Boolean(env.TOKEN_ENCRYPTION_KEY) && enabled.has(id),
        ...(!(configured && env.TOKEN_ENCRYPTION_KEY && enabled.has(id))
          ? { reason: "This connection is awaiting configuration and production verification." } : {}),
      })),
    }];
  })) };
}

/** Returns only server-approved scopes. An empty selection is identity-only. */
export function scopesForSelection(env: AuthEnv, provider: OAuthProvider, selection: readonly string[]): string[] {
  if (selection.length > 5 || new Set(selection).size !== selection.length) throw new Error("invalid_capability_selection");
  const enabled = enabledCapabilities(env, provider);
  const scopes: string[] = [];
  for (const id of selection) {
    const definition = CAPABILITIES[provider].find((capability) => capability.id === id);
    if (!definition) throw new Error("unknown_capability");
    if (!enabled.has(id) || !env.TOKEN_ENCRYPTION_KEY) throw new Error("capability_unavailable");
    scopes.push(...definition.scopes);
  }
  if (provider === "microsoft" && selection.length) scopes.push("offline_access");
  return [...new Set(scopes)];
}

/** Token-response scopes are authoritative; requested scopes are never a fallback. */
export function grantedCapabilities(provider: OAuthProvider, scopes: readonly string[], selected: readonly string[]) {
  const granted = new Set(scopes.map((scope) => scope.replace(/^https:\/\/graph\.microsoft\.com\//, "")));
  return CAPABILITIES[provider].filter((capability) => selected.includes(capability.id)
    && capability.scopes.every((scope) => granted.has(scope))).map((capability) => capability.id);
}
