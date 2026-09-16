import type { Actor, Env } from '../env';
import type { OAuthProvider } from '../auth/capabilities';
import { HttpError } from '../http';
import { OPERATORS, requireMembership } from '../permissions';
import { assertConnectionAvailable, connectorCredential } from './credentials';
import { GoogleCalendarClient, GOOGLE_CALENDAR_OPERATIONS } from './google-calendar';
import { MicrosoftCalendarClient, MICROSOFT_CALENDAR_OPERATIONS } from './microsoft-calendar';
import {calendarDirectory} from './calendar-directory';
import type {CalendarSessions} from './calendar-sessions';

/** A read-only account picker, not authorization to create or change appointments. */
export async function connectedCalendars(env:Env,actor:Actor,grantId:string,provider:OAuthProvider,transport:typeof fetch=fetch,isPaused:()=>boolean=()=>false,sessions?:CalendarSessions,continuation?:string) {
  await requireMembership(env,actor,OPERATORS);
  if(!['google','microsoft'].includes(provider)||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(grantId))
    throw new HttpError(400,'invalid_connection','Choose a valid connected account.');
  const enabled=new Set((provider==='google'?env.GOOGLE_ENABLED_CAPABILITIES:env.MICROSOFT_ENABLED_CAPABILITIES)?.split(',').map(v=>v.trim())??[]);
  if(!enabled.has('calendar_read')&&!enabled.has('calendar_manage'))throw new HttpError(503,'calendar_not_ready','Calendar access is awaiting provider configuration and verification.');
  if(isPaused())throw new HttpError(409,'agent_paused','Resume your agent before reading calendars.');
  const operation=provider==='google'?GOOGLE_CALENDAR_OPERATIONS.list:MICROSOFT_CALENDAR_OPERATIONS.read;
  const credential=await connectorCredential(env,actor,grantId,provider,operation,transport);
  const client=provider==='google'?new GoogleCalendarClient(credential,{fetch:transport}):new MicrosoftCalendarClient(credential,{fetch:transport});
  // Recheck after token refresh, before the provider read. Business action policy is not
  // needed for the owner's account picker; all eventual writes still require the broker.
  const guard=async()=>{
    await requireMembership(env,actor,OPERATORS);
    await assertConnectionAvailable(env,actor,grantId,provider,operation);
    if(isPaused())throw new HttpError(409,'agent_paused','Your agent was paused.');
  };
  const result=sessions?await sessions.read({userId:actor.userId,grantId,provider},client,guard,continuation):await calendarDirectory(client,guard);
  return {calendars:result.items,incomplete:result.incomplete,...('continuation' in result&&result.continuation?{continuation:result.continuation}:{})};
}
