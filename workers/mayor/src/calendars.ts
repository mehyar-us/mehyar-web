import {calendarClient,calendarOperations} from './connectors/calendar-provider';
import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError} from './http';
import {OPERATORS,requireMembership} from './permissions';
import {connectorCredential,connectionAuthorizationStamp,connectionAuthorizationSnapshot} from './connectors/credentials';
import {GoogleCalendarClient,GOOGLE_CALENDAR_OPERATIONS} from './connectors/google-calendar';
import {MicrosoftCalendarClient,MICROSOFT_CALENDAR_OPERATIONS} from './connectors/microsoft-calendar';
import type {Calendar,Provider} from './connectors/types';

export const calendarConnectionSchema=z.object({provider:z.enum(['google','microsoft','zoho']),grantId:z.string().min(1).max(256)}).strict();
export const calendarSelectionSchema=calendarConnectionSchema.extend({calendarId:z.string().min(1).max(2048)});
type Connection=z.infer<typeof calendarConnectionSchema>;
const operation=(provider:Provider)=>calendarOperations(provider).list;
export async function discoverCalendars(env:Env,actor:Actor,input:Connection,transport:typeof fetch=fetch){
 await requireMembership(env,actor,OPERATORS);
 const op=operation(input.provider);
 const stamp=await connectionAuthorizationStamp(env,actor,input.grantId,input.provider,op);
 const auth=await connectorCredential(env,actor,input.grantId,input.provider,op,transport);
 const client=calendarClient(input.provider,auth,{fetch:transport});
 const calendars:Calendar[]=[];const cursors=new Set<string>();let cursor:string|undefined;
 for(let page=0;page<20;page++){
  const result=await client.listCalendars(cursor);
  for(const item of result.items){
   if(typeof item.id!=='string'||!item.id||item.id.length>2048||typeof item.name!=='string'||item.name.length>4096||typeof item.canWrite!=='boolean')throw new HttpError(502,'invalid_calendar','The provider returned an invalid calendar.');
   if(!calendars.some(c=>c.id===item.id))calendars.push(item);
  }
  cursor=result.nextCursor;
  if(!cursor)break;
  if(cursors.has(cursor)||page===19)throw new HttpError(409,'calendar_directory_incomplete','The calendar list is too large or incomplete. Please retry.');
  cursors.add(cursor);
 }
 if(stamp!==await connectionAuthorizationStamp(env,actor,input.grantId,input.provider,op))throw new HttpError(409,'connection_changed','Your connection changed. Please reload your calendars.');
 return {calendars,stamp};
}
export async function selectCalendar(env:Env,actor:Actor,input:z.infer<typeof calendarSelectionSchema>,transport:typeof fetch=fetch){
 const {calendars,stamp}=await discoverCalendars(env,actor,input,transport);
 const calendar=calendars.find(c=>c.id===input.calendarId);
 if(!calendar?.canWrite)throw new HttpError(403,'calendar_not_writable','Choose a calendar you can edit.');
 await requireMembership(env,actor,OPERATORS);
 const consent=await connectionAuthorizationSnapshot(env,actor,input.grantId,input.provider,operation(input.provider));
 if(consent.stamp!==stamp)throw new HttpError(409,'connection_changed','Your connection changed. Please reload your calendars.');
 const now=new Date().toISOString();
 const [saved]=await env.AGENT_DB.batch([
  env.AGENT_DB.prepare(`INSERT INTO mayor_calendar_selection(tenant_id,grant_id,provider,calendar_id,calendar_name,authorization_stamp,updated_by,updated_at)
   SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(
    SELECT 1 FROM auth_provider_grants g
    JOIN agent_memberships owner ON owner.tenant_id=g.tenant_scope AND owner.user_id=g.user_id
    JOIN agent_tenants t ON t.id=g.tenant_scope AND t.status='active'
    JOIN agent_memberships actor ON actor.tenant_id=t.id AND actor.user_id=?
    WHERE g.id=? AND g.tenant_scope=? AND g.provider=? AND g.status='authorized'
     AND g.user_id=? AND g.account_id=? AND g.authorization_revision=? AND g.granted_scopes=?
     AND g.key_version=1 AND length(g.ciphertext)>0
     AND owner.status='active' AND owner.role IN ('owner','manager') AND (owner.expires_at IS NULL OR owner.expires_at>?)
     AND actor.status='active' AND actor.role IN ('owner','manager') AND (actor.expires_at IS NULL OR actor.expires_at>?)
   ) ON CONFLICT(tenant_id) DO UPDATE SET grant_id=excluded.grant_id,provider=excluded.provider,
   calendar_id=excluded.calendar_id,calendar_name=excluded.calendar_name,authorization_stamp=excluded.authorization_stamp,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
   .bind(actor.tenantId,input.grantId,input.provider,calendar.id,calendar.name,stamp,actor.userId,now,
    actor.userId,input.grantId,actor.tenantId,input.provider,consent.userId,consent.accountId,consent.revision,consent.grantedScopes,now,now),
  env.AGENT_DB.prepare('INSERT INTO mayor_audit(id,tenant_id,actor_id,event,created_at) SELECT ?,?,?,?,? WHERE changes()=1')
   .bind(crypto.randomUUID(),actor.tenantId,actor.userId,'calendar_selected',now),
 ]);
 if(saved.meta.changes!==1)throw new HttpError(409,'connection_changed','Your connection or permissions changed. Please reload your calendars.');
 return {calendar,provider:input.provider,grantId:input.grantId};
}
export async function selectedCalendar(env:Env,actor:Actor){
 await requireMembership(env,actor,OPERATORS);
 const row=await env.AGENT_DB.prepare('SELECT * FROM mayor_calendar_selection WHERE tenant_id=?').bind(actor.tenantId)
  .first<{provider:Provider;grant_id:string;calendar_id:string;calendar_name:string;authorization_stamp:string}>();
 if(!row)return null;
 let available=false;
 try{available=row.authorization_stamp===await connectionAuthorizationStamp(env,actor,row.grant_id,row.provider,operation(row.provider));}catch(error){if(!(error instanceof HttpError))throw error;}
 // Unavailable provider consent is displayable; lost workspace access is not.
 await requireMembership(env,actor,OPERATORS);
 return {provider:row.provider,grantId:row.grant_id,calendar:{id:row.calendar_id,name:row.calendar_name},available};
}
