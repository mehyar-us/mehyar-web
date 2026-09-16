import { z } from 'zod';
import type { Actor, Env, Tenant } from './env';
import { digest, HttpError } from './http';
import { OPERATORS, requireMembership, requireTenant } from './permissions';

export const createTenantInput = z.object({
  name: z.string().trim().min(2).max(100),
  website: z.string().trim().max(2048).default(''),
  goal: z.string().trim().max(2000).default(''),
}).strict();
export const memoryInput = z.object({ key: z.string().trim().min(1).max(120), value: z.string().trim().min(1).max(4000) }).strict();

export function normalizeWebsite(input: string) {
  if (!input) return '';
  let url: URL;
  try { url = new URL(input.includes('://') ? input : `https://${input}`); }
  catch { throw new HttpError(400, 'invalid_website', 'Enter a public business website.'); }
  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.port || host.endsWith('.') || !host.includes('.') || host.includes(':') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host)) {
    throw new HttpError(400, 'invalid_website', 'Enter a public business website with a standard web address.');
  }
  url.hash = '';
  return url.toString();
}

export function presentTenant(tenant: Tenant) {
  return { id: tenant.id, name: tenant.name, website: tenant.website, goal: tenant.goal,
    agentName: tenant.agent_name, status: tenant.status, planId: tenant.plan_id,
    trialExpiresAt: tenant.trial_expires_at, createdAt: tenant.created_at };
}

export async function listTenants(env: Env, userId: string) {
  const rows = await env.AGENT_DB.prepare(`SELECT t.* FROM agent_tenants t
    JOIN agent_memberships m ON m.tenant_id = t.id
    WHERE m.user_id = ? AND m.status = 'active' AND (m.expires_at IS NULL OR m.expires_at > ?)
    AND t.status != 'deleted' ORDER BY t.created_at`).bind(userId, new Date().toISOString()).all<Tenant>();
  return rows.results.map(presentTenant);
}

export async function createTenant(env: Env, userId: string, input: unknown, key: string) {
  const parsed = createTenantInput.parse(input);
  const data = { ...parsed, website: normalizeWebsite(parsed.website) };
  const hash = await digest(JSON.stringify(data));
  const tenantId = `biz_${(await digest(`${userId}:${key}`)).slice(0, 32)}`;
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 7 * 86400_000).toISOString();
  const prior = await env.AGENT_DB.prepare('SELECT request_hash FROM agent_provisioning WHERE user_id = ? AND request_key = ?').bind(userId, key).first<{request_hash:string}>();
  if (prior && prior.request_hash !== hash) throw new HttpError(409, 'request_key_reused', 'Use a new request key for a different business.');
  if (!prior) {
    const count = await env.AGENT_DB.prepare("SELECT COUNT(*) AS count FROM agent_tenants WHERE owner_id = ? AND status != 'deleted'").bind(userId).first<{count:number}>();
    if ((count?.count || 0) >= 5) throw new HttpError(429, 'workspace_limit', 'Contact support to add more businesses.');
    await env.AGENT_DB.batch([
      env.AGENT_DB.prepare(`INSERT OR IGNORE INTO agent_tenants
        (id,name,website,goal,agent_name,owner_id,status,plan_id,created_at,updated_at,trial_expires_at)
        SELECT ?,?,?,?,'Mayor',?,'trial','trial',?,?,?
        WHERE (SELECT COUNT(*) FROM agent_tenants WHERE owner_id = ? AND status != 'deleted') < 5`)
        .bind(tenantId, data.name, data.website, data.goal, userId, now, now, expires, userId),
      env.AGENT_DB.prepare("INSERT OR IGNORE INTO agent_memberships (tenant_id,user_id,role,created_at) SELECT ?,?,'owner',? WHERE EXISTS (SELECT 1 FROM agent_tenants WHERE id = ?)").bind(tenantId,userId,now,tenantId),
      env.AGENT_DB.prepare('INSERT OR IGNORE INTO agent_provisioning (user_id,request_key,tenant_id,request_hash,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM agent_tenants WHERE id = ?)').bind(userId,key,tenantId,hash,now,tenantId),
      env.AGENT_DB.prepare('INSERT OR IGNORE INTO agent_activity (id,tenant_id,actor_id,action,summary,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM agent_tenants WHERE id = ?)')
        .bind(`created_${tenantId}`,tenantId,userId,'workspace.created','Business workspace created. Connections and activation remain to be configured.',now,tenantId),
    ]);
  }
  const saved = await env.AGENT_DB.prepare('SELECT request_hash FROM agent_provisioning WHERE user_id = ? AND request_key = ?').bind(userId,key).first<{request_hash:string}>();
  if(!saved) throw new HttpError(429,'workspace_limit','Contact support to add more businesses.');
  if (saved?.request_hash !== hash) throw new HttpError(409, 'request_key_reused', 'This request key has already been used.');
  return requireTenant(env, {tenantId,userId});
}

export async function appendActivity(env: Pick<Env,'AGENT_DB'>, actor: Actor, action: string, summary: string) {
  await env.AGENT_DB.prepare('INSERT INTO agent_activity (id,tenant_id,actor_id,action,summary,created_at) VALUES (?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),actor.tenantId,actor.userId,action,summary,new Date().toISOString()).run();
}

export async function getMemory(env: Env, actor: Actor) {
  const result = await env.AGENT_DB.prepare('SELECT id,key,value,source,source_url AS sourceUrl,updated_at AS updatedAt FROM agent_memory WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 100')
    .bind(actor.tenantId).all();
  return result.results;
}

export async function addMemory(env: Env, actor: Actor, input: unknown) {
  await requireMembership(env, actor, OPERATORS);
  const { key, value } = memoryInput.parse(input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await env.AGENT_DB.prepare(`INSERT INTO agent_memory (id,tenant_id,key,value,source,created_by,created_at,updated_at)
    SELECT ?,?,?,?,'owner',?,?,? WHERE (SELECT COUNT(*) FROM agent_memory WHERE tenant_id = ?) < 100`)
    .bind(id,actor.tenantId,key,value,actor.userId,now,now,actor.tenantId).run();
  if (!result.meta.changes) throw new HttpError(409,'memory_limit','Edit or remove an existing business fact before adding another.');
  await appendActivity(env,actor,'memory.created','A business fact was added by an authorized team member.');
  return {id,key,value,source:'owner',updatedAt:now};
}

export async function deleteMemory(env: Env, actor: Actor, id: string) {
  await requireMembership(env,actor,OPERATORS);
  const result = await env.AGENT_DB.prepare('DELETE FROM agent_memory WHERE tenant_id = ? AND id = ?').bind(actor.tenantId,id).run();
  if (!result.meta.changes) throw new HttpError(404,'memory_not_found','This business fact is not available.');
  await appendActivity(env,actor,'memory.deleted','A business fact was removed.');
}
