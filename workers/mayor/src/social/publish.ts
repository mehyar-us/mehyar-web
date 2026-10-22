import { z } from 'zod';
import type { Actor } from '../env';
import type { AuthEnv } from '../auth/capabilities';
import { HttpError } from '../http';
import { tSocial, type SocialLanguage } from './i18n';
import { socialMessage } from './messages';
import { socialTransport, type FetchImpl } from './transports';
import {
  getSocialConnection, insertPublishRecord, type SocialPublishStatus,
} from './store';
import { loadSocialTokens } from './health';

/**
 * THE publish gate. Defaults to false: while the Meta App Review for the
 * MehyarSoft app is pending (and until the owner explicitly enables posting),
 * publish calls NEVER reach a provider. They return a test-gated simulated
 * result and record it honestly as `test_simulated` — never as `sent`.
 *
 * Enable only with the owner's explicit word:
 *   SOCIAL_PUBLISH_ENABLED=true
 */
export function publishEnabled(env: AuthEnv): boolean {
  const raw = (env as unknown as { SOCIAL_PUBLISH_ENABLED?: string }).SOCIAL_PUBLISH_ENABLED;
  return (raw ?? '').trim().toLowerCase() === 'true';
}

export const publishInputSchema = z.object({
  caption: z.string().trim().min(1).max(2000),
  mediaUrl: z.string().url().max(2048).optional(),
  language: z.enum(['en', 'es']).optional(),
}).strict();

export interface PublishOutcome {
  simulated: boolean;
  record: {
    id: string;
    status: SocialPublishStatus;
    providerPostId: string | null;
    note: string;
    createdAt: string;
  };
}

/**
 * Publish a post through a connected social account.
 *
 * Gate closed (default): no provider call is made at all. A publish record is
 * written with status `test_simulated` and providerPostId null, and the caller
 * gets an explicit simulated result. The status is never `sent` unless a real
 * provider accepted the post.
 */
export async function publishSocialPost(
  env: AuthEnv,
  actor: Actor,
  connectionId: string,
  raw: unknown,
  transport: FetchImpl = fetch,
): Promise<PublishOutcome> {
  const input = publishInputSchema.parse(raw);
  const language: SocialLanguage = input.language ?? 'en';
  const row = await getSocialConnection(env, actor, connectionId);

  if (!publishEnabled(env)) {
    const note = tSocial(language, 'publish_test_gated');
    const record = await insertPublishRecord(env, actor, {
      connectionId: row.id, provider: row.provider,
      caption: input.caption, mediaUrl: input.mediaUrl,
      status: 'test_simulated', note,
    });
    return {
      simulated: true,
      record: { id: record.id, status: record.status, providerPostId: null, note, createdAt: record.created_at },
    };
  }

  const tokens = await loadSocialTokens(env, actor, row);
  try {
    const result = await socialTransport(row.provider).publish(
      tokens, { caption: input.caption, mediaUrl: input.mediaUrl }, transport,
    );
    const record = await insertPublishRecord(env, actor, {
      connectionId: row.id, provider: row.provider,
      caption: input.caption, mediaUrl: input.mediaUrl,
      status: 'sent', providerPostId: result.providerPostId,
      note: tSocial(language, 'publish_recorded'),
    });
    return {
      simulated: false,
      record: { id: record.id, status: record.status, providerPostId: result.providerPostId, note: record.note, createdAt: record.created_at },
    };
  } catch (error) {
    const code = error instanceof HttpError ? error.code : 'social_provider_rejected';
    const record = await insertPublishRecord(env, actor, {
      connectionId: row.id, provider: row.provider,
      caption: input.caption, mediaUrl: input.mediaUrl,
      status: 'failed', errorCode: code,
      note: tSocial(language, 'publish_recorded'),
    });
    throw new HttpError(502, code, `${socialMessage(code, language)} (${tSocial(language, 'publish_failed_title')})`);
  }
}
