import type { Actor } from '../env';
import type { AuthEnv } from '../auth/capabilities';
import { HttpError } from '../http';
import { socialMessage } from './messages';
import { sealSocialSecret, openSocialSecret } from './custody';
import { socialTransport, safeSocialResult, type FetchImpl, type SocialTokens } from './transports';
import {
  getSocialConnection, markSocialCheck, upsertSocialConnection, socialConnectionView, socialSecretId, type SocialConnectionRow,
} from './store';

/** Loads and decrypts the stored OAuth tokens for a connected account. */
export async function loadSocialTokens(
  env: AuthEnv, actor: Actor, row: SocialConnectionRow,
): Promise<SocialTokens> {
  if (row.status !== 'connected' || !row.ciphertext || row.has_secret !== 1) {
    throw new HttpError(409, 'social_connection_not_found', socialMessage('social_connection_not_found'));
  }
  return openSocialSecret<SocialTokens>(env, actor, socialSecretId(row.provider), row.ciphertext);
}

/** Read-only probe used by health checks: profile read only, never a publish.
 * A failed check flips the connection to `error`, which drives the
 * reconnect card in the frontend (`reconnectRequired: true`). */
export async function probeSocialConnection(
  env: AuthEnv, actor: Actor, id: string, transport: FetchImpl = fetch,
): Promise<ReturnType<typeof socialConnectionView>> {
  const row = await getSocialConnection(env, actor, id);
  try {
    const tokens = await loadSocialTokens(env, actor, row);
    await socialTransport(row.provider).profile(tokens, transport);
    return socialConnectionView(await markSocialCheck(env, actor, id, true));
  } catch {
    return socialConnectionView(await markSocialCheck(env, actor, id, false));
  }
}

export async function readSocialProfile(
  env: AuthEnv, actor: Actor, id: string, transport: FetchImpl = fetch,
): Promise<unknown> {
  const row = await getSocialConnection(env, actor, id);
  const tokens = await loadSocialTokens(env, actor, row);
  try {
    return { profile: safeSocialResult(await socialTransport(row.provider).profile(tokens, transport), tokens), untrusted: true };
  } catch {
    throw new HttpError(502, 'social_profile_unavailable', socialMessage('social_profile_unavailable'));
  }
}

export async function readSocialPosts(
  env: AuthEnv, actor: Actor, id: string, limit: number, transport: FetchImpl = fetch,
): Promise<unknown> {
  const row = await getSocialConnection(env, actor, id);
  const tokens = await loadSocialTokens(env, actor, row);
  try {
    return { posts: safeSocialResult(await socialTransport(row.provider).recentPosts(tokens, limit, transport), tokens), untrusted: true };
  } catch {
    throw new HttpError(502, 'social_posts_unavailable', socialMessage('social_posts_unavailable'));
  }
}

/** Seals tokens after a successful OAuth exchange. Used by the callback route. */
export async function storeSocialTokens(
  env: AuthEnv, actor: Actor, connectionId: string, tokens: SocialTokens,
): Promise<void> {
  const row = await getSocialConnection(env, actor, connectionId);
  const sealed = await sealSocialSecret(env, actor, socialSecretId(row.provider), tokens);
  await upsertSocialConnection(env, actor, row.provider, row.label, sealed);
}
