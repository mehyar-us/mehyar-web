import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError} from './http';
import {requireMembership,requireTenant} from './permissions';

const input=z.object({agentName:z.string().trim().min(1).max(60).regex(/^[^\p{Cc}\p{Cf}]+$/u),expectedName:z.string().min(1).max(60)}).strict();
type Receipt={actor_id:string;expected_name:string;agent_name:string};
export async function renameAgent(env:Env,actor:Actor,value:unknown,key:string){
  await requireTenant(env,actor);await requireMembership(env,actor,['owner']);
  const parsed=input.safeParse(value);
  if(!parsed.success||!/^[a-zA-Z0-9_-]{16,128}$/.test(key))throw new HttpError(400,'invalid_agent_name','Enter an agent name of 1–60 characters without control characters.');
  const {agentName,expectedName}=parsed.data;
  const read=()=>env.AGENT_DB.prepare('SELECT actor_id,expected_name,agent_name FROM agent_name_changes WHERE tenant_id=? AND request_key=?').bind(actor.tenantId,key).first<Receipt>();
  const present=(receipt:Receipt)=>{
    if(receipt.actor_id!==actor.userId||receipt.expected_name!==expectedName||receipt.agent_name!==agentName)throw new HttpError(409,'request_key_reused','This request belongs to a different name change.');
    return {agentName:receipt.agent_name};
  };
  const prior=await read();if(prior)return present(prior);
  const operation=crypto.randomUUID(),now=new Date().toISOString();
  // The conditional receipt, mutation and audit event commit in one D1 batch.
  // Only this attempt's operation ID may perform an update; replay cannot undo a later rename.
  await env.AGENT_DB.batch([
    env.AGENT_DB.prepare(`INSERT OR IGNORE INTO agent_name_changes(tenant_id,request_key,actor_id,expected_name,agent_name,operation_id,created_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM agent_tenants WHERE id=? AND status!='deleted' AND agent_name=?)
      AND EXISTS (SELECT 1 FROM agent_memberships WHERE tenant_id=? AND user_id=? AND role='owner' AND status='active' AND (expires_at IS NULL OR expires_at>?))`)
      .bind(actor.tenantId,key,actor.userId,expectedName,agentName,operation,now,actor.tenantId,expectedName,actor.tenantId,actor.userId,now),
    env.AGENT_DB.prepare(`UPDATE agent_tenants SET agent_name=?,updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM agent_name_changes WHERE tenant_id=? AND operation_id=?)`)
      .bind(agentName,now,actor.tenantId,actor.tenantId,operation),
    env.AGENT_DB.prepare(`INSERT INTO agent_activity(id,tenant_id,actor_id,action,summary,created_at)
      SELECT ?,?,?,'agent.renamed','The owner changed the assistant display name.',? WHERE EXISTS (SELECT 1 FROM agent_name_changes WHERE tenant_id=? AND operation_id=?)`)
      .bind(operation,actor.tenantId,actor.userId,now,actor.tenantId,operation),
  ]);
  await requireMembership(env,actor,['owner']);
  const saved=await read();if(saved)return present(saved);
  throw new HttpError(409,'agent_name_changed','The assistant name changed. Reload it before saving.');
}
