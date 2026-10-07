import type { Actor, Env, Role, Tenant } from './env';
import { HttpError } from './http';

export interface Membership { tenant_id: string; user_id: string; role: Role; status: string; expires_at: string | null; }

export async function requireMembership(env: Pick<Env, 'AGENT_DB'>, actor: Actor, roles?: readonly Role[]) {
  const membership = await env.AGENT_DB.prepare(`SELECT m.* FROM agent_memberships m
    JOIN agent_tenants t ON t.id=m.tenant_id AND t.status='active'
    WHERE m.tenant_id = ? AND m.user_id = ? AND m.status = 'active'
    AND (m.expires_at IS NULL OR m.expires_at > ?)`).bind(actor.tenantId, actor.userId, new Date().toISOString()).first<Membership>();
  if (!membership) throw new HttpError(404, 'workspace_not_found', 'This workspace is not available.');
  if (roles && !roles.includes(membership.role)) throw new HttpError(403, 'permission_denied', 'Your role cannot perform this action.');
  return membership;
}

export async function requireTenant(env: Pick<Env, 'AGENT_DB'>, actor: Actor): Promise<Tenant> {
  await requireMembership(env, actor);
  const tenant = await env.AGENT_DB.prepare("SELECT * FROM agent_tenants WHERE id = ? AND status = 'active'").bind(actor.tenantId).first<Tenant>();
  if (!tenant) throw new HttpError(404, 'workspace_not_found', 'This workspace is not available.');
  return tenant;
}

export const OPERATORS: readonly Role[] = ['owner', 'manager'];
export const CHAT_ROLES: readonly Role[] = ['owner', 'manager', 'staff'];
export const KNOWLEDGE_ROLES: readonly Role[] = ['owner', 'manager', 'staff', 'viewer'];
export const BILLING_ROLES: readonly Role[] = ['owner', 'billing'];
