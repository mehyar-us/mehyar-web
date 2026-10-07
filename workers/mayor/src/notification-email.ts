import {z} from 'zod';
import type {Actor,Env} from './env';
import {OPERATORS,requireMembership} from './permissions';
import {digest,HttpError} from './http';

const permission="EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?))";
export const emailPreferenceSchema=z.object({enabled:z.boolean()}).strict();
type Preference={tenant_id:string;user_id:string;email:string;revision:number;enabled:number};
export type EmailPreferenceProposal={enabled:boolean;email:string;revision:number;expiresAt:number;actor:Actor};
type Notice={id:string;occurrence:number};
type Delivery={id:string;tenant_id:string;user_id:string;preference_revision:number;recipient:string;fingerprint:string;notifications_json:string;attempts:number};
export function emailAvailable(env:Env){return Boolean(env.MAYOR_EMAIL&&env.MAYOR_EMAIL_FROM);}
async function verifiedEmail(env:Env,actor:Actor){
 await requireMembership(env,actor,OPERATORS);
 const user=await env.AGENT_DB.prepare('SELECT email,emailVerified FROM auth_user WHERE id=?').bind(actor.userId).first<{email:string;emailVerified:number}>();
 if(!user?.emailVerified||!z.email().safeParse(user.email).success)throw new HttpError(409,'verified_email_required','Verify your sign-in email before enabling email alerts.');
 return user.email;
}
export async function readEmailPreference(env:Env,actor:Actor){
 await requireMembership(env,actor,OPERATORS);
 const user=await env.AGENT_DB.prepare('SELECT email,emailVerified FROM auth_user WHERE id=?').bind(actor.userId).first<{email:string;emailVerified:number}>();
 const preference=await env.AGENT_DB.prepare('SELECT * FROM mayor_email_preferences WHERE tenant_id=? AND user_id=?').bind(actor.tenantId,actor.userId).first<Preference>();
 const last=await env.AGENT_DB.prepare('SELECT state,updated_at FROM mayor_email_outbox WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC,id DESC LIMIT 1').bind(actor.tenantId,actor.userId).first<{state:string;updated_at:string}>();
 await requireMembership(env,actor,OPERATORS);
 return {available:emailAvailable(env),enabled:Boolean(preference?.enabled&&user?.emailVerified&&preference.email===user.email),email:user?.emailVerified?user.email:null,revision:preference?.revision??0,lastDelivery:last?{state:last.state,updatedAt:last.updated_at}:null};
}
export async function prepareEmailPreference(env:Env,actor:Actor,raw:z.infer<typeof emailPreferenceSchema>):Promise<EmailPreferenceProposal>{
 const input=emailPreferenceSchema.parse(raw),current=await readEmailPreference(env,actor);
 if(input.enabled&&!current.available)throw new HttpError(503,'email_unavailable','Email alerts are not configured yet.');
 if(input.enabled&&!current.email)throw new HttpError(409,'verified_email_required','Verify your sign-in email first.');
 return {...input,email:current.email??'',revision:current.revision,expiresAt:Date.now()+120000,actor:{...actor}};
}
export function emailPreferenceReadback(proposal:EmailPreferenceProposal){
 return proposal.enabled?`Enable attention emails for this business to ${proposal.email}? You may receive a link for unread issues, at most once every 24 hours. Delivery is currently a pilot for approved addresses. This does not read your inbox. Say yes to enable.`:'Turn off attention emails for this business? In-app notifications remain available. Queued emails will be cancelled, but mail already being sent cannot be recalled. Say yes to confirm.';
}
export async function confirmEmailPreference(env:Env,actor:Actor,proposal:EmailPreferenceProposal){
 if(proposal.expiresAt<=Date.now()||actor.userId!==proposal.actor.userId||actor.tenantId!==proposal.actor.tenantId)throw new HttpError(409,'confirmation_expired','Review the email preference again.');
 return saveEmailPreference(env,actor,{enabled:proposal.enabled},proposal);
}
export async function saveEmailPreference(env:Env,actor:Actor,raw:z.infer<typeof emailPreferenceSchema>,expected?:EmailPreferenceProposal){
 const input=emailPreferenceSchema.parse(raw);await requireMembership(env,actor,OPERATORS);
 if(input.enabled&&!emailAvailable(env))throw new HttpError(503,'email_unavailable','Email alerts are not configured yet.');
 const email=input.enabled?await verifiedEmail(env,actor):'';
 if(expected&&input.enabled&&email!==expected.email)throw new HttpError(409,'email_changed','Your email changed. Review the preference again.');
 const now=new Date().toISOString();
 const [result]=await env.AGENT_DB.batch([
  env.AGENT_DB.prepare(`INSERT INTO mayor_email_preferences(tenant_id,user_id,enabled,email,revision,updated_at) SELECT ?,?,?,?,1,? WHERE ${permission}
   AND (? IS NULL OR COALESCE((SELECT revision FROM mayor_email_preferences WHERE tenant_id=? AND user_id=?),0)=?)
   AND (?=0 OR EXISTS(SELECT 1 FROM auth_user WHERE id=? AND email=? AND emailVerified=1))
   ON CONFLICT(tenant_id,user_id) DO UPDATE SET enabled=excluded.enabled,email=excluded.email,revision=mayor_email_preferences.revision+1,updated_at=excluded.updated_at`).bind(actor.tenantId,actor.userId,Number(input.enabled),email,now,actor.tenantId,actor.userId,now,expected?.revision??null,actor.tenantId,actor.userId,expected?.revision??null,Number(input.enabled),actor.userId,email),
  env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,created_at) SELECT ?,?,?,?,? WHERE changes()=1").bind(crypto.randomUUID(),actor.tenantId,actor.userId,input.enabled?'email_alerts.enabled':'email_alerts.disabled',now),
  // Already-dispatched mail cannot be recalled. Pending sends from the old preference are cancelled.
  env.AGENT_DB.prepare("UPDATE mayor_email_outbox SET state='cancelled',updated_at=? WHERE changes()=1 AND tenant_id=? AND user_id=? AND state='pending'").bind(now,actor.tenantId,actor.userId),
 ]);
 if(result.meta.changes!==1)throw new HttpError(409,'email_preference_changed','Your preference or account access changed. Review it again.');
 return readEmailPreference(env,actor);
}
async function unread(env:Env,actor:Actor){
 const rows=await env.AGENT_DB.prepare("SELECT id,occurrence FROM mayor_notifications WHERE tenant_id=? AND user_id=? AND state='open' AND read_at IS NULL ORDER BY id LIMIT 50").bind(actor.tenantId,actor.userId).all<Notice>();
 return rows.results;
}
async function currentPermission(env:Env,row:Delivery,now:string){
 return env.AGENT_DB.prepare(`SELECT p.revision FROM mayor_email_preferences p JOIN auth_user u ON u.id=p.user_id WHERE p.tenant_id=? AND p.user_id=? AND p.enabled=1 AND p.revision=? AND p.email=? AND u.email=p.email AND u.emailVerified=1 AND ${permission}`)
  .bind(row.tenant_id,row.user_id,row.preference_revision,row.recipient,row.tenant_id,row.user_id,now).first();
}
/** Coalesce unread attention into at most one accepted/uncertain email per business/user per 24 hours. */
export async function queueNotificationEmails(env:Env,now=Date.now()){
 if(!emailAvailable(env))return 0;
 const iso=new Date(now).toISOString(),cutoff=new Date(now-86400000).toISOString();
 // Exclude unreplayable snapshots BEFORE LIMIT, or old unchanged notifications
 // can occupy every candidate slot forever. Match unread()'s ordering and bound;
 // the fingerprint conflict guard below still handles concurrent changes.
 const candidates=await env.AGENT_DB.prepare(`SELECT p.* FROM mayor_email_preferences p JOIN auth_user u ON u.id=p.user_id
 JOIN agent_memberships m ON m.tenant_id=p.tenant_id AND m.user_id=p.user_id JOIN agent_tenants t ON t.id=p.tenant_id
 WHERE p.enabled=1 AND u.emailVerified=1 AND u.email=p.email AND m.status='active' AND t.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?)
 AND EXISTS(SELECT 1 FROM mayor_notifications n WHERE n.tenant_id=p.tenant_id AND n.user_id=p.user_id AND n.state='open' AND n.read_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM mayor_email_outbox o WHERE o.tenant_id=p.tenant_id AND o.user_id=p.user_id AND (o.state IN ('pending','sending') OR (o.state IN ('accepted','uncertain','failed') AND o.updated_at>?)))
 AND NOT EXISTS(SELECT 1 FROM mayor_email_outbox o WHERE o.tenant_id=p.tenant_id AND o.user_id=p.user_id
  AND (o.state IN ('accepted','uncertain') OR (o.state='failed' AND o.preference_revision=p.revision))
  AND o.notifications_json=(SELECT json_group_array(json_object('id',id,'occurrence',occurrence)) FROM
   (SELECT id,occurrence FROM mayor_notifications n WHERE n.tenant_id=p.tenant_id AND n.user_id=p.user_id AND n.state='open' AND n.read_at IS NULL ORDER BY id LIMIT 50)))
 ORDER BY p.updated_at LIMIT 20`).bind(iso,cutoff).all<Preference>();
 let queued=0;
 for(const p of candidates.results){
  const notices=await unread(env,{tenantId:p.tenant_id,userId:p.user_id});if(!notices.length)continue;
  const fingerprint=await digest(JSON.stringify(notices));
  const result=await env.AGENT_DB.prepare(`INSERT OR IGNORE INTO mayor_email_outbox(id,tenant_id,user_id,preference_revision,recipient,fingerprint,notifications_json,state,next_attempt_at,created_at,updated_at)
   SELECT ?,?,?,?,?,?,?,'pending',?,?,? WHERE EXISTS(SELECT 1 FROM mayor_email_preferences WHERE tenant_id=? AND user_id=? AND enabled=1 AND revision=?)
   AND NOT EXISTS(SELECT 1 FROM mayor_email_outbox WHERE tenant_id=? AND user_id=? AND (state IN ('pending','sending') OR (state IN ('accepted','uncertain','failed') AND updated_at>?)))
   ON CONFLICT(tenant_id,user_id,fingerprint) DO UPDATE SET state='pending',preference_revision=excluded.preference_revision,recipient=excluded.recipient,attempts=0,next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at,created_at=excluded.created_at,lease_token=NULL,lease_until=NULL,failure_code=NULL
   WHERE mayor_email_outbox.state='cancelled' OR (mayor_email_outbox.state='failed' AND mayor_email_outbox.preference_revision!=excluded.preference_revision)`)
   .bind(crypto.randomUUID(),p.tenant_id,p.user_id,p.revision,p.email,fingerprint,JSON.stringify(notices),iso,iso,iso,p.tenant_id,p.user_id,p.revision,p.tenant_id,p.user_id,cutoff).run();
  queued+=result.meta.changes;
 }
 return queued;
}
/** A provider receipt means accepted, never proof of inbox delivery. Ambiguous sends are not retried. */
export async function deliverNotificationEmails(env:Env,now=Date.now()){
 if(!emailAvailable(env))return {accepted:0,failed:0};
 const iso=new Date(now).toISOString();
 await env.AGENT_DB.prepare("UPDATE mayor_email_outbox SET state='uncertain',failure_code='receipt_missing',updated_at=? WHERE state='sending' AND lease_until<=?").bind(iso,iso).run();
 const due=await env.AGENT_DB.prepare("SELECT * FROM mayor_email_outbox WHERE state='pending' AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 20").bind(iso).all<Delivery>();
 let accepted=0,failed=0;
 for(const row of due.results){
  const token=crypto.randomUUID();
  const claimed=await env.AGENT_DB.prepare("UPDATE mayor_email_outbox SET state='sending',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND state='pending' RETURNING attempts").bind(token,new Date(now+120000).toISOString(),iso,row.id).first<{attempts:number}>();
  if(!claimed)continue;
  let dispatched=false;
  try{
   const actor={tenantId:row.tenant_id,userId:row.user_id};
   const remaining=await unread(env,actor),snapshot=z.array(z.object({id:z.uuid(),occurrence:z.number().int().positive()}).strict()).max(50).parse(JSON.parse(row.notifications_json));
   if(!snapshot.some(old=>remaining.some(n=>n.id===old.id&&n.occurrence===old.occurrence))||!await currentPermission(env,row,iso)){
    await env.AGENT_DB.prepare("UPDATE mayor_email_outbox SET state='cancelled',updated_at=? WHERE id=? AND lease_token=? AND state='sending'").bind(iso,row.id,token).run();continue;
   }
   const target=new URL('/?notifications=1',env.APP_ORIGIN).href;
   dispatched=true;
   const receipt=await env.MAYOR_EMAIL!.send({from:{email:env.MAYOR_EMAIL_FROM!,name:'The Mayor'},to:row.recipient,subject:'The Mayor: your business needs attention',text:`You have unread items needing attention in The Mayor. Sign in to review them and choose what to do next.\n\n${target}\n\nYou enabled these alerts in Account. You can turn them off there. Alerts are grouped into at most one email every 24 hours per business. A message already being sent cannot be recalled.`});
   if(!receipt?.messageId||typeof receipt.messageId!=='string'||receipt.messageId.length>512)throw new Error('receipt_missing');
   await env.AGENT_DB.prepare("UPDATE mayor_email_outbox SET state='accepted',provider_id=?,failure_code=NULL,updated_at=? WHERE id=? AND lease_token=? AND state IN ('sending','uncertain')").bind(receipt.messageId,new Date(Math.max(now,Date.now())).toISOString(),row.id,token).run();accepted++;
  }catch(error){
   const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
   const rejected=['E_VALIDATION_ERROR','E_FIELD_MISSING','E_SENDER_NOT_VERIFIED','E_RECIPIENT_NOT_ALLOWED','E_RECIPIENT_SUPPRESSED','E_SENDER_DOMAIN_NOT_AVAILABLE','E_CONTENT_TOO_LARGE','E_DELIVERY_FAILED','E_RATE_LIMIT_EXCEEDED','E_DAILY_LIMIT_EXCEEDED'];
   const retry=['E_RATE_LIMIT_EXCEEDED','E_DAILY_LIMIT_EXCEEDED'].includes(code)&&claimed.attempts<3;
   const state=!dispatched?'failed':retry?'pending':rejected.includes(code)?'failed':'uncertain';
   await env.AGENT_DB.prepare("UPDATE mayor_email_outbox SET state=?,failure_code=?,next_attempt_at=?,updated_at=? WHERE id=? AND lease_token=? AND state IN ('sending','uncertain')").bind(state,rejected.includes(code)?code:dispatched?'receipt_missing':'preflight_failed',new Date(now+300000).toISOString(),iso,row.id,token).run();failed++;
  }
 }
 return {accepted,failed};
}
