import {it,expect} from 'vitest';
import {env as testEnv} from 'cloudflare:workers';
import type {Env} from '../../src/env';
import {asksCalendarInventory,calendarInventory} from '../../src/calendar-inventory';
it.each(['List my connected calendars and read the saved scheduling rules. Do not change business memory or calendar events.','Which calendars are connected?','Show my calendars'])('recognizes read-only inventory: %s',text=>expect(asksCalendarInventory(text)).toBe(true));
it.each(['Connect my calendars','List calendars and book an appointment','Show my calendars and delete one','Change my calendars','Reschedule tomorrow'])('does not swallow actions: %s',text=>expect(asksCalendarInventory(text)).toBe(false));
it('reads missing scheduling progress without saving anything and refuses an outsider',async()=>{
 const env=testEnv as unknown as Env,actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Inventory fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const result=await calendarInventory(env,actor,async()=>{throw Error('No provider request expected');});
 expect(result.connections).toEqual([]);expect(result.message).toContain('No authorized calendar');expect(result.message).toContain('aren’t active');expect(result.setup.nextQuestion).toBeTruthy();
 expect(await env.AGENT_DB.prepare('SELECT tenant_id FROM mayor_memory WHERE tenant_id=?').bind(actor.tenantId).first()).toBeNull();
 await expect(calendarInventory(env,{...actor,userId:crypto.randomUUID()})).rejects.toThrow();
});
it.each(['inventory','setup','booking','booking_confirmation'])('answers the %s chat request without model calls or confirmation state',async mode=>{
 const {MayorVoice}=await import('../../src/voice');
 const env=testEnv as unknown as Env,actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Voice inventory fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const voice=Object.create(MayorVoice.prototype) as any;
 for(const field of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();
 Object.assign(voice,{env:{...env,AI:{run:()=>{throw Error('Inventory must not depend on the model');}}},ready:new Set(),authorize:async()=>actor});
 const events:any[]=[];
 const answer=await voice.onTurn(mode==='booking_confirmation'?'Yes, book it.':mode==='booking'?'Prepare a disposable integration-test appointment called Mayor calendar acceptance test on October 1, 2026, 10:00–10:15 AM America/New_York, only in Google calendar The Mayor — Integration Tests, without guests. Do not save business scheduling rules or change the selected Zoho calendar.':mode==='inventory'?'For a read-only integration check, list my connected calendars and read the saved scheduling rules. Do not change business memory or calendar events.':'Help me finish my appointment scheduling rules. Ask one missing question at a time.',{connection:{id:'inventory',send:(data:string)=>events.push(JSON.parse(data))},signal:new AbortController().signal,messages:[]});
 if(mode==='inventory'){expect(answer).toContain('No authorized calendar');expect(events.some(event=>event.type==='calendar_inventory')).toBe(true);}
 else if(mode==='booking_confirmation')expect(answer).toContain('isn’t an appointment ready');
 else if(mode==='setup') expect(answer).toBe('What time zone does your business use?');
 else {expect(answer).toContain('I can help book appointments');expect(answer).toContain('selected scheduling calendar');expect(answer).toContain('What time zone');expect(await env.AGENT_DB.prepare('SELECT tenant_id FROM mayor_memory WHERE tenant_id=?').bind(actor.tenantId).first()).toBeNull();}
 expect(voice.ready.size).toBe(0);
});
