import type {Actor,Env} from './env';
import {discoverCalendars} from './calendars';
import {readSchedulingSetup} from './scheduling-setup';
import {OPERATORS,requireMembership} from './permissions';

export function asksCalendarInventory(text:string){
 const request=text.replace(/\b(?:do not|don't|without)\s+(?:save|change|modify|create|delete)[^.?!]*/gi,'');
 return /\bcalendars\b/i.test(request)&&/\b(?:list|show|which|what|check)\b/i.test(request)
  && !/\b(?:book|reschedule|cancel|create|delete|disconnect|connect|reconnect|select|switch|change|save)\b/i.test(request);
}
export async function calendarInventory(env:Env,actor:Actor,transport:typeof fetch=fetch){
 await requireMembership(env,actor,OPERATORS);
 const grants=await env.AGENT_DB.prepare("SELECT id,provider FROM auth_provider_grants WHERE tenant_scope=? AND user_id=? AND status='authorized' AND provider IN ('google','microsoft','zoho') LIMIT 10").bind(actor.tenantId,actor.userId).all<{id:string;provider:'google'|'microsoft'|'zoho'}>();
 const labels={google:'Google',microsoft:'Microsoft',zoho:'Zoho'};
 const connections=await Promise.all(grants.results.map(async grant=>{
  try{const result=await discoverCalendars(env,actor,{provider:grant.provider,grantId:grant.id},transport);return {provider:grant.provider,calendars:result.calendars,available:true};}
  catch{return {provider:grant.provider,calendars:[],available:false};}
 }));
 const setup=await readSchedulingSetup(env,actor);
 await requireMembership(env,actor,OPERATORS);
 const lines=connections.map(c=>c.available?`${labels[c.provider]}: ${c.calendars.length} calendar${c.calendars.length===1?'':'s'} available.`:`${labels[c.provider]}: I couldn’t read its calendars; check the connection.`);
 const scheduling=setup.active?'Your appointment rules are active.':`Appointment rules aren’t active yet. ${setup.nextQuestion??'Your saved details are ready to review.'}`;
 return {connections,setup,message:[lines.length?lines.join(' '):'No authorized calendar connections were found for your account.',scheduling].join(' ')};
}
