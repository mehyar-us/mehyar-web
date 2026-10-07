import {env as testEnv} from 'cloudflare:workers';
import {it,expect,vi} from 'vitest';
import type {Env} from '../../src/env';
import {calendarGuide,calendarDnsHint,providerFromMx,asksCalendarConnection} from '../../src/calendar-guide';
import {MayorVoice} from '../../src/voice';
async function fixture(){const env=testEnv as unknown as Env,actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Calendar guide',new Date().toISOString()).run();await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();return {env,actor};}
it('uses exact mail-provider domains, never arbitrary substring claims',()=>{
 for(const host of ['smtp.google.com.','aspmx.l.google.com','alt4.aspmx.l.google.com'])expect(providerFromMx(host)).toBe('google');
 expect(providerFromMx('example.mail.protection.outlook.com')).toBe('microsoft');expect(providerFromMx('mx2.zoho.eu')).toBe('zoho');
 for(const host of ['smtp.google.com.evil.net','mx.zoho.com.evil.net','mail.google.com','proofpoint.com'])expect(providerFromMx(host)).toBeNull();
 expect(asksCalendarConnection('Reconnect my Google calendar')).toBe(true);expect(asksCalendarConnection("Don't reconnect my calendar")).toBe(false);expect(asksCalendarConnection('Reconnect and cancel my appointment')).toBe(false);
 expect(asksCalendarConnection('I use Zoho')).toBe(true);expect(asksCalendarConnection('We use Microsoft calendar.')).toBe(true);expect(asksCalendarConnection('I use Zoho to cancel appointments')).toBe(false);
});
it('queries only fixed public DNS endpoint with hostname and preserves ambiguous evidence',async()=>{
 const transport=vi.fn(async(url:any,init:any)=>{expect(String(url)).toBe('https://cloudflare-dns.com/dns-query?name=business.com&type=MX');expect(init.redirect).toBe('manual');expect(init.headers.authorization).toBeUndefined();return Response.json({Status:0,Answer:[{type:15,data:'10 smtp.google.com.'},{type:15,data:'20 mx.zoho.com.'}]});}) as unknown as typeof fetch;
 expect((await calendarDnsHint('https://www.business.com/about','https://mayor.mehyar.us',transport)).providers).toEqual(['google','zoho']);
 await expect(calendarDnsHint('https://127.0.0.1','https://mayor.mehyar.us',transport)).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(1);
});
it('keeps guide usable when DNS fails and does not invent unavailable integrations',async()=>{
 const {env,actor}=await fixture();const result=await calendarGuide(env,actor,'https://business.com',async()=>{throw new Error('timeout');});
 expect(result.suggested).toBeNull();expect(result.providers.find(p=>p.id==='zoho')?.available).toBe(false);expect(result.message).toContain('Do you use');
 expect(result.dnsStatus).toBe('unavailable');expect(result.message).toContain('couldn’t check');
 await expect(calendarGuide(env,{...actor,userId:'other'})).rejects.toThrow();
});
it('rejects DNS redirects and oversized responses without treating either as a provider hint',async()=>{
 await expect(calendarDnsHint('https://business.com','https://mayor.example.test',async()=>new Response(null,{status:302,headers:{location:'https://evil.example'}}))).rejects.toThrow('HTTP 302');
 await expect(calendarDnsHint('https://business.com','https://mayor.example.test',async()=>new Response('x'.repeat(32769)))).rejects.toThrow('too large');
});
it('suggests Zoho from MX without selecting or connecting an account',async()=>{
 const {env,actor}=await fixture();const result=await calendarGuide(env,actor,'https://mehyar.us',async()=>Response.json({Status:0,Answer:[{type:15,data:'10 mx.zoho.com.'}]}));
 expect(result.suggested).toBe('zoho');expect(result.dnsStatus).toBe('checked');expect(result.message).toContain('Do you use Zoho Calendar');
 expect(result.providers.every(p=>p.status==='not_connected')).toBe(true);
 expect(await env.AGENT_DB.prepare('SELECT * FROM mayor_calendar_selection WHERE tenant_id=?').bind(actor.tenantId).first()).toBeNull();
});
it('rechecks membership after DNS and keeps suggestions separate from connection state',async()=>{
 const {env,actor}=await fixture();const transport=(async()=>{await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(actor.tenantId).run();return Response.json({Status:0,Answer:[{type:15,data:'10 smtp.google.com.'}]});}) as typeof fetch;
 await expect(calendarGuide(env,actor,'https://business.com',transport)).rejects.toThrow();
});
it('opens chat connection actions without requiring the model or arming old confirmations',async()=>{
 const {env,actor}=await fixture();const voice=Object.create(MayorVoice.prototype) as any;
 for(const name of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[name]=new Map();
 const run=vi.fn(()=>{throw new Error('model unavailable');}),events:any[]=[];Object.assign(voice,{env:{...env,AI:{run}},ready:new Set(['guide']),authorize:async()=>actor});voice.pending.set('guide',{patch:{name:'Old'}});
 const reply=await voice.onTurn('Reconnect my Google calendar',{connection:{id:'guide',send:(event:string)=>events.push(JSON.parse(event))},signal:new AbortController().signal,messages:[]});
 expect(reply).toContain('Google Calendar');expect(events.some(e=>e.type==='calendar_connection_guide')).toBe(true);expect(run).not.toHaveBeenCalled();expect(voice.pending.size).toBe(0);expect(voice.ready.size).toBe(0);
});
it('respects the stated calendar choice even when email DNS belongs to another provider',async()=>{
 const {env,actor}=await fixture();const result=await calendarGuide(env,actor,'https://business.com',async()=>Response.json({Status:0,Answer:[{type:15,data:'10 smtp.google.com.'}]}),'zoho');
 expect(result.suggested).toBe('zoho');expect(result.preferred).toBe('zoho');expect(result.hint?.providers).toEqual(['google']);expect(result.message).toContain('you use Zoho Calendar');expect(result.message).toContain('what kinds of appointments');
});
