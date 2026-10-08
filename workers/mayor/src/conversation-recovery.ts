import {sessionExpiryMillisSql} from './session-expiry';
import {z} from 'zod';
import type {Env} from './env';
import {requireVoiceAccess,type VoiceIdentity} from './voice-access';
import {voiceHistory} from './voice-history';

const messagesSchema=z.array(z.object({role:z.enum(['user','assistant']),content:z.string().max(64000)}).strict()).max(50)
 .refine(messages=>messages.reduce((sum,message)=>sum+message.content.length,0)<=64000);
export type RecoveryMessage=z.infer<typeof messagesSchema>[number];
export function recoveryMessages(messages:Array<{role:string;content:string}>):RecoveryMessage[]{
 return messagesSchema.parse(voiceHistory(messages).map(message=>({role:message.role,content:message.text})));
}
export async function readConversationRecovery(env:Env,identity:VoiceIdentity){
 await requireVoiceAccess(env,identity);
 const row=await env.AGENT_DB.prepare('SELECT revision,messages_json FROM mayor_conversation_recovery WHERE tenant_id=? AND user_id=?').bind(identity.tenantId,identity.userId).first<{revision:number;messages_json:string}>();
 if(!row)return {revision:0,messages:[] as RecoveryMessage[]};
 // Validate restored snapshots too; imported backup data cannot introduce roles.
 if(row.messages_json.length>512000)throw new Error('conversation_recovery_invalid');
 const messages=messagesSchema.parse(JSON.parse(row.messages_json));
 await requireVoiceAccess(env,identity);
 return {revision:row.revision,messages};
}
export async function writeConversationRecovery(env:Env,identity:VoiceIdentity,revision:number,messages:RecoveryMessage[]){
 await requireVoiceAccess(env,identity);
 const json=JSON.stringify(messagesSchema.parse(messages)),now=new Date().toISOString();
 // Authorization and revision are checked in the same statement as the write.
 const permitted=`EXISTS(SELECT 1 FROM auth_session s JOIN agent_memberships m ON m.user_id=s.userId AND m.tenant_id=? JOIN agent_tenants t ON t.id=m.tenant_id WHERE s.id=? AND s.userId=? AND ${sessionExpiryMillisSql}>? AND m.status='active' AND m.role IN ('owner','manager','staff') AND (m.expires_at IS NULL OR m.expires_at>?) AND t.status='active')`;
 const access=[identity.tenantId,identity.sessionId,identity.userId,Date.now(),now];
 const statement=revision===0?
  env.AGENT_DB.prepare(`INSERT OR IGNORE INTO mayor_conversation_recovery(tenant_id,user_id,messages_json,updated_at) SELECT ?,?,?,? WHERE ${permitted} RETURNING revision`).bind(identity.tenantId,identity.userId,json,now,...access):
  env.AGENT_DB.prepare(`UPDATE mayor_conversation_recovery SET messages_json=?,updated_at=?,revision=revision+1 WHERE tenant_id=? AND user_id=? AND revision=? AND ${permitted} RETURNING revision`).bind(json,now,identity.tenantId,identity.userId,revision,...access);
 const receipt=await statement.first<{revision:number}>();
 if(!receipt)throw new Error('conversation_recovery_changed');
 return receipt.revision;
}
/** Start a fresh conversation thread: archive the current recovery snapshot
 * (past history is preserved in mayor_conversation_archive, never deleted)
 * and clear the live snapshot so the next turn starts a new revision lineage.
 * Returns the new thread id so the caller can confirm the fresh thread. */
export async function resetConversationRecovery(env:Env,identity:VoiceIdentity){
 await requireVoiceAccess(env,identity);
 const row=await env.AGENT_DB.prepare('SELECT messages_json FROM mayor_conversation_recovery WHERE tenant_id=? AND user_id=?').bind(identity.tenantId,identity.userId).first<{messages_json:string}>();
 const threadId=crypto.randomUUID(),now=new Date().toISOString();
 // Authorization is checked in the same statement as each write.
 const permitted=`EXISTS(SELECT 1 FROM auth_session s JOIN agent_memberships m ON m.user_id=s.userId AND m.tenant_id=? JOIN agent_tenants t ON t.id=m.tenant_id WHERE s.id=? AND s.userId=? AND ${sessionExpiryMillisSql}>? AND m.status='active' AND m.role IN ('owner','manager','staff') AND (m.expires_at IS NULL OR m.expires_at>?) AND t.status='active')`;
 const access=[identity.tenantId,identity.sessionId,identity.userId,Date.now(),now];
 const hasMessages=row&&messagesSchema.parse(JSON.parse(row.messages_json)).length>0;
 if(hasMessages){
  const archived=await env.AGENT_DB.prepare(`INSERT INTO mayor_conversation_archive(tenant_id,user_id,thread_id,messages_json,archived_at) SELECT ?,?,?,?,? WHERE ${permitted} RETURNING thread_id`).bind(identity.tenantId,identity.userId,threadId,row!.messages_json,now,...access).first<{thread_id:string}>();
  if(!archived)throw new Error('conversation_recovery_changed');
 }
 await env.AGENT_DB.prepare(`DELETE FROM mayor_conversation_recovery WHERE tenant_id=? AND user_id=? AND ${permitted}`).bind(identity.tenantId,identity.userId,...access).run();
 return {reset:true as const,threadId,archived:!!hasMessages};
}
