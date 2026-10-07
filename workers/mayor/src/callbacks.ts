import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError} from './http';
import {requirePhoneCall} from './phone-call-access';
import {OPERATORS,requireMembership} from './permissions';

export const callbackReason=z.enum(['scheduling','human_assistance']);
export type CallbackReason=z.infer<typeof callbackReason>;
const unavailable=()=>new HttpError(409,'callback_unavailable','The callback request could not be verified.');

// Caller ID is a return contact only, never proof of customer identity.
// This pilot accepts only a designated caller admitted by its provider handler.
export async function requestCallback(env:Env,callId:string,reason:CallbackReason){
 reason=callbackReason.parse(reason);
 if(env.PHONE_TEST_ENABLED!=='true')throw unavailable();
 await requirePhoneCall(env,callId);
 const now=new Date().toISOString();
 const id=crypto.randomUUID();
 await env.AGENT_DB.prepare(`INSERT OR IGNORE INTO mayor_callbacks(id,tenant_id,call_id,number,reason,created_at)
 SELECT ?,c.tenant_id,c.id,c.caller_number,?,? FROM mayor_phone_calls c
 JOIN agent_tenants t ON t.id=c.tenant_id AND t.status='active'
 JOIN mayor_phone_connections p ON p.tenant_id=c.tenant_id AND p.provider=c.provider
   AND p.status='authorized' AND p.revision=c.connection_revision AND p.selected_number IS NOT NULL
 JOIN agent_memberships m ON m.tenant_id=p.tenant_id AND m.user_id=p.owner_user_id
   AND m.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?)
 WHERE c.id=? AND c.state='streaming' AND c.expires_at>? AND c.caller_number IS NOT NULL`)
 .bind(id,reason,now,now,callId,now).run();
 // Return a receipt only while the original call and connection remain valid.
 const result=await env.AGENT_DB.prepare(`SELECT b.id,b.status FROM mayor_callbacks b
 JOIN mayor_phone_calls c ON c.id=b.call_id
 JOIN agent_tenants t ON t.id=c.tenant_id AND t.status='active'
 JOIN mayor_phone_connections p ON p.tenant_id=c.tenant_id AND p.provider=c.provider
   AND p.status='authorized' AND p.revision=c.connection_revision
 JOIN agent_memberships m ON m.tenant_id=p.tenant_id AND m.user_id=p.owner_user_id
   AND m.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?)
 WHERE c.id=? AND c.state='streaming' AND c.expires_at>?`).bind(now,callId,now).first<{id:string;status:string}>();
 if(!result)throw unavailable();
 await requirePhoneCall(env,callId);
 return result;
}

export async function listCallbacks(env:Env,actor:Actor){
 await requireMembership(env,actor,OPERATORS);
 const result=await env.AGENT_DB.prepare(`SELECT id,number,reason,created_at AS createdAt FROM mayor_callbacks
 WHERE tenant_id=? AND status='pending' ORDER BY created_at,id LIMIT 51`).bind(actor.tenantId).all();
 return {callbacks:result.results.slice(0,50),hasMore:result.results.length>50,identityVerified:false};
}

export async function handleCallback(env:Env,actor:Actor,id:string){
 await requireMembership(env,actor,OPERATORS);
 const now=new Date().toISOString();
 const updated=await env.AGENT_DB.prepare(`UPDATE mayor_callbacks SET status='handled',handled_at=?,handled_by=?
 WHERE id=? AND tenant_id=? AND status='pending'
 AND EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status='active'
 AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?))
 RETURNING id,status`).bind(now,actor.userId,id,actor.tenantId,actor.tenantId,actor.userId,now).first();
 if(!updated)throw unavailable();
 return updated;
}
