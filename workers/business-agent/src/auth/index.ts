import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin, type GenericEndpointContext } from "better-auth";
import { addOAuthServerContext, createAuthMiddleware, getOAuthState } from "better-auth/api";
import { google, microsoft } from "better-auth/social-providers";
import { decryptOAuthToken, verifyProviderIdToken, type OAuth2Tokens } from "better-auth/oauth2";
import { z } from "zod";
import { capabilityStatus, grantedCapabilities, providerConfigured, scopesForSelection, type AuthEnv, type OAuthProvider } from "./capabilities";
import { attachUnassignedGrant, requireConnectorManager, revokeProviderGrant, storeProviderGrant } from "./vault";
import { HttpError, readJson } from "../http";
import {grantAccountEmail} from './grant-label';

export type { AuthEnv } from "./capabilities";
export { attachUnassignedGrant } from "./vault";

type Flow = { provider: OAuthProvider; selected: string[]; userId: string | null; tenantId: string | null };
const flowSchema = z.object({ provider: z.enum(["google", "microsoft"]), selected: z.array(z.string()).max(5), userId: z.string().nullable(), tenantId: z.string().nullable() });
const startSchema = z.object({ capabilities: z.array(z.string()).max(5).default([]), tenantId: z.string().min(1).max(128).optional() }).strict();

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
async function payload(request: Request): Promise<{ data: unknown; error?: never } | { data?: never; error: Response }> {
  try { return { data: await readJson(request, 4096) }; }
  catch (error) {
    if (error instanceof HttpError) return { error: json({ error: error.code }, error.status) };
    throw error;
  }
}

/** Google/MS built-ins use PKCE. This adds nonce binding to their redirect flow. */
const noncePlugin: BetterAuthPlugin = {
  id: "mehyar-oidc-nonce",
  init(context) {
    for (const provider of context.socialProviders) {
      if (typeof provider === "function" || !["google", "microsoft"].includes(provider.id)) continue;
      provider.requiresIdTokenNonce = true;
      const createURL = provider.createAuthorizationURL.bind(provider);
      provider.createAuthorizationURL = async (data) => {
        if (!data.idTokenNonce) throw new Error("oauth_nonce_missing");
        const url = await createURL(data);
        url.searchParams.set("nonce", data.idTokenNonce);
        return url;
      };
    }
  },
};

/** A new instance per request keeps transient OAuth tokens out of shared Worker state. */
export function createAuth(env: AuthEnv, startFlow?: Flow) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) throw new Error("auth_not_configured");
  const origin = new URL(env.APP_ORIGIN).origin;
  const captured = new Map<OAuthProvider, OAuth2Tokens>();
  const providerEmails = new Map<OAuthProvider, string>();
  const socialProviders: BetterAuthOptions["socialProviders"] = {};

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    const options = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, accessType: "offline" as const, includeGrantedScopes: true };
    const verifier = google(options);
    socialProviders.google = {
      ...options,
      disableIdTokenSignIn: true,
      requireEmailVerification: true,
      getUserInfo: async (tokens) => {
        const state = await getOAuthState();
        const nonce = typeof state?.idTokenNonce === "string" ? state.idTokenNonce : undefined;
        if (!nonce || !tokens.idToken || !(await verifyProviderIdToken(verifier, tokens.idToken, nonce))) return null;
        const profile = await verifier.getUserInfo(tokens);
        if (!profile?.user.email || !z.email().safeParse(profile.user.email).success) return null;
        captured.set("google", tokens);
        providerEmails.set("google", profile.user.email);
        return profile;
      },
    };
  }
  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    const options = { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET, tenantId: "common", disableDefaultScope: true, scope: ["openid", "profile", "email"], disableProfilePhoto: true };
    const verifier = microsoft(options);
    socialProviders.microsoft = {
      ...options,
      disableIdTokenSignIn: true,
      getUserInfo: async (tokens) => {
        const state = await getOAuthState();
        const nonce = typeof state?.idTokenNonce === "string" ? state.idTokenNonce : undefined;
        if (!nonce || !tokens.idToken || !(await verifyProviderIdToken(verifier, tokens.idToken, nonce))) return null;
        const profile = await verifier.getUserInfo(tokens);
        if (!profile?.user.email || !z.email().safeParse(profile.user.email).success) return null;
        captured.set("microsoft", tokens);
        providerEmails.set("microsoft", profile.user.email);
        return profile;
      },
    };
  }

  const saveGrant = async (account: { userId: string; accountId: string; providerId: string; refreshToken?: string | null; refreshTokenExpiresAt?: Date | null }, context: GenericEndpointContext | null) => {
    if (account.providerId !== "google" && account.providerId !== "microsoft") return;
    const tokens = captured.get(account.providerId);
    const accountEmail = providerEmails.get(account.providerId);
    const state = await getOAuthState();
    const parsed = flowSchema.safeParse(state?.serverContext?.mehyar);
    if (!tokens || !accountEmail || !parsed.success || !parsed.data.selected.length) return;
    const flow = parsed.data;
    if (flow.provider !== account.providerId || (flow.userId && flow.userId !== account.userId)) throw new Error("oauth_account_binding_mismatch");
    scopesForSelection(env, flow.provider, flow.selected);
    if (!tokens.accessToken) throw new Error("provider_access_token_missing");
    // Incremental consent may omit a refresh token already issued at identity signup.
    // Recover it only from this verified account, entirely on the server.
    const needsReconnect = await env.AGENT_DB.prepare("SELECT id FROM auth_provider_grants WHERE user_id=? AND provider=? AND account_id=? AND status='reconnect_required' LIMIT 1")
      .bind(account.userId,flow.provider,account.accountId).first();
    // A failed/ambiguous refresh invalidates the old-account fallback too. Only a
    // newly returned refresh token can establish offline access in that case.
    const refreshToken = tokens.refreshToken ?? (!needsReconnect && account.refreshToken && context
      ? await decryptOAuthToken(account.refreshToken, context.context) : undefined);
    await storeProviderGrant(env, { userId: account.userId, provider: flow.provider, accountId: account.accountId, tenantId: flow.tenantId }, {
      accountEmail, // Verified provider account identity, never the platform user's login email.
      accessToken: tokens.accessToken,
      refreshToken: refreshToken || undefined,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt?.toISOString(),
      refreshTokenExpiresAt: (tokens.refreshTokenExpiresAt ?? account.refreshTokenExpiresAt)?.toISOString(),
      grantedScopes: tokens.scopes ?? [],
    }, flow.selected);
  };

  return betterAuth({
    appName: "Mehyar Business Agent",
    baseURL: origin,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.AGENT_DB,
    trustedOrigins: [origin],
    socialProviders,
    emailAndPassword: { enabled: false },
    user: { modelName: "auth_user" },
    session: { modelName: "auth_session", cookieCache: { enabled: false }, expiresIn: 60 * 60 * 24 * 7 },
    account: {
      modelName: "auth_account",
      encryptOAuthTokens: true,
      storeAccountCookie: false,
      storeStateStrategy: "database",
      updateAccountOnSignIn: true,
      accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: true, trustedProviders: ["google", "microsoft"] },
    },
    verification: { modelName: "auth_verification" },
    rateLimit: { enabled: true, storage: "database", modelName: "auth_rate_limit", window: 60, max: 30 },
    advanced: {
      cookiePrefix: "mehyar-agent",
      useSecureCookies: origin.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    disabledPaths: ["/get-access-token", "/refresh-token", "/account-info", "/sign-in/email", "/sign-up/email"],
    logger: { disabled: true }, // Never log provider payloads or exception objects.
    telemetry: { enabled: false },
    onAPIError: { errorURL: `${origin}/?auth_error=1` },
    plugins: [noncePlugin],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/social" || ctx.path === "/link-social") {
          if (!startFlow) throw new Error("use_scoped_authorization_entrypoint");
          await addOAuthServerContext({ mehyar: startFlow });
        }
      }),
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => ({ data: { ...account, idToken: null } }),
          after: saveGrant,
        },
        update: {
          before: async (account) => {
            const provider = account.providerId as OAuthProvider | undefined;
            const tokens = provider ? captured.get(provider) : undefined;
            return { data: { ...account, idToken: null, ...(tokens ? { scope: (tokens.scopes ?? []).join(",") } : {}) } };
          },
          after: saveGrant,
        },
      },
    },
  });
}

export async function getSession(request: Request, env: AuthEnv) {
  if (!env.BETTER_AUTH_SECRET) return null;
  const result = await createAuth(env).api.getSession({ headers: request.headers });
  if (!result) return null;
  return { user: { id: result.user.id, email: result.user.email, name: result.user.name, emailVerified: result.user.emailVerified }, session: { id: result.session.id, expiresAt: result.session.expiresAt } };
}

/** Mount this wrapper, never auth.handler directly: only these browser routes exist. */
export async function handleAuthRequest(request: Request, env: AuthEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/api/auth/capabilities" && request.method === "GET") return json(capabilityStatus(env));
  if (!env.BETTER_AUTH_SECRET) return json({ error: "auth_not_configured" }, 503);
  if (path === "/api/auth/grants" && request.method === "GET") {
    const session = await getSession(request, env);
    if (!session) return json({ error: "authentication_required" }, 401);
    const rows = await env.AGENT_DB.prepare(`SELECT id, provider, account_id, ciphertext, tenant_scope, granted_scopes,
      selected_capabilities, status, updated_at FROM auth_provider_grants WHERE user_id = ? ORDER BY updated_at DESC`)
      .bind(session.user.id).all<{ id: string; provider: OAuthProvider; account_id:string;ciphertext:string;tenant_scope: string; granted_scopes: string; selected_capabilities: string; status: string; updated_at: string }>();
    return json({ grants: await Promise.all(rows.results.map(async(row) => {
      const grantedScopes: string[] = JSON.parse(row.granted_scopes);
      const selectedCapabilities: string[] = JSON.parse(row.selected_capabilities);
      return { id: row.id, provider: row.provider, tenantId: row.tenant_scope || null,
        accountEmail:await grantAccountEmail(env,{userId:session.user.id,provider:row.provider,accountId:row.account_id,tenantId:row.tenant_scope||null},row.ciphertext,row.status),
        grantedScopes, selectedCapabilities,
        grantedCapabilities: grantedCapabilities(row.provider, grantedScopes, selectedCapabilities),
        status: row.status, lastAuthorizedAt: row.updated_at };
    })) });
  }
  if (["/api/auth/grants/attach", "/api/auth/grants/revoke"].includes(path) && request.method === "POST") {
    if (request.headers.get("origin") !== new URL(env.APP_ORIGIN).origin) return json({ error: "invalid_origin" }, 403);
    const session = await getSession(request, env);
    if (!session) return json({ error: "authentication_required" }, 401);
    const body = await payload(request);
    if (body.error) return body.error;
    const input = z.object({ grantId: z.string().min(1).max(128), tenantId: z.string().min(1).max(128).optional() }).strict()
      .safeParse(body.data);
    if (!input.success) return json({ error: "invalid_grant_request" }, 400);
    try {
      if (path.endsWith("/revoke")) return json(await revokeProviderGrant(env, session.user.id, input.data.grantId, input.data.tenantId));
      if (!input.data.tenantId) return json({ error: "invalid_grant_request" }, 400);
      return json(await attachUnassignedGrant(env, session.user.id, input.data.grantId, input.data.tenantId));
    }
    catch (error) {
      const code = error instanceof Error ? error.message : "grant_update_failed";
      return json({ error: ["tenant_connection_forbidden", "grant_not_found"].includes(code) ? code : "grant_update_failed" }, code === "tenant_connection_forbidden" ? 403 : 400);
    }
  }
  const startMatch = path.match(/^\/api\/auth\/start\/(google|microsoft)$/);
  if (startMatch && request.method === "POST") {
    if (request.headers.get("origin") !== new URL(env.APP_ORIGIN).origin) return json({ error: "invalid_origin" }, 403);
    const body = await payload(request);
    if (body.error) return body.error;
    const parsed = startSchema.safeParse(body.data);
    if (!parsed.success) return json({ error: "invalid_authorization_request" }, 400);
    const provider = startMatch[1] as OAuthProvider;
    if (!providerConfigured(env, provider)) return json({ error: "provider_not_configured" }, 503);
    try {
      const scopes = scopesForSelection(env, provider, parsed.data.capabilities);
      const session = await getSession(request, env);
      if (parsed.data.tenantId) {
        if (!session) return json({ error: "authentication_required" }, 401);
        await requireConnectorManager(env, parsed.data.tenantId, session.user.id);
      }
      const flow: Flow = { provider, selected: parsed.data.capabilities, userId: session?.user.id ?? null, tenantId: parsed.data.tenantId ?? null };
      const auth = createAuth(env, flow);
      const url = new URL(request.url);
      url.pathname = session ? "/api/auth/link-social" : "/api/auth/sign-in/social";
      // Every callback destination is server-selected. No arbitrary OAuth params.
      const response = await auth.handler(new Request(url, {
        method: "POST", headers: request.headers,
        body: JSON.stringify({ provider, scopes, callbackURL: `${new URL(env.APP_ORIGIN).origin}/?connected=${provider}`, errorCallbackURL: `${new URL(env.APP_ORIGIN).origin}/?auth_error=1`, disableRedirect: false }),
      }));
      return response;
    } catch (error) {
      const code = error instanceof Error ? error.message : "authorization_failed";
      const known = ["invalid_capability_selection", "unknown_capability", "capability_unavailable", "tenant_connection_forbidden"];
      return json({ error: known.includes(code) ? code : "authorization_failed" }, code === "tenant_connection_forbidden" ? 403 : 400);
    }
  }
  if (path === "/api/auth/get-session" && request.method === "GET") return json(await getSession(request, env));
  const allowed = (path === "/api/auth/sign-out" && request.method === "POST")
    || (/^\/api\/auth\/callback\/(google|microsoft)$/.test(path) && ["GET", "POST"].includes(request.method));
  if (!allowed) return json({ error: "not_found" }, 404);
  return createAuth(env).handler(request);
}
