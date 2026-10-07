import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError} from './http';
import {OPERATORS,requireMembership} from './permissions';
import {checkScheduleSchema,nextCheckRun,type CheckSchedule} from './check-schedule';
import {refreshAttentionNotifications,type NotificationRunGuard} from './notifications';
import {discoverCalendars,selectedCalendar} from './calendars';
import {ConnectorError} from './connectors/types';

export const recurringCheckSchema=z.discriminatedUnion('enabled',[
 z.object({enabled:z.literal(true),schedule:checkScheduleSchema}).strict(),
 z.object({enabled:z.literal(false)}).strict(),
]);
export type CheckProposal={input:z.infer<typeof recurringCheckSchema>;revision:number;expiresAt:number};
type Row={tenant_id:string;user_id:string;enabled:number;schedule_json:string;revision:number;next_run_at:string|null;due_local_date:string|null;lease_token:string|null;lease_until:string|null;attempts:number;last_run_at:string|null;last_status:'ok'|'failed'|null};
const permission="EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?))";
export async function readRecurringCheck(env:Env,actor:Actor){
 await requireMembership(env,actor,OPERATORS);
 const row=await env.AGENT_DB.prepare('SELECT * FROM mayor_recurring_checks WHERE tenant_id=? AND user_id=?').bind(actor.tenantId,actor.userId).first<Row>();
 await requireMembership(env,actor,OPERATORS);
 const nextRunAt=row?.next_run_at&&row.lease_until&&row.lease_until>row.next_run_at?row.lease_until:row?.next_run_at??null;
 return {enabled:Boolean(row?.enabled),schedule:row?checkScheduleSchema.parse(JSON.parse(row.schedule_json)):null,revision:row?.revision??0,nextRunAt,running:Boolean(row?.lease_token&&row.lease_until&&Date.parse(row.lease_until)>Date.now()),lastRunAt:row?.last_run_at??null,lastStatus:row?.last_status??null,scope:'Business profile completeness and live access to your selected calendar. In-app alerts, with email following Account preferences.'};
}
export async function prepareRecurringCheck(env:Env,actor:Actor,input:z.infer<typeof recurringCheckSchema>):Promise<CheckProposal>{
 const parsed=recurringCheckSchema.parse(input),current=await readRecurringCheck(env,actor);
 if(!parsed.enabled&&!current.revision)throw new HttpError(409,'no_recurring_check','There is no recurring account check to pause.');
 return {input:parsed,revision:current.revision,expiresAt:Date.now()+120000};
}
export function recurringCheckReadback(proposal:CheckProposal){
 if(!proposal.input.enabled)return 'Pause your recurring account check? Existing notifications remain available. Say yes to confirm.';
 const s=proposal.input.schedule;
 return `Check your saved business profile and verify live access to your selected calendar ${s.frequency==='daily'?'every day':'Monday through Friday'} at ${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')} in ${s.timeZone}? I will flag issues in the app; emails follow your Account preferences. This does not monitor reviews or your inbox. Checks normally start within five minutes. A clock-change time that does not exist is skipped. Say yes to enable this check.`;
}
export async function confirmRecurringCheck(env:Env,actor:Actor,proposal:CheckProposal){
 const input=recurringCheckSchema.parse(proposal.input);
 if(proposal.expiresAt<=Date.now())throw new HttpError(409,'confirmation_expired','Review the check again.');
 const current=await readRecurringCheck(env,actor);
 if(current.revision!==proposal.revision)throw new HttpError(409,'schedule_changed','Your check changed. Review it again.');
 const now=new Date().toISOString(),schedule=input.enabled?input.schedule:current.schedule;
 if(!schedule)throw new HttpError(409,'no_recurring_check','There is no recurring check.');
 const next=input.enabled?nextCheckRun(schedule,Date.now()):null;
 const mutation=env.AGENT_DB.prepare(`INSERT INTO mayor_recurring_checks(tenant_id,user_id,enabled,schedule_json,revision,next_run_at,due_local_date,updated_at)
 SELECT ?,?,?,?,1,?,?,? WHERE ${permission}
 ON CONFLICT(tenant_id,user_id) DO UPDATE SET enabled=excluded.enabled,schedule_json=excluded.schedule_json,revision=mayor_recurring_checks.revision+1,next_run_at=excluded.next_run_at,due_local_date=excluded.due_local_date,lease_token=NULL,lease_until=NULL,attempts=0,updated_at=excluded.updated_at
 WHERE mayor_recurring_checks.revision=?`).bind(actor.tenantId,actor.userId,Number(input.enabled),JSON.stringify(schedule),next?.at??null,next?.date??null,now,actor.tenantId,actor.userId,now,proposal.revision);
 const [result]=await env.AGENT_DB.batch([mutation,
  env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1").bind(crypto.randomUUID(),actor.tenantId,actor.userId,input.enabled?'recurring_check.enabled':'recurring_check.paused',String(proposal.revision+1),now),
 ]);
 if(result.meta.changes!==1)throw new HttpError(409,'schedule_changed','Your check changed or your access ended.');
 return readRecurringCheck(env,actor);
}
export async function pauseRecurringCheck(env:Env,actor:Actor){
 return confirmRecurringCheck(env,actor,await prepareRecurringCheck(env,actor,{enabled:false}));
}
/** Read-only provider check with a deadline and an authorization recheck. */
export async function checkAccountNow(env:Env,actor:Actor,transport:typeof fetch=fetch,run?:NotificationRunGuard){
 await refreshAttentionNotifications(env,actor,run);
 const before=await selectedCalendar(env,actor);
 if(!before)return;
 if(!before.available)throw new Error('Calendar authorization unavailable.');
 const deadline=AbortSignal.timeout(15000);
 const bounded=((url:RequestInfo|URL,init?:RequestInit)=>transport(url,{...init,signal:AbortSignal.any([deadline,...(init?.signal?[init.signal]:[])])})) as typeof fetch;
 const directory=await discoverCalendars(env,actor,{provider:before.provider,grantId:before.grantId},bounded);
 if(!directory.calendars.some(item=>item.id===before.calendar.id&&item.canWrite))throw new Error('Selected calendar unavailable.');
 const after=await selectedCalendar(env,actor);
 if(!after?.available||after.provider!==before.provider||after.grantId!==before.grantId||after.calendar.id!==before.calendar.id)throw new Error('Calendar changed while checking.');
}
export async function runRecurringChecks(env:Env,options:{now?:number;check?:(env:Env,actor:Actor)=>Promise<void>}={}){
 const time=options.now??Date.now(),now=new Date(time).toISOString();
 const due=await env.AGENT_DB.prepare(`SELECT * FROM mayor_recurring_checks WHERE enabled=1 AND next_run_at<=? AND (lease_until IS NULL OR lease_until<=?)
 AND EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=mayor_recurring_checks.tenant_id AND m.user_id=mayor_recurring_checks.user_id AND m.status='active' AND t.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?))
 ORDER BY next_run_at LIMIT 10`).bind(now,now,now).all<Row>();
 let completed=0,failed=0;
 for(const row of due.results){
  const actor={tenantId:row.tenant_id,userId:row.user_id},token=crypto.randomUUID();
  const claimed=await env.AGENT_DB.prepare(`UPDATE mayor_recurring_checks SET lease_token=?,lease_until=?,attempts=attempts+1 WHERE tenant_id=? AND user_id=? AND enabled=1 AND revision=? AND next_run_at=? AND (lease_until IS NULL OR lease_until<=?) AND ${permission} RETURNING attempts`).bind(token,new Date(time+120000).toISOString(),actor.tenantId,actor.userId,row.revision,row.next_run_at,now,actor.tenantId,actor.userId,now).first<{attempts:number}>();
  if(!claimed)continue;
  let status:'ok'|'failed'='ok';
  try{
   if(options.check)await options.check(env,actor);
   else await checkAccountNow(env,actor,fetch,{revision:row.revision,leaseToken:token});
  }catch(error){
   status='failed';
   const code=error instanceof HttpError?error.code:error instanceof ConnectorError?error.kind:'check_failed';
   const allowed=['reconnect_required','refresh_uncertain','refresh_unavailable','connection_unavailable','insufficient_scope','provider_not_configured','reauthorization_required','permission_denied','rate_limited','retryable_read'];
   console.warn(JSON.stringify({event:'recurring_check_failed',reason:allowed.includes(code)?code:'check_failed'}));
  }
  const finished=new Date(options.now??Date.now()).toISOString();
  const next=status==='failed'&&claimed.attempts<3?null:nextCheckRun(JSON.parse(row.schedule_json) as CheckSchedule,Math.max(time,Date.parse(finished)),row.due_local_date??undefined);
  const guard=`EXISTS(SELECT 1 FROM mayor_recurring_checks WHERE tenant_id=? AND user_id=? AND enabled=1 AND revision=? AND lease_token=?) AND ${permission}`;
  const args=[actor.tenantId,actor.userId,row.revision,token,actor.tenantId,actor.userId,finished];
  const notification=status==='failed'?
   env.AGENT_DB.prepare(`INSERT INTO mayor_notifications(id,tenant_id,user_id,dedupe_key,kind,state,created_at,updated_at)
    SELECT ?,?,?,'scheduled_check_failed','scheduled_check_failed','open',?,? WHERE ${guard}
    ON CONFLICT(tenant_id,user_id,dedupe_key) DO UPDATE SET occurrence=mayor_notifications.occurrence+CASE WHEN mayor_notifications.state='resolved' THEN 1 ELSE 0 END,state='open',read_at=CASE WHEN mayor_notifications.state='resolved' THEN NULL ELSE mayor_notifications.read_at END,updated_at=excluded.updated_at`).bind(crypto.randomUUID(),actor.tenantId,actor.userId,finished,finished,...args):
   env.AGENT_DB.prepare(`UPDATE mayor_notifications SET state='resolved',updated_at=? WHERE tenant_id=? AND user_id=? AND dedupe_key='scheduled_check_failed' AND ${guard}`).bind(finished,actor.tenantId,actor.userId,...args);
  const receipts=await env.AGENT_DB.batch([
   notification,
   env.AGENT_DB.prepare(`INSERT INTO mayor_check_runs(id,tenant_id,user_id,schedule_revision,due_at,attempt,status,checked_at) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`).bind(crypto.randomUUID(),actor.tenantId,actor.userId,row.revision,row.next_run_at,claimed.attempts,status,finished,...args),
   env.AGENT_DB.prepare(`UPDATE mayor_recurring_checks SET last_run_at=?,last_status=?,next_run_at=?,due_local_date=?,attempts=?,lease_token=NULL,lease_until=?,updated_at=? WHERE tenant_id=? AND user_id=? AND revision=? AND lease_token=? AND ${permission}`)
    .bind(finished,status,next?.at??row.next_run_at,next?.date??row.due_local_date,next?0:claimed.attempts,next?null:new Date(Date.parse(finished)+300000).toISOString(),finished,actor.tenantId,actor.userId,row.revision,token,actor.tenantId,actor.userId,finished),
  ]);
  if(receipts[2].meta.changes){completed++;if(status==='failed')failed++;}
 }
 return {completed,failed};
}
