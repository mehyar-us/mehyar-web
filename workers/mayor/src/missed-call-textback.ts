import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError} from './http';
import {OPERATORS,requireMembership} from './permissions';
import {readMemory} from './memory';
import {verticalProfile} from './verticals';
import {telnyxManagementAccess} from './telnyx-connections';
import {loadProactiveContext,ensureMissedCallFollowupCard,resolveMissedCallFollowupCards} from './proactive-detectors';

/** Money loop: missed call -> SMS text-back within 60s -> owner card.
 * Never sends without an authorized Telnyx connection and a selected number.
 * Test flows must pass source:'test' and never touch real customer numbers. */

const e164=z.string().regex(/^\+[1-9]\d{6,14}$/);

export const missedCallInputSchema=z.object({
 callerNumber:e164,
 businessNumber:e164.optional(),
 callControlId:z.string().max(64).optional(),
 source:z.enum(['webhook','test','manual']).default('webhook'),
}).strict();
export type MissedCallInput=z.infer<typeof missedCallInputSchema>;

export interface MissedCallRecord{
 id:string;tenant_id:string;caller_number:string;business_number:string;
 status:string;textback_sent_at:string|null;
}

/** Record a missed call. Idempotent per call_control_id when provided. */
export async function recordMissedCall(env:Env,actor:Actor,input:MissedCallInput):Promise<MissedCallRecord>{
 await requireMembership(env,actor,OPERATORS);
 const data=missedCallInputSchema.parse(input);
 if(data.source!=='test'){
  const access=await telnyxManagementAccess(env,actor).catch(()=>null);
  const row=access?await env.AGENT_DB.prepare("SELECT selected_number FROM mayor_phone_connections WHERE tenant_id=? AND provider='telnyx' AND status='authorized'").bind(actor.tenantId).first<{selected_number:string|null}>():null;
  const bizNumber=data.businessNumber??row?.selected_number;
  if(!bizNumber||!e164.safeParse(bizNumber).success)throw new HttpError(409,'business_number_missing','Select a business phone number before text-backs can send.');
  data.businessNumber=bizNumber;
 }else if(!data.businessNumber){
  throw new HttpError(400,'test_number_required','Test flows must provide a businessNumber.');
 }
 const id=crypto.randomUUID(),now=new Date().toISOString();
 if(data.callControlId){
  const existing=await env.AGENT_DB.prepare('SELECT id,tenant_id,caller_number,business_number,status,textback_sent_at,occurred_at FROM mayor_missed_calls WHERE tenant_id=? AND call_control_id=?').bind(actor.tenantId,data.callControlId).first<MissedCallRecord&{occurred_at:string}>();
  if(existing){
   await notifyMissedCallRecorded(env,actor,existing);
   // Backfill the prepared action if an older record predates it — never duplicates.
   const pctx0=await loadProactiveContext(env,actor.tenantId);
   await ensureMissedCallFollowupCard(env,pctx0,{id:existing.id,callerNumber:existing.caller_number,occurredAt:existing.occurred_at});
   return existing;
  }
 }
 await env.AGENT_DB.prepare(`INSERT INTO mayor_missed_calls(id,tenant_id,caller_number,business_number,call_control_id,occurred_at,source,status)
  VALUES(?,?,?,?,?,?,?,'missed')`).bind(id,actor.tenantId,data.callerNumber,data.businessNumber!,data.callControlId??null,now,data.source).run();
 const record={id,tenant_id:actor.tenantId,caller_number:data.callerNumber,business_number:data.businessNumber!,status:'missed',textback_sent_at:null};
 // Bell card the moment the call is recorded — test and live paths alike.
 await notifyMissedCallRecorded(env,actor,record);
 // Suggestion card at the same moment: the missed call IS the nudge. The owner
 // gets a prepared [Send] [Edit] [Dismiss] action immediately — no waiting for
 // the 15-minute backstop detector.
 const pctx=await loadProactiveContext(env,actor.tenantId);
 await ensureMissedCallFollowupCard(env,pctx,{id,callerNumber:data.callerNumber,occurredAt:now});
 return record;
}

const telnyxMessageResponse=z.object({data:z.object({id:z.string()})});

/** Send the vertical-aware text-back via Telnyx. Updates the missed-call record and SMS log. */
export async function sendTextBack(env:Env,actor:Actor,missedCallId:string,transport:typeof fetch=fetch){
 await requireMembership(env,actor,OPERATORS);
 const call=await env.AGENT_DB.prepare('SELECT * FROM mayor_missed_calls WHERE id=? AND tenant_id=?').bind(missedCallId,actor.tenantId).first<MissedCallRecord&{source:string}>();
 if(!call)throw new HttpError(404,'missed_call_not_found','Missed call not found.');
 if(call.textback_sent_at)return {alreadySent:true,messageId:null};
 const mem=await readMemory(env,actor);
 const businessName=mem.profile.name?.trim()||'us';
 const profile=verticalProfile((mem.profile as {vertical?:string}).vertical);
 const text=profile.textbackTemplate.replace('{business}',businessName);
 const access=await telnyxManagementAccess(env,actor,transport);
 const response=await transport('https://api.telnyx.com/v2/messages',{
  method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),
  headers:{authorization:access.authorization,'content-type':'application/json',accept:'application/json'},
  body:JSON.stringify({from:call.business_number,to:call.caller_number,text}),
 });
 if(!response.ok){await response.body?.cancel();throw new HttpError(502,'sms_send_failed','The text-back could not be sent. Check the Telnyx connection.');}
 const body=await response.json();
 const parsed=telnyxMessageResponse.safeParse(body);
 const messageId=parsed.success?parsed.data.data.id:null;
 const now=new Date().toISOString(),smsId=crypto.randomUUID();
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare(`UPDATE mayor_missed_calls SET status='texted',textback_sent_at=?,textback_message_id=? WHERE id=? AND tenant_id=?`).bind(now,messageId,missedCallId,actor.tenantId),
  env.AGENT_DB.prepare(`INSERT INTO mayor_sms_log(id,tenant_id,direction,to_number,from_number,body,provider_message_id,status,related_missed_call_id)
   VALUES(?,?,'outbound',?,?,?,?, 'sent',?)`).bind(smsId,actor.tenantId,call.caller_number,call.business_number,text,messageId,missedCallId),
 ]);
 await notifyMissedCallTexted(env,actor,call,false);
 // A handled call leaves no stale suggestion behind (card Send path does this too).
 await resolveMissedCallFollowupCards(env,actor.tenantId,missedCallId);
 return {alreadySent:false,messageId};
}

/** Test-mode simulation of a text-back. Records what a text-back would look like,
 * marks the call texted, and writes the owner notification — but never touches
 * Telnyx or any real provider. This function takes no transport: simulation has
 * no network capability. Only calls recorded by the test simulator may be simulated. */
export async function simulateTextBack(env:Env,actor:Actor,missedCallId:string){
 await requireMembership(env,actor,OPERATORS);
 const call=await env.AGENT_DB.prepare('SELECT * FROM mayor_missed_calls WHERE id=? AND tenant_id=?').bind(missedCallId,actor.tenantId).first<MissedCallRecord&{source:string}>();
 if(!call)throw new HttpError(404,'missed_call_not_found','Missed call not found.');
 if(call.source!=='test')throw new HttpError(400,'simulation_test_only','Only calls recorded by the test simulator can be text-backed in simulation.');
 if(call.textback_sent_at)return {alreadySent:true,messageId:null,simulated:true};
 const mem=await readMemory(env,actor);
 const businessName=mem.profile.name?.trim()||'us';
 const profile=verticalProfile((mem.profile as {vertical?:string}).vertical);
 const text=profile.textbackTemplate.replace('{business}',businessName);
 const now=new Date().toISOString(),smsId=crypto.randomUUID();
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare(`UPDATE mayor_missed_calls SET status='texted',textback_sent_at=?,textback_message_id=NULL WHERE id=? AND tenant_id=?`).bind(now,missedCallId,actor.tenantId),
  env.AGENT_DB.prepare(`INSERT INTO mayor_sms_log(id,tenant_id,direction,to_number,from_number,body,provider_message_id,status,related_missed_call_id)
   VALUES(?,?,'outbound',?,?,?,?, 'simulated',?)`).bind(smsId,actor.tenantId,call.caller_number,call.business_number,text,null,missedCallId),
 ]);
 await notifyMissedCallTexted(env,actor,call,true);
 // A handled call leaves no stale suggestion behind (card Send path does this too).
 await resolveMissedCallFollowupCards(env,actor.tenantId,missedCallId);
 return {alreadySent:false,messageId:null,simulated:true};
}

/** Bell card written the moment a missed call is recorded — before any
 * text-back. Idempotent via dedupe_key, so re-records are safe. */
async function notifyMissedCallRecorded(env:Env,actor:Actor,call:{id:string}){
 const now=new Date().toISOString();
 const owners=await env.AGENT_DB.prepare(`SELECT user_id FROM agent_memberships WHERE tenant_id=? AND status='active' AND role IN ('owner','manager') AND (expires_at IS NULL OR expires_at>?)`).bind(actor.tenantId,now).all<{user_id:string}>();
 const statements=owners.results.map(o=>env.AGENT_DB.prepare(`INSERT INTO mayor_notifications(id,tenant_id,user_id,dedupe_key,kind,state,created_at,updated_at)
  SELECT ?,?,?,?,'missed_call','open',?,?
  WHERE NOT EXISTS(SELECT 1 FROM mayor_notifications WHERE tenant_id=? AND user_id=? AND dedupe_key=?)
  AND EXISTS(SELECT 1 FROM agent_tenants WHERE id=? AND status='active')`)
  .bind(crypto.randomUUID(),actor.tenantId,o.user_id,`missed_call:${call.id}`,now,now,actor.tenantId,o.user_id,`missed_call:${call.id}`,actor.tenantId));
 if(statements.length)await env.AGENT_DB.batch(statements);
}

/** Resolve the 'missed_call' record card and raise the honest outcome card:
 * 'missed_call_texted' for a real provider send, 'missed_call_simulated' for a
 * test simulation (compliance item 12: never imply a real SMS was sent).
 * Exported for tests. */
export async function transitionMissedCallNotification(env:Env,actor:Actor,call:{id:string},simulated:boolean){
 const now=new Date().toISOString();
 const kind=simulated?'missed_call_simulated':'missed_call_texted';
 await env.AGENT_DB.prepare(`UPDATE mayor_notifications SET state='resolved',updated_at=? WHERE tenant_id=? AND kind='missed_call' AND dedupe_key=? AND state='open'`).bind(now,actor.tenantId,`missed_call:${call.id}`).run();
 const owners=await env.AGENT_DB.prepare(`SELECT user_id FROM agent_memberships WHERE tenant_id=? AND status='active' AND role IN ('owner','manager') AND (expires_at IS NULL OR expires_at>?)`).bind(actor.tenantId,now).all<{user_id:string}>();
 const statements=owners.results.map(o=>env.AGENT_DB.prepare(`INSERT INTO mayor_notifications(id,tenant_id,user_id,dedupe_key,kind,state,created_at,updated_at)
  SELECT ?,?,?,?,?,'open',?,?
  WHERE NOT EXISTS(SELECT 1 FROM mayor_notifications WHERE tenant_id=? AND user_id=? AND dedupe_key=?)
  AND EXISTS(SELECT 1 FROM agent_tenants WHERE id=? AND status='active')`)
  .bind(crypto.randomUUID(),actor.tenantId,o.user_id,`${kind}:${call.id}`,kind,now,now,actor.tenantId,o.user_id,`${kind}:${call.id}`,actor.tenantId));
 if(statements.length)await env.AGENT_DB.batch(statements);
}

async function notifyMissedCallTexted(env:Env,actor:Actor,call:MissedCallRecord,simulated:boolean){
 await transitionMissedCallNotification(env,actor,call,simulated);
}

/** Owner-visible card data for a missed call. No customer PII beyond the number. */
export async function missedCallCard(env:Env,actor:Actor,missedCallId:string){
 await requireMembership(env,actor,OPERATORS);
 const call=await env.AGENT_DB.prepare('SELECT id,caller_number,business_number,occurred_at,textback_sent_at,reply_received_at,booking_id,status FROM mayor_missed_calls WHERE id=? AND tenant_id=?').bind(missedCallId,actor.tenantId).first();
 if(!call)throw new HttpError(404,'missed_call_not_found','Missed call not found.');
 return call;
}

export async function listRecentMissedCalls(env:Env,actor:Actor,limit=20){
 await requireMembership(env,actor,OPERATORS);
 const mem=await readMemory(env,actor);
 const businessName=mem.profile.name?.trim()||'us';
 const profile=verticalProfile((mem.profile as {vertical?:string}).vertical);
 const rows=await env.AGENT_DB.prepare(`SELECT mc.id,mc.caller_number,mc.source,mc.occurred_at,mc.textback_sent_at,mc.reply_received_at,mc.booking_id,mc.status,
  (SELECT body FROM mayor_sms_log WHERE tenant_id=mc.tenant_id AND related_missed_call_id=mc.id AND direction='outbound' ORDER BY created_at DESC LIMIT 1) AS textback_body
  FROM mayor_missed_calls mc WHERE mc.tenant_id=? ORDER BY mc.occurred_at DESC LIMIT ?`).bind(actor.tenantId,Math.min(limit,50)).all<{id:string;textback_sent_at:string|null;textback_body:string|null}>();
 return rows.results.map(row=>({
  ...row,
  // What the engine will send (unsent) or did send (logged body) — owner-facing honesty.
  textback_preview:row.textback_sent_at?null:profile.textbackTemplate.replace('{business}',businessName),
  textback_body:row.textback_body??null,
 }));
}
