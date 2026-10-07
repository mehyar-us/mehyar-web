import type {Actor,Env} from './env';
import {OPERATORS,requireMembership} from './permissions';
import {readMemory} from './memory';
import {publicWebsiteUrl} from './website';
import {capabilityStatus} from './auth/capabilities';

export type CalendarProvider='google'|'microsoft'|'zoho';
export const calendarLabels={google:'Google Calendar',microsoft:'Microsoft Outlook',zoho:'Zoho Calendar'};
export function providerFromMx(host:string):CalendarProvider|null{
 const value=host.toLowerCase().replace(/\.$/,'');
 if(value==='smtp.google.com'||value==='aspmx.l.google.com'||/^alt[1-4]\.aspmx\.l\.google\.com$/.test(value))return 'google';
 if(value.endsWith('.mail.protection.outlook.com'))return 'microsoft';
 if(/^mx[23]?\.(?:zoho\.(?:com|eu|in|com\.au|jp|ca)|zohomail\.(?:com|eu|in))$/.test(value))return 'zoho';
 return null;
}
export async function calendarDnsHint(website:string,appOrigin:string,transport:typeof fetch=fetch){
 const domain=publicWebsiteUrl(website,appOrigin).hostname.replace(/^www\./,'');
 const response=await transport('https://cloudflare-dns.com/dns-query?'+new URLSearchParams({name:domain,type:'MX'}),{headers:{accept:'application/dns-json'},signal:AbortSignal.timeout(4000),redirect:'manual'});
 if(!response.ok)throw new Error(`DNS unavailable (HTTP ${response.status})`);
 const reader=response.body?.getReader();if(!reader)throw new Error('Empty DNS response');
 const decoder=new TextDecoder();let raw='',bytes=0;
 for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;
  if(bytes>32768){await reader.cancel();throw new Error('DNS response too large');}raw+=decoder.decode(chunk.value,{stream:true});}
 raw+=decoder.decode();
 const data=JSON.parse(raw);if(data.Status!==0)throw new Error('DNS lookup unsuccessful');
 const records=Array.isArray(data.Answer)?data.Answer.slice(0,30):[];
 const providers=[...new Set<CalendarProvider>(records.filter((r:any)=>r.type===15&&typeof r.data==='string').map((r:any)=>providerFromMx(r.data.trim().replace(/^\d+\s+/,''))).filter(Boolean))];
 return {domain,providers};
}
export function asksCalendarConnection(text:string){
 return !/\b(?:do not|don't|never)\b/i.test(text)&&(/\b(?:connect|reconnect|link|relink)\b/i.test(text)||/\b(?:i|we) use (?:google|microsoft|outlook|zoho)(?: calendar)?[.!]?$/i.test(text))&&/\b(?:calendar|google|microsoft|outlook|zoho)\b/i.test(text)&&!/\b(?:book|cancel|reschedule|disconnect)\b/i.test(text);
}
export function calendarProviderMention(text:string):CalendarProvider|undefined{
 const matches=(['google','microsoft','zoho'] as const).filter(provider=>new RegExp(`\\b${provider==='microsoft'?'(?:microsoft|outlook)':provider}\\b`,'i').test(text));
 return matches.length===1?matches[0]:undefined;
}
export async function calendarGuide(env:Env,actor:Actor,website?:string,transport:typeof fetch=fetch,preferred?:CalendarProvider){
 await requireMembership(env,actor,OPERATORS);
 const memory=await readMemory(env,actor);
 const grants=await env.AGENT_DB.prepare("SELECT provider,status,selected_capabilities FROM auth_provider_grants WHERE tenant_scope=? AND user_id=? AND status!='revoked' ORDER BY updated_at DESC").bind(actor.tenantId,actor.userId).all<{provider:string;status:string;selected_capabilities:string}>();
 const capabilities=capabilityStatus(env).providers;
 const providers=(['google','microsoft','zoho'] as const).map(id=>{
  const grant=grants.results.find(g=>g.provider===id&&JSON.parse(g.selected_capabilities).some((c:string)=>c==='calendar_read'||c==='calendar_manage'));
  const available=capabilities[id].capabilities.some(c=>c.id==='calendar_manage'&&c.enabled);
  return {id,label:calendarLabels[id],available,status:grant?.status??'not_connected'};
 });
 let hint:Awaited<ReturnType<typeof calendarDnsHint>>|null=null;
 let dnsStatus:'not_requested'|'checked'|'unavailable'|'rate_limited'='not_requested';
 const target=website||memory.profile.website;
 if(target){
  // Bounded per-tenant public DNS research; status/buttons remain usable on failure.
  const row=await env.AGENT_DB.prepare('INSERT INTO mayor_rate_limits(subject,bucket,count) VALUES(?,?,1) ON CONFLICT(subject,bucket) DO UPDATE SET count=count+1 RETURNING count').bind('calendar-dns:'+actor.tenantId,Math.floor(Date.now()/60000)).first<{count:number}>();
  if(row&&row.count<=3){try{hint=await calendarDnsHint(target,env.APP_ORIGIN,transport);dnsStatus='checked';}catch{dnsStatus='unavailable';}}
  else dnsStatus='rate_limited';
 }
 await requireMembership(env,actor,OPERATORS);
 const detected=hint?.providers.length===1?hint.providers[0]:null;
 const suggested=preferred??detected;
 const chosen=providers.find(p=>p.id===preferred);
 const intro=detected?`${hint!.domain}’s email records point to ${detected==='zoho'?'Zoho Mail':detected==='google'?'Google':'Microsoft'}. You may use its calendar too.`:dnsStatus==='unavailable'?'I couldn’t check your website’s email provider just now. You can still choose your calendar below.':dnsStatus==='rate_limited'?'Let’s choose your calendar below. We can check the website again in a minute.':target?'Your website doesn’t point to one clear email provider.':'Let’s connect the calendar you use for work.';
 const reconnect=providers.find(p=>p.status==='reconnect_required');
 const message=chosen?.available&&chosen.status==='authorized'?`${chosen.label} is connected. Which calendar should I use for appointments?`:chosen?chosen.available?`Let’s ${chosen.status==='not_connected'?'connect':'reconnect'} ${chosen.label}. Use its button below, then I’ll help you choose the right calendar. Is this the calendar you use for customer appointments?`:`Got it—you use ${chosen.label}. That connection still needs setup on our side. I haven’t connected or changed your calendar. While that’s being prepared, what kinds of appointments should I help you manage?`:`${intro} ${reconnect?`${reconnect.label} needs reconnecting—use its button below.`:'Choose your provider below to connect or pick a calendar.'} Do you use ${suggested?calendarLabels[suggested]:'Google, Microsoft, or Zoho'} for appointments?`;
 return {providers,hint,suggested,preferred:preferred??null,dnsStatus,message,website:target??null};
}
