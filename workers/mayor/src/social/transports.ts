import { z } from 'zod';
import { safeConnectorResult } from '../custom-connectors';
import { socialFailure } from './messages';
import type { SocialProvider } from './definitions';

/** Every provider client takes an injected fetch. Production passes the global
 * fetch; tests pass a mock. No real Meta/TikTok/X call ever happens in tests. */
export type FetchImpl = typeof fetch;

export interface SocialTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  providerUserId?: string;
  scopes?: string[];
}

export interface SocialProfile {
  providerUserId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface SocialPost {
  id: string;
  caption?: string;
  mediaType?: string;
  permalink?: string;
  postedAt?: string;
}

export interface SocialPublishResult {
  providerPostId: string;
  permalink?: string;
}

export interface CodeExchange {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}

export interface SocialTransport {
  provider: SocialProvider;
  /** OAuth authorization URL for the connect flow. */
  authorizeUrl(input: { clientId: string; redirectUri: string; state: string; scopes: string[] }): string;
  exchangeCode(input: CodeExchange, transport?: FetchImpl): Promise<SocialTokens>;
  profile(tokens: SocialTokens, transport?: FetchImpl): Promise<SocialProfile>;
  recentPosts(tokens: SocialTokens, limit: number, transport?: FetchImpl): Promise<SocialPost[]>;
  /** Real publish implementation. Only reachable when the publish gate is open;
   * see publish.ts — this is never called while test-gated. */
  publish(tokens: SocialTokens, input: { caption: string; mediaUrl?: string }, transport?: FetchImpl): Promise<SocialPublishResult>;
}

const jsonBody = z.unknown();

async function readJsonResponse(response: Response, what: 'profile' | 'posts' | 'exchange' | 'publish'): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (!response.ok) throw socialFailure(what === 'exchange' ? 'social_token_exchange_failed' : 'social_provider_rejected', 502);
  try { return jsonBody.parse(JSON.parse(text)); } catch { throw socialFailure('social_provider_rejected', 502); }
}

function authHeaders(tokens: SocialTokens, extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${tokens.accessToken}`, ...extra };
}

/* ---------------- Meta (Instagram + Facebook via the Graph API) ---------------- */

const GRAPH = 'https://graph.facebook.com/v21.0';
const META_SCOPES = ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'instagram_content_publish', 'pages_manage_posts'];

function metaAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string; scopes: string[] }) {
  const url = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('scope', input.scopes.join(','));
  url.searchParams.set('response_type', 'code');
  return url.href;
}

async function metaExchangeCode(input: CodeExchange, transport: FetchImpl): Promise<SocialTokens> {
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('client_secret', input.clientSecret);
  url.searchParams.set('code', input.code);
  const data = z.object({ access_token: z.string(), expires_in: z.number().optional() })
    .parse(await readJsonResponse(await transport(url.href), 'exchange'));
  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined,
    scopes: [...META_SCOPES],
  };
}

/** First page on the account — the publishable target for Facebook. */
async function metaFirstPage(tokens: SocialTokens, transport: FetchImpl) {
  const url = new URL(`${GRAPH}/me/accounts`);
  url.searchParams.set('fields', 'id,name,access_token');
  url.searchParams.set('limit', '25');
  const data = z.object({ data: z.array(z.object({ id: z.string(), name: z.string(), access_token: z.string().optional() })) })
    .parse(await readJsonResponse(await transport(url.href, { headers: authHeaders(tokens) }), 'profile'));
  return data.data[0];
}

/** Instagram business/creator account linked through a Page. */
async function metaInstagramAccount(tokens: SocialTokens, transport: FetchImpl) {
  const url = new URL(`${GRAPH}/me/accounts`);
  url.searchParams.set('fields', 'instagram_business_account{id,username}');
  url.searchParams.set('limit', '25');
  const data = z.object({ data: z.array(z.object({ instagram_business_account: z.object({ id: z.string(), username: z.string().optional() }).optional() })) })
    .parse(await readJsonResponse(await transport(url.href, { headers: authHeaders(tokens) }), 'profile'));
  const found = data.data.map((p) => p.instagram_business_account).find(Boolean);
  return found;
}

function metaTransport(provider: SocialProvider): SocialTransport {
  return {
    provider,
    authorizeUrl: (input) => metaAuthorizeUrl({ ...input, scopes: META_SCOPES }),
    exchangeCode: (input, transport = fetch) => metaExchangeCode(input, transport),
    profile: async (tokens, transport = fetch) => {
      if (provider === 'instagram') {
        const ig = await metaInstagramAccount(tokens, transport).catch(() => undefined);
        if (!ig) throw socialFailure('social_targets_not_found', 409);
        return { providerUserId: ig.id, username: ig.username };
      }
      const url = new URL(`${GRAPH}/me`);
      url.searchParams.set('fields', 'id,name,picture{url}');
      const data = z.object({ id: z.string(), name: z.string().optional(), picture: z.object({ data: z.object({ url: z.string().optional() }).optional() }).optional() })
        .parse(await readJsonResponse(await transport(url.href, { headers: authHeaders(tokens) }), 'profile'));
      return { providerUserId: data.id, displayName: data.name, avatarUrl: data.picture?.data?.url };
    },
    recentPosts: async (tokens, limit, transport = fetch) => {
      if (provider === 'instagram') {
        const ig = await metaInstagramAccount(tokens, transport).catch(() => undefined);
        if (!ig) throw socialFailure('social_targets_not_found', 409);
        const url = new URL(`${GRAPH}/${ig.id}/media`);
        url.searchParams.set('fields', 'id,caption,media_type,permalink,timestamp');
        url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 25)));
        const data = z.object({ data: z.array(z.object({ id: z.string(), caption: z.string().optional(), media_type: z.string().optional(), permalink: z.string().optional(), timestamp: z.string().optional() })) })
          .parse(await readJsonResponse(await transport(url.href, { headers: authHeaders(tokens) }), 'posts'));
        return data.data.map((m) => ({ id: m.id, caption: m.caption, mediaType: m.media_type, permalink: m.permalink, postedAt: m.timestamp }));
      }
      const page = await metaFirstPage(tokens, transport);
      if (!page) throw socialFailure('social_targets_not_found', 409);
      const url = new URL(`${GRAPH}/${page.id}/posts`);
      url.searchParams.set('fields', 'id,message,permalink_url,created_time');
      url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 25)));
      const data = z.object({ data: z.array(z.object({ id: z.string(), message: z.string().optional(), permalink_url: z.string().optional(), created_time: z.string().optional() })) })
        .parse(await readJsonResponse(await transport(url.href, { headers: authHeaders(tokens, { }) }), 'posts'));
      return data.data.map((p) => ({ id: p.id, caption: p.message, permalink: p.permalink_url, postedAt: p.created_time }));
    },
    publish: async (tokens, input, transport = fetch) => {
      if (provider === 'instagram') {
        if (!input.mediaUrl) throw socialFailure('social_publish_unsupported');
        const ig = await metaInstagramAccount(tokens, transport).catch(() => undefined);
        if (!ig) throw socialFailure('social_targets_not_found', 409);
        const container = z.object({ id: z.string() }).parse(await readJsonResponse(
          await transport(`${GRAPH}/${ig.id}/media`, {
            method: 'POST', headers: { ...authHeaders(tokens), 'content-type': 'application/json' },
            body: JSON.stringify({ image_url: input.mediaUrl, caption: input.caption }),
          }), 'publish'));
        const published = z.object({ id: z.string() }).parse(await readJsonResponse(
          await transport(`${GRAPH}/${ig.id}/media_publish`, {
            method: 'POST', headers: { ...authHeaders(tokens), 'content-type': 'application/json' },
            body: JSON.stringify({ creation_id: container.id }),
          }), 'publish'));
        return { providerPostId: published.id };
      }
      const page = await metaFirstPage(tokens, transport);
      if (!page) throw socialFailure('social_targets_not_found', 409);
      const published = z.object({ id: z.string(), post_id: z.string().optional() }).parse(await readJsonResponse(
        await transport(`${GRAPH}/${page.id}/feed`, {
          method: 'POST', headers: { ...authHeaders(tokens), 'content-type': 'application/json' },
          body: JSON.stringify({ message: input.caption, ...(input.mediaUrl ? { link: input.mediaUrl } : {}) }),
        }), 'publish'));
      return { providerPostId: published.post_id ?? published.id };
    },
  };
}

/* ---------------- TikTok ---------------- */

const TIKTOK_OPEN = 'https://open.tiktokapis.com/v2';
const TIKTOK_SCOPES = ['user.info.basic', 'video.list'];

function tiktokTransport(): SocialTransport {
  return {
    provider: 'tiktok',
    authorizeUrl: (input) => {
      const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
      url.searchParams.set('client_key', input.clientId);
      url.searchParams.set('redirect_uri', input.redirectUri);
      url.searchParams.set('state', input.state);
      url.searchParams.set('scope', input.scopes.join(','));
      url.searchParams.set('response_type', 'code');
      return url.href;
    },
    exchangeCode: async (input, transport = fetch) => {
      const data = z.object({ access_token: z.string(), refresh_token: z.string().optional(), expires_in: z.number().optional(), open_id: z.string().optional(), scope: z.string().optional() })
        .parse(await readJsonResponse(await transport(`${TIKTOK_OPEN}/oauth/token/`, {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_key: input.clientId, client_secret: input.clientSecret, code: input.code, grant_type: 'authorization_code', redirect_uri: input.redirectUri }),
        }), 'exchange'));
      return {
        accessToken: data.access_token, refreshToken: data.refresh_token,
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined,
        providerUserId: data.open_id, scopes: data.scope ? data.scope.split(',') : [...TIKTOK_SCOPES],
      };
    },
    profile: async (tokens, transport = fetch) => {
      const url = new URL(`${TIKTOK_OPEN}/user/info/`);
      url.searchParams.set('fields', 'open_id,union_id,avatar_url,display_name');
      const data = z.object({ data: z.object({ user: z.object({ open_id: z.string(), display_name: z.string().optional(), avatar_url: z.string().optional() }) }) })
        .parse(await readJsonResponse(await transport(url.href, { headers: authHeaders(tokens) }), 'profile'));
      return { providerUserId: data.data.user.open_id, displayName: data.data.user.display_name, avatarUrl: data.data.user.avatar_url };
    },
    recentPosts: async (tokens, limit, transport = fetch) => {
      const url = new URL(`${TIKTOK_OPEN}/video/list/`);
      url.searchParams.set('fields', 'id,create_time,cover_image_url,share_url,title');
      const data = z.object({ data: z.object({ videos: z.array(z.object({ id: z.string(), create_time: z.number().optional(), share_url: z.string().optional(), title: z.string().optional() })).optional() }) })
        .parse(await readJsonResponse(await transport(url.href, {
          method: 'POST', headers: { ...authHeaders(tokens), 'content-type': 'application/json' },
          body: JSON.stringify({ max_count: Math.min(Math.max(limit, 1), 20) }),
        }), 'posts'));
      return (data.data.videos ?? []).map((v) => ({
        id: v.id, caption: v.title, mediaType: 'video', permalink: v.share_url,
        postedAt: v.create_time ? new Date(v.create_time * 1000).toISOString() : undefined,
      }));
    },
    publish: async (tokens, input, transport = fetch) => {
      if (!input.mediaUrl) throw socialFailure('social_publish_unsupported');
      const data = z.object({ data: z.object({ publish_id: z.string() }) })
        .parse(await readJsonResponse(await transport(`${TIKTOK_OPEN}/post/publish/video/init/`, {
          method: 'POST', headers: { ...authHeaders(tokens), 'content-type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({
            post_info: { title: input.caption.slice(0, 2200), privacy_level: 'SELF_ONLY' },
            source_info: { source: 'PULL_FROM_URL', video_url: input.mediaUrl },
          }),
        }), 'publish'));
      return { providerPostId: data.data.publish_id };
    },
  };
}

/* ---------------- X ---------------- */

const X_API = 'https://api.x.com/2';
const X_SCOPES = ['tweet.read', 'users.read', 'tweet.write', 'offline.access'];

function xTransport(): SocialTransport {
  const getProfile = async (tokens: SocialTokens, transport: FetchImpl): Promise<SocialProfile> => {
    const url = new URL(`${X_API}/users/me`);
    url.searchParams.set('user.fields', 'username,name,profile_image_url');
    const data = z.object({ data: z.object({ id: z.string(), username: z.string().optional(), name: z.string().optional(), profile_image_url: z.string().optional() }) })
      .parse(await readJsonResponse(await transport(url.href, { headers: authHeaders(tokens) }), 'profile'));
    return { providerUserId: data.data.id, username: data.data.username, displayName: data.data.name, avatarUrl: data.data.profile_image_url };
  };
  return {
    provider: 'x',
    authorizeUrl: (input) => {
      const url = new URL('https://x.com/i/oauth2/authorize');
      url.searchParams.set('client_id', input.clientId);
      url.searchParams.set('redirect_uri', input.redirectUri);
      url.searchParams.set('state', input.state);
      url.searchParams.set('scope', input.scopes.join(' '));
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('code_challenge', 'mayor-social-pkce-placeholder');
      url.searchParams.set('code_challenge_method', 'plain');
      return url.href;
    },
    exchangeCode: async (input, transport = fetch) => {
      const data = z.object({ access_token: z.string(), refresh_token: z.string().optional(), expires_in: z.number().optional(), scope: z.string().optional() })
        .parse(await readJsonResponse(await transport(`${X_API}/oauth2/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${btoa(`${input.clientId}:${input.clientSecret}`)}` },
          body: new URLSearchParams({ code: input.code, grant_type: 'authorization_code', redirect_uri: input.redirectUri, code_verifier: 'mayor-social-pkce-placeholder' }),
        }), 'exchange'));
      return {
        accessToken: data.access_token, refreshToken: data.refresh_token,
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined,
        scopes: data.scope ? data.scope.split(' ') : [...X_SCOPES],
      };
    },
    profile: (tokens, transport = fetch) => getProfile(tokens, transport),
    recentPosts: async (tokens, limit, transport = fetch) => {
      const me = await getProfile(tokens, transport);
      const url = new URL(`${X_API}/users/${me.providerUserId}/tweets`);
      url.searchParams.set('max_results', String(Math.min(Math.max(limit, 5), 100)));
      url.searchParams.set('tweet.fields', 'created_at,text');
      url.searchParams.set('exclude', 'retweets,replies');
      const data = z.object({ data: z.array(z.object({ id: z.string(), text: z.string().optional(), created_at: z.string().optional() })).optional() })
        .parse(await readJsonResponse(await transport(url.href, { headers: authHeaders(tokens) }), 'posts'));
      return (data.data ?? []).map((tw) => ({ id: tw.id, caption: tw.text, mediaType: 'text', postedAt: tw.created_at }));
    },
    publish: async (tokens, input, transport = fetch) => {
      const data = z.object({ data: z.object({ id: z.string(), text: z.string().optional() }) })
        .parse(await readJsonResponse(await transport(`${X_API}/tweets`, {
          method: 'POST', headers: { ...authHeaders(tokens), 'content-type': 'application/json' },
          body: JSON.stringify({ text: input.caption.slice(0, 280) }),
        }), 'publish'));
      return { providerPostId: data.data.id };
    },
  };
}

export function socialTransport(provider: SocialProvider): SocialTransport {
  switch (provider) {
    case 'instagram': return metaTransport('instagram');
    case 'facebook': return metaTransport('facebook');
    case 'tiktok': return tiktokTransport();
    case 'x': return xTransport();
  }
}

/** Redact provider payloads before they reach logs or the assistant boundary. */
export function safeSocialResult(value: unknown, tokens?: SocialTokens): unknown {
  return safeConnectorResult(value, tokens?.accessToken ?? tokens?.refreshToken);
}
