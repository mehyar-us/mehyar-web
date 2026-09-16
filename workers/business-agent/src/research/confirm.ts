import type {Actor,Env} from '../env';
import type {SiteEvidence} from './extract';
import {requireMembership} from '../permissions';
import {HttpError} from '../http';

/** Only call with the immutable server-stored claim, never client-supplied evidence. */
export async function confirmResearch(env:Env,actor:Actor,jobId:string,index:number,key:string,claim:SiteEvidence){
  await requireMembership(env,actor,['owner']);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([actor.tenantId,jobId,claim.sourceUrl,index])));
  const id='research-'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const now=new Date().toISOString();
  // Receipt and memory are committed together. A retry after deletion never recreates memory.
  await env.AGENT_DB.batch([
    env.AGENT_DB.prepare(`INSERT OR IGNORE INTO agent_memory(id,tenant_id,key,value,source,source_url,created_by,created_at,updated_at)
      SELECT ?,?,?,?,'owner_confirmed_website',?,?,?,?
      WHERE EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id
        WHERE m.tenant_id=? AND m.user_id=? AND m.role='owner' AND m.status='active'
        AND (m.expires_at IS NULL OR m.expires_at>?) AND t.status!='deleted')
      AND NOT EXISTS(SELECT 1 FROM agent_research_confirmations WHERE tenant_id=? AND id=?)
      AND NOT EXISTS(SELECT 1 FROM agent_memory WHERE tenant_id=? AND lower(key)=lower(?))
      AND (SELECT COUNT(*) FROM agent_memory WHERE tenant_id=?)<100`)
      .bind(id,actor.tenantId,key,claim.value,claim.sourceUrl,actor.userId,now,now,actor.tenantId,actor.userId,now,actor.tenantId,id,actor.tenantId,key,actor.tenantId),
    env.AGENT_DB.prepare(`INSERT OR IGNORE INTO agent_research_confirmations
      (tenant_id,id,job_id,source_url,claim_index,memory_key,memory_value,evidence_json,confirmed_by,confirmed_at)
      SELECT tenant_id,id,?,?,?,?,?,?,created_by,created_at FROM agent_memory WHERE tenant_id=? AND id=?`)
      .bind(jobId,claim.sourceUrl,index,key,claim.value,JSON.stringify(claim),actor.tenantId,id),
    env.AGENT_DB.prepare(`INSERT OR IGNORE INTO agent_activity(id,tenant_id,actor_id,action,summary,created_at)
      SELECT id,tenant_id,confirmed_by,'research.confirmed','The owner confirmed a researched business fact.',confirmed_at
      FROM agent_research_confirmations WHERE tenant_id=? AND id=?`).bind(actor.tenantId,id),
  ]);
  await requireMembership(env,actor,['owner']);
  const receipt=await env.AGENT_DB.prepare('SELECT memory_key,memory_value FROM agent_research_confirmations WHERE tenant_id=? AND id=?')
    .bind(actor.tenantId,id).first<{memory_key:string;memory_value:string}>();
  if(!receipt)throw new HttpError(409,'research_memory_conflict','This topic already exists, the knowledge limit was reached, or your access changed. Review saved knowledge before confirming.');
  if(receipt.memory_key!==key||receipt.memory_value!==claim.value)throw new HttpError(409,'research_confirmation_conflict','This claim was already confirmed with a different topic.');
  const memory=await env.AGENT_DB.prepare('SELECT id,key,value,source,source_url AS sourceUrl FROM agent_memory WHERE tenant_id=? AND id=?').bind(actor.tenantId,id)
    .first<{id:string;key:string;value:string;source:string;sourceUrl:string}>();
  return {confirmed:true,memory,removed:memory===null};
}
