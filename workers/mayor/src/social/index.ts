import { z } from 'zod';
import type { Actor } from '../env';
import type { AuthEnv } from '../auth/capabilities';
import { getSession } from '../auth';
import { OPERATORS, requireMembership } from '../permissions';
import { HttpError, json, readJson, requireOrigin } from '../http';
import { socialConnectCards, orderedSocialCards, isSocialProvider, socialProviderSchema, type SocialProvider } from './definitions';
import { socialLanguage, tSocial } from './i18n';
import { socialFailure, socialMessage, type SocialMessageCode } from './messages';
import { sealSocialSecret, openSocialSecret } from './custody';
import { socialTransport, type FetchImpl, type SocialTokens } from './transports';
import {
  listSocialConnections, getSocialConnection, upsertSocialConnection,
  disconnectSocialConnection, listPublishRecords, socialConnectionView, socialSecretId,
} from './store';
import { probeSocialConnection, readSocialProfile, readSocialPosts } from './health';
import { publishEnabled, publishSocialPost } from './publish';

export type { SocialProvider };
export { socialConnectCards, orderedSocialCards, publishEnabled };
export * from './definitions';
export * from './i18n';
export * from './messages';
export * from './custody';
export * from './transports';
export * from './store';
export * from './health';
export * from './publish';

/** Route handler the integrator wires into src/index.ts's businessRoute block:
 *   const social = registerSocialRoutes({});
 *   ...
 *   const socialResponse = await social(request, env, actor);
 *   if (socialResponse) return socialResponse;
 */
export type SocialRequestHandler = (
  request: Request, env: AuthEnv, authenticatedActor?: Actor, transport?: FetchImpl,
) => Promise<Response | null>;

export interface SocialRouteApp {
  routes?: Record<string, SocialRequestHandler>;
}

/** Registers the social-connector routes and returns the request handler.
 * The `app` registry is a plain object the integrator owns; the returned
 * handler is what actually serves `/api/businesses/:tenant/social/*`. */
export function registerSocialRoutes(app: SocialRouteApp = {}): SocialRequestHandler {
  app.routes = app.routes ?? {};
  app.routes['social'] = handleSocialRequest;
  return handleSocialRequest;
}

const OWNERS = ['owner'] as const;

const initiateSchema = z.object({
  provider: socialProviderSchema,
  language: z.enum(['en', 'es']).optional(),
}).strict();
const disconnectSchema = z.object({ revision: z.number().int().min(1) }).strict();
const publishSchema = z.object({
  caption: z.string().trim().min(1).max(2000),
  mediaUrl: z.string().url().max(2048).optional(),
  language: z.enum(['en', 'es']).optional(),
}).strict();

interface AppCredentials { clientId: string; clientSecret: string; }

function appCredentials(env: AuthEnv, provider: SocialProvider): AppCredentials {
  const e = env as unknown as Record<string, string | undefined>;
  const pair = provider === 'tiktok'
    ? [e.TIKTOK_CLIENT_KEY, e.TIKTOK_CLIENT_SECRET]
    : provider === 'x'
      ? [e.X_CLIENT_ID, e.X_CLIENT_SECRET]
      : [e.META_APP_ID, e.META_APP_SECRET];
  if (!pair[0] || !pair[1]) throw socialFailure('social_provider_not_configured', 503);
  return { clientId: pair[0], clientSecret: pair[1] };
}

function callbackUrl(env: AuthEnv, tenantId: string): string {
  return `${env.APP_ORIGIN}/api/businesses/${tenantId}/social/connect/callback`;
}

/** Outbound rate budget shared by all social reads/publishes (same shape as custom connectors). */
async function reserveSocial(env: AuthEnv, actor: Actor) {
  const now = Date.now(), subject = `social:${actor.tenantId}:${actor.userId}`;
  const results = await env.AGENT_DB.batch([
    env.AGENT_DB.prepare(`INSERT INTO mayor_rate_limits(subject,bucket,count) VALUES(?,?,1)
      ON CONFLICT(subject,bucket) DO UPDATE SET count=count+1 RETURNING count`).bind(subject + ':minute', Math.floor(now / 60000)),
    env.AGENT_DB.prepare(`INSERT INTO mayor_rate_limits(subject,bucket,count) VALUES(?,?,1)
      ON CONFLICT(subject,bucket) DO UPDATE SET count=count+1 RETURNING count`).bind(subject + ':day', Math.floor(now / 86400000)),
  ]);
  if (results.some((r, i) => Number((r.results[0] as { count: number } | undefined)?.count) > (i === 0 ? 12 : 100))) {
    throw socialFailure('social_rate_limited', 429);
  }
}

interface OAuthState { provider: SocialProvider; nonce: string; expiresAt: string; }

async function initiateSocialConnect(
  env: AuthEnv, actor: Actor, raw: unknown,
): Promise<unknown> {
  await requireMembership(env, actor, OWNERS);
  const input = initiateSchema.parse(raw);
  const creds = appCredentials(env, input.provider);
  const state: OAuthState = {
    provider: input.provider, nonce: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
  const sealed = await sealSocialSecret(env, actor, 'oauth', state);
  const authorizeUrl = socialTransport(input.provider).authorizeUrl({
    clientId: creds.clientId, redirectUri: callbackUrl(env, actor.tenantId), state: sealed, scopes: [],
  });
  return { authorizeUrl, provider: input.provider };
}

async function callbackSocialConnect(
  env: AuthEnv, actor: Actor, url: URL, transport: FetchImpl,
): Promise<unknown> {
  await requireMembership(env, actor, OWNERS);
  const error = url.searchParams.get('error');
  if (error) throw socialFailure('social_oauth_denied');
  const code = url.searchParams.get('code'), stateParam = url.searchParams.get('state');
  if (!code || !stateParam) throw socialFailure('social_oauth_state_invalid');
  let state: OAuthState;
  try {
    state = await openSocialSecret<OAuthState>(env, actor, 'oauth', stateParam);
  } catch {
    throw socialFailure('social_oauth_state_invalid');
  }
  if (!isSocialProvider(state.provider) || new Date(state.expiresAt).getTime() < Date.now()) {
    throw socialFailure('social_oauth_state_invalid');
  }
  const creds = appCredentials(env, state.provider);
  await reserveSocial(env, actor);
  const transportImpl = socialTransport(state.provider);
  let tokens: SocialTokens;
  try {
    tokens = await transportImpl.exchangeCode({
      code, redirectUri: callbackUrl(env, actor.tenantId),
      clientId: creds.clientId, clientSecret: creds.clientSecret,
    }, transport);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw socialFailure('social_token_exchange_failed', 502);
  }
  let label: string = state.provider;
  try {
    const profile = await transportImpl.profile(tokens, transport);
    if (profile.providerUserId) tokens.providerUserId = profile.providerUserId;
    label = `${state.provider} — ${profile.displayName ?? profile.username ?? profile.providerUserId}`;
  } catch {
    // Profile read is best-effort here; the token is still stored.
  }
  const sealed = await sealSocialSecret(env, actor, socialSecretId(state.provider), tokens);
  // Upsert by provider (one connection per provider per tenant+user).
  const row = await upsertSocialConnection(env, actor, state.provider, label, sealed);
  return { connection: socialConnectionView(row) };
}

/** Root may pass its authenticated Actor; otherwise this handler obtains the existing session. */
export async function handleSocialRequest(
  request: Request, env: AuthEnv, authenticatedActor?: Actor, transport: FetchImpl = fetch,
): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(/^\/api\/businesses\/([^/]+)\/social(?:\/(.*))?$/);
  if (!match) return null;
  const fail = (code: SocialMessageCode, status = 400) => socialFailure(code, status);
  try {
    const session = authenticatedActor ? null : await getSession(request, env);
    const actor = authenticatedActor ?? (session ? { tenantId: match[1], userId: session.user.id } : null);
    if (!actor) throw fail('social_authentication_required', 401);
    if (actor.tenantId !== match[1]) throw fail('social_connection_not_found', 404);
    const url = new URL(request.url);
    const language = socialLanguage(url.searchParams.get('language') ?? undefined);
    const action = match[2] ?? '';

    if (request.method === 'GET' && action === 'connectors') {
      await requireMembership(env, actor, OPERATORS);
      const vertical = url.searchParams.get('vertical');
      const connections = await listSocialConnections(env, actor);
      const byProvider = new Map(connections.map((c) => [c.provider, socialConnectionView(c)]));
      return json({
        title: tSocial(language, 'connectors_title'),
        subtitle: tSocial(language, 'connectors_subtitle'),
        publishGateOpen: publishEnabled(env),
        publishTestBadge: tSocial(language, 'publish_test_badge'),
        connectors: orderedSocialCards(vertical, language).map((card) => ({
          ...card, connection: byProvider.get(card.provider) ?? null,
        })),
      });
    }

    if (request.method === 'POST' && action === 'connect/initiate') {
      requireOrigin(request, env.APP_ORIGIN);
      return json(await initiateSocialConnect(env, actor, await readJson(request, 8192)));
    }

    if (request.method === 'GET' && action === 'connect/callback') {
      // OAuth provider redirect: GET with query params, no origin header to check.
      return json(await callbackSocialConnect(env, actor, url, transport));
    }

    const item = action.match(/^connections\/([a-f0-9-]{36})\/(profile|posts|check|disconnect|publish|publish-records)$/);
    if (!item) throw fail('social_route_not_found', 404);
    const [, id, sub] = item;

    if (request.method === 'GET' && sub === 'profile') {
      await requireMembership(env, actor, OPERATORS);
      await reserveSocial(env, actor);
      return json(await readSocialProfile(env, actor, id, transport));
    }
    if (request.method === 'GET' && sub === 'posts') {
      await requireMembership(env, actor, OPERATORS);
      await reserveSocial(env, actor);
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 10) || 10, 1), 25);
      return json(await readSocialPosts(env, actor, id, limit, transport));
    }
    if (request.method === 'GET' && sub === 'publish-records') {
      await requireMembership(env, actor, OPERATORS);
      return json({ records: await listPublishRecords(env, actor, id) });
    }
    if (request.method !== 'POST') throw fail('social_route_not_found', 404);
    requireOrigin(request, env.APP_ORIGIN);
    const input = await readJson(request, 16384);

    if (sub === 'check') {
      await requireMembership(env, actor, OPERATORS);
      z.object({}).strict().parse(input);
      await reserveSocial(env, actor);
      return json({ connection: await probeSocialConnection(env, actor, id, transport) });
    }
    if (sub === 'disconnect') {
      await requireMembership(env, actor, OWNERS);
      const data = disconnectSchema.parse(input);
      return json(await disconnectSocialConnection(env, actor, id, data.revision));
    }
    if (sub === 'publish') {
      await requireMembership(env, actor, OWNERS);
      const data = publishSchema.parse(input);
      await reserveSocial(env, actor);
      const outcome = await publishSocialPost(env, actor, id, data, transport);
      return json({ publish: outcome, gateOpen: publishEnabled(env) });
    }
    throw fail('social_route_not_found', 404);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code, message: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ error: 'social_provider_unknown', message: socialMessage('social_provider_unknown') }, 400);
    return json({ error: 'social_route_not_found', message: socialMessage('social_route_not_found') }, 400);
  }
}
