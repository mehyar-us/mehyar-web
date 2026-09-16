import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {requireTenant} from '../permissions';
import {RELEASE_GATES,requireVerifiedGates} from '../billing/service';
import type {Policy,Proposal} from '../actions';
import {connectorCredential,assertConnectionAvailable} from './credentials';
import {GoogleMailClient,GOOGLE_MAIL_OPERATIONS} from './google-mail';
import {MicrosoftMailClient,MICROSOFT_MAIL_OPERATIONS} from './microsoft-mail';
import {GoogleCalendarClient,GOOGLE_CALENDAR_OPERATIONS} from './google-calendar';
import {MicrosoftCalendarClient,MICROSOFT_CALENDAR_OPERATIONS} from './microsoft-calendar';
import type {MailReceipt,AppointmentReceipt} from './types';
export type ActionReceipt=MailReceipt|AppointmentReceipt;

export async function requireExecutionAccess(env:Env,actor:Actor,policy:Policy) {
  if(env.EXTERNAL_ACTIONS_ENABLED!=='true')throw new HttpError(503,'execution_disabled','External actions are not enabled.');
  const tenant=await requireTenant(env,actor);
  if(tenant.plan_id==='trial'||!['active','past-due','degraded'].includes(tenant.status))throw new HttpError(403,'paid_execution_required','An activated paid plan is required for external actions.');
  const sub=await env.AGENT_DB.prepare('SELECT plan_id,access_state,paid_through,grace_expires_at,dispute_state FROM agent_billing_subscriptions WHERE tenant_id=?')
    .bind(actor.tenantId).first<{plan_id:string;access_state:string;paid_through:string|null;grace_expires_at:string|null;dispute_state:string|null}>();
  const valid=sub&&!sub.dispute_state&&sub.plan_id===tenant.plan_id&&(
    (['active','paid_through'].includes(sub.access_state)&&Date.parse(sub.paid_through??'')>Date.now())
    ||(sub.access_state==='grace'&&Boolean(sub.paid_through)&&Date.parse(sub.grace_expires_at??'')>Date.now()));
  if(!valid)throw new HttpError(403,'subscription_access_expired','Paid access is unavailable. Review billing before executing actions.');
  await requireVerifiedGates(env,'catalog',RELEASE_GATES);
  await requireVerifiedGates(env,actor.tenantId,['activation_approved','business_policy_approved']);
  await requireVerifiedGates(env,`connector:${policy.provider}.${policy.operation}`,['provider_approval','live_acceptance']);
}

/** The durable caller owns the action lease and invokes guard immediately before every
 * request. The effect callback durably records dispatch BEFORE a write reaches the network.
 */
export async function performAction(env:Env,actor:Actor,policy:Policy,action:Proposal['action'],requestId:string,
  guard:()=>Promise<void>,effect:()=>void,transport:typeof fetch=fetch):Promise<ActionReceipt> {
  const operation=action.operation==='mail.reply'?(policy.provider==='google'?GOOGLE_MAIL_OPERATIONS.reply:MICROSOFT_MAIL_OPERATIONS.reply)
    :(policy.provider==='google'?GOOGLE_CALENDAR_OPERATIONS.create:MICROSOFT_CALENDAR_OPERATIONS.create);
  const auth=await connectorCredential(env,actor,policy.grantId,policy.provider,operation,transport);
  const controlled:typeof fetch=async(input,init)=>{
    await assertConnectionAvailable(env,actor,policy.grantId,policy.provider,operation);
    await guard();
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    const method=init?.method??'GET';
    const writes=method==='POST'&&(url.pathname.endsWith('/messages/send')||url.pathname.endsWith('/reply')||url.pathname.endsWith('/events'));
    if(writes)effect();
    return transport(input,init);
  };
  if(action.operation==='mail.reply') {
    const client=policy.provider==='google'?new GoogleMailClient(auth,{fetch:controlled}):new MicrosoftMailClient(auth,{fetch:controlled});
    return client.sendReply({threadId:action.resourceId,messageId:action.messageId,recipient:action.recipient,text:action.text,requestId});
  }
  const client=policy.provider==='google'?new GoogleCalendarClient(auth,{fetch:controlled}):new MicrosoftCalendarClient(auth,{fetch:controlled});
  const calendars=await client.listCalendars();
  if(!calendars.items.some(calendar=>calendar.id===action.resourceId&&calendar.canWrite))throw new HttpError(403,'calendar_not_owned','This account has not verified write access to the selected calendar.');
  const window={start:action.start,end:action.end,timeZone:action.timeZone};
  const availability=await client.listAvailability(action.resourceId,window);
  if(!availability.complete||availability.busy.length)throw new HttpError(409,'calendar_conflict','The requested time is unavailable or could not be verified.');
  return client.createAppointment(action.resourceId,{...window,title:action.title,description:action.description,attendees:action.attendees,requestId});
}
