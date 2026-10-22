import type { Actor } from '../env';
import type { AuthEnv } from '../auth/capabilities';
import { socialFailure } from './messages';
import type { SocialProvider } from './definitions';

export type SocialConnectionStatus = 'pending' | 'connected' | 'error' | 'disconnected';

/** Stable secret id for the sealed OAuth tokens: bound to (tenant, user,
 * provider) via the custody AAD, so a reconnect upsert keeps working and
 * ciphertext can never move across providers, tenants, or users. */
export function socialSecretId(provider: SocialProvider): string {
  return `social:${provider}`;
}

export interface SocialConnectionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: SocialProvider;
  label: string;
  status: SocialConnectionStatus;
  ciphertext: string;
  has_secret: number;
  last_checked_at: string | null;
  last_check_status: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

/** Public view: never exposes ciphertext or tokens. `reconnectRequired` drives
 * the reconnect card in the frontend when the last health check failed. */
export function socialConnectionView(row: SocialConnectionRow) {  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    status: row.status,
    hasSecret: row.has_secret === 1,
    revision: row.revision,
    lastCheckedAt: row.last_checked_at,
    lastCheckStatus: row.last_check_status,
    reconnectRequired: row.status === 'error',
    publishAvailable: false, // always false while the publish gate is closed
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLS = `id,tenant_id,user_id,provider,label,status,ciphertext,has_secret,
  last_checked_at,last_check_status,revision,created_at,updated_at`;

export async function listSocialConnections(env: AuthEnv, actor: Actor): Promise<SocialConnectionRow[]> {
  const rows = await env.AGENT_DB.prepare(
    `SELECT ${SELECT_COLS} FROM mayor_social_connections WHERE tenant_id=? AND user_id=? ORDER BY provider ASC`,
  ).bind(actor.tenantId, actor.userId).all<SocialConnectionRow>();
  return rows.results ?? [];
}

export async function getSocialConnection(env: AuthEnv, actor: Actor, id: string): Promise<SocialConnectionRow> {
  const row = await env.AGENT_DB.prepare(
    `SELECT ${SELECT_COLS} FROM mayor_social_connections WHERE id=? AND tenant_id=? AND user_id=?`,
  ).bind(id, actor.tenantId, actor.userId).first<SocialConnectionRow>();
  if (!row) throw socialFailure('social_connection_not_found', 404);
  return row;
}

export async function findSocialConnection(env: AuthEnv, actor: Actor, provider: SocialProvider): Promise<SocialConnectionRow | null> {
  return env.AGENT_DB.prepare(
    `SELECT ${SELECT_COLS} FROM mayor_social_connections WHERE tenant_id=? AND user_id=? AND provider=?`,
  ).bind(actor.tenantId, actor.userId, provider).first<SocialConnectionRow>();
}

/** OAuth callback upsert: one connection per provider per tenant+user. */
export async function upsertSocialConnection(
  env: AuthEnv, actor: Actor, provider: SocialProvider, label: string, ciphertext: string,
): Promise<SocialConnectionRow> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.AGENT_DB.prepare(`INSERT INTO mayor_social_connections
    (id,tenant_id,user_id,provider,label,status,ciphertext,has_secret,revision,created_at,updated_at)
    VALUES(?,?,?,?,?,'connected',?,1,1,?,?)
    ON CONFLICT(tenant_id,user_id,provider) DO UPDATE SET
      label=excluded.label,status='connected',ciphertext=excluded.ciphertext,has_secret=1,
      revision=mayor_social_connections.revision+1,updated_at=excluded.updated_at`,
  ).bind(id, actor.tenantId, actor.userId, provider, label, ciphertext, now, now).run();
  const row = await findSocialConnection(env, actor, provider);
  if (!row) throw socialFailure('social_connection_not_found', 404);
  return row;
}

export async function disconnectSocialConnection(
  env: AuthEnv, actor: Actor, id: string, revision: number,
): Promise<{ id: string; status: 'disconnected' }> {
  const now = new Date().toISOString();
  const result = await env.AGENT_DB.prepare(`UPDATE mayor_social_connections
    SET status='disconnected',ciphertext='',has_secret=0,revision=revision+1,updated_at=?
    WHERE id=? AND tenant_id=? AND user_id=? AND revision=?`,
  ).bind(now, id, actor.tenantId, actor.userId, revision).run();
  if (result.meta.changes !== 1) throw socialFailure('social_connection_changed', 409);
  return { id, status: 'disconnected' };
}

export async function markSocialCheck(
  env: AuthEnv, actor: Actor, id: string, ok: boolean,
): Promise<SocialConnectionRow> {
  const now = new Date().toISOString();
  const status: SocialConnectionStatus = ok ? 'connected' : 'error';
  await env.AGENT_DB.prepare(`UPDATE mayor_social_connections
    SET status=?,last_checked_at=?,last_check_status=?,updated_at=?
    WHERE id=? AND tenant_id=? AND user_id=?`,
  ).bind(status, now, ok ? 'reachable' : 'unreachable', now, id, actor.tenantId, actor.userId).run();
  return getSocialConnection(env, actor, id);
}

/* ---------------- publish records: honest statuses only ---------------- */

export const SOCIAL_PUBLISH_STATUSES = ['draft', 'scheduled', 'sent', 'failed', 'test_simulated'] as const;
export type SocialPublishStatus = (typeof SOCIAL_PUBLISH_STATUSES)[number];

export interface SocialPublishRecord {
  id: string;
  connection_id: string;
  provider: SocialProvider;
  caption: string;
  media_url: string | null;
  status: SocialPublishStatus;
  provider_post_id: string | null;
  error_code: string | null;
  note: string;
  created_at: string;
}

export async function insertPublishRecord(
  env: AuthEnv, actor: Actor,
  input: {
    connectionId: string; provider: SocialProvider; caption: string; mediaUrl?: string;
    status: SocialPublishStatus; providerPostId?: string; errorCode?: string; note: string;
  },
): Promise<SocialPublishRecord> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.AGENT_DB.prepare(`INSERT INTO mayor_social_publish_records
    (id,tenant_id,user_id,connection_id,provider,caption,media_url,status,provider_post_id,error_code,note,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(id, actor.tenantId, actor.userId, input.connectionId, input.provider,
    input.caption.slice(0, 2000), input.mediaUrl ?? null, input.status,
    input.providerPostId ?? null, input.errorCode ?? null, input.note.slice(0, 500), now).run();
  const row = await env.AGENT_DB.prepare(`SELECT id,connection_id,provider,caption,media_url,status,
    provider_post_id,error_code,note,created_at FROM mayor_social_publish_records WHERE id=? AND tenant_id=? AND user_id=?`,
  ).bind(id, actor.tenantId, actor.userId).first<SocialPublishRecord>();
  if (!row) throw socialFailure('social_connection_not_found', 404);
  return row;
}

export async function listPublishRecords(
  env: AuthEnv, actor: Actor, connectionId: string, limit = 20,
): Promise<SocialPublishRecord[]> {
  await getSocialConnection(env, actor, connectionId);
  const rows = await env.AGENT_DB.prepare(`SELECT id,connection_id,provider,caption,media_url,status,
    provider_post_id,error_code,note,created_at FROM mayor_social_publish_records
    WHERE connection_id=? AND tenant_id=? AND user_id=? ORDER BY created_at DESC LIMIT ?`,
  ).bind(connectionId, actor.tenantId, actor.userId, Math.min(Math.max(limit, 1), 50)).all<SocialPublishRecord>();
  return rows.results ?? [];
}
