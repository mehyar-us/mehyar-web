import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError} from './http';
import {requireMembership,requireTenant} from './permissions';
type Receipt={actor_id:string;member_id:string;expected_revision:number};
export async function revokeMember(env:Env,actor:Actor,userId:string,expectedRevision:number,key:string){
  await requireTenant(env,actor);await requireMembership(env,actor,['owner']);
  z.object({userId:z.string().min(1).max(128),expectedRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER-1),key:z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/)}).parse({userId,expectedRevision,key});
  if(userId===actor.userId)throw new HttpError(409,'owner_protected','Ownership changes require a separate transfer process.');
  const read=()=>env.AGENT_DB.prepare('SELECT actor_id,member_id,expected_revision FROM agent_member_removals WHERE tenant_id=? AND request_key=?').bind(actor.tenantId,key).first<Receipt>();
  const present=(receipt:Receipt)=>{
    if(receipt.actor_id!==actor.userId||receipt.member_id!==userId||receipt.expected_revision!==expectedRevision)throw new HttpError(409,'request_key_conflict','This request belongs to another member removal.');
    return {recorded:true,revision:receipt.expected_revision+1};
  };
  const prior=await read();if(prior)return present(prior);
  const now=new Date().toISOString(),operation=crypto.randomUUID();
  await env.AGENT_DB.batch([
    env.AGENT_DB.prepare(`INSERT OR IGNORE INTO agent_member_removals(tenant_id,request_key,actor_id,member_id,expected_revision,operation_id,created_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM agent_memberships WHERE tenant_id=? AND user_id=? AND revision=? AND role!='owner' AND status='active')
      AND EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.role='owner' AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>?) AND t.status NOT IN ('deleted','offboarding'))`)
      .bind(actor.tenantId,key,actor.userId,userId,expectedRevision,operation,now,actor.tenantId,userId,expectedRevision,actor.tenantId,actor.userId,now),
    env.AGENT_DB.prepare(`UPDATE agent_memberships SET status='revoked',revoked_by=?,revoked_at=?,revision=revision+1 WHERE tenant_id=? AND user_id=? AND EXISTS(SELECT 1 FROM agent_member_removals WHERE tenant_id=? AND operation_id=?)`)
      .bind(actor.userId,now,actor.tenantId,userId,actor.tenantId,operation),
    env.AGENT_DB.prepare(`INSERT INTO agent_activity(id,tenant_id,actor_id,action,summary,created_at) SELECT ?,?,?,'team.member.removed','The owner removed a team member from this business.',? WHERE EXISTS(SELECT 1 FROM agent_member_removals WHERE tenant_id=? AND operation_id=?)`)
      .bind(operation,actor.tenantId,actor.userId,now,actor.tenantId,operation),
  ]);
  await requireTenant(env,actor);await requireMembership(env,actor,['owner']);
  const saved=await read();if(saved)return present(saved);
  throw new HttpError(409,'membership_changed','This membership changed or is unavailable. Refresh the team list before reviewing removal.');
}
