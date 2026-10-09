import type {Actor,Env} from './env';
import {OPERATORS,requireMembership} from './permissions';
import {readMemory} from './memory';
import {selectedCalendar} from './calendars';
import {HttpError} from './http';

const content={
 phone_call_review:{title:'A phone call needs your attention',message:'The Mayor could not confirm that a Telnyx call ended. Check active calls in your Telnyx account and end any unintended call. Provider charges may continue until the call ends.',action:'account'},
 scheduled_check_failed:{title:'Your recurring account check could not finish',message:'The Mayor could not verify your account or selected calendar. Review your connection and the latest check status in Account.',action:'account'},
 onboarding:{title:'Tell The Mayor about your business',message:'Share your business name and what you offer, or provide a website. Review the suggested facts before saving them.',action:'chat'},
 calendar_connection:{title:'Your calendar connection needs attention',message:'Review your selected calendar in Account. Reconnect or select it again before relying on scheduling.',action:'account'},
 missed_call_texted:{title:'Missed call recovered',message:'A text-back was sent to the missed caller. Review it in Missed calls.',action:'missed-calls'},
 missed_call:{title:'Missed call — text-back ready',message:'A call was missed. Open Missed calls to review it and send the text-back.',action:'missed-calls'},
 // Honest test-mode copy (compliance item 12): never imply a real SMS was sent.
 missed_call_simulated:{title:'Test text-back logged — no SMS sent',message:'The simulated text-back for this test missed call was logged to the SMS log. Nothing was sent to a real phone.',action:'missed-calls'},
 // Crew 3 proactive engine: suggestion + morning briefing surface cards.
 proactive_suggestion:{title:'A proactive suggestion is ready',message:'The Mayor spotted a way to fill slow time or win back business. Review the suggestion.',action:'suggestions'},
 proactive_briefing:{title:'Your morning briefing is ready',message:'Yesterday, today, and open opportunities at a glance.',action:'briefing'},
} as const;
type Kind=keyof typeof content;
export type NotificationRunGuard={revision:number;leaseToken:string};
const eligible="EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?))";
/** Local account-state checks only; no provider polling or email delivery. */
export async function refreshAttentionNotifications(env:Env,actor:Actor,run?:NotificationRunGuard){
 await requireMembership(env,actor,OPERATORS);
 const [memory,calendar]=await Promise.all([readMemory(env,actor),selectedCalendar(env,actor)]);
 const kinds:Kind[]=[];
 if(!memory.profile.name||!(memory.profile.description?.trim()||memory.profile.services?.length))kinds.push('onboarding');
 if(calendar&&!calendar.available)kinds.push('calendar_connection');
 const now=new Date().toISOString(),statements=[];
 // Scheduled checks must still own the same enabled run when each write commits.
 // Manual inbox refreshes have no schedule and retain the membership-only guard.
 const allowed=eligible+(run?' AND EXISTS(SELECT 1 FROM mayor_recurring_checks WHERE tenant_id=? AND user_id=? AND enabled=1 AND revision=? AND lease_token=?)':'');
 const access=[actor.tenantId,actor.userId,now,...(run?[actor.tenantId,actor.userId,run.revision,run.leaseToken]:[])];
 for(const kind of ['onboarding','calendar_connection'] as const){
  if(kinds.includes(kind))statements.push(env.AGENT_DB.prepare(`INSERT INTO mayor_notifications(id,tenant_id,user_id,dedupe_key,kind,state,created_at,updated_at)
   SELECT ?,?,?,?,?,'open',?,? WHERE ${allowed}
   ON CONFLICT(tenant_id,user_id,dedupe_key) DO UPDATE SET occurrence=mayor_notifications.occurrence+CASE WHEN mayor_notifications.state='resolved' THEN 1 ELSE 0 END,state='open',read_at=CASE WHEN mayor_notifications.state='resolved' THEN NULL ELSE mayor_notifications.read_at END,updated_at=excluded.updated_at`).bind(crypto.randomUUID(),actor.tenantId,actor.userId,kind,kind,now,now,...access));
  else statements.push(env.AGENT_DB.prepare(`UPDATE mayor_notifications SET state='resolved',updated_at=? WHERE tenant_id=? AND user_id=? AND dedupe_key=? AND state='open' AND ${allowed}`).bind(now,actor.tenantId,actor.userId,kind,...access));
 }
 await env.AGENT_DB.batch(statements);
 return listNotifications(env,actor);
}
export async function listNotifications(env:Env,actor:Actor){
 await requireMembership(env,actor,OPERATORS);
 const rows=await env.AGENT_DB.prepare("SELECT id,kind,created_at,read_at FROM mayor_notifications WHERE tenant_id=? AND user_id=? AND state='open' ORDER BY created_at DESC,id LIMIT 51").bind(actor.tenantId,actor.userId).all<{id:string;kind:Kind;created_at:string;read_at:string|null}>();
 await requireMembership(env,actor,OPERATORS);
 return {notifications:rows.results.slice(0,50).map(row=>({id:row.id,...content[row.kind],createdAt:row.created_at,read:row.read_at!==null})),hasMore:rows.results.length>50};
}
export async function markNotificationRead(env:Env,actor:Actor,id:string){
 await requireMembership(env,actor,OPERATORS);const now=new Date().toISOString();
 const row=await env.AGENT_DB.prepare(`UPDATE mayor_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND tenant_id=? AND user_id=? AND state='open' AND ${eligible} RETURNING id`).bind(now,id,actor.tenantId,actor.userId,actor.tenantId,actor.userId,now).first();
 if(!row)throw new HttpError(404,'notification_unavailable','This notification is no longer available.');
 return {read:true};
}
