import {env as testEnv} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {confirmProfile} from '../../src/memory';
import {runDetectors} from '../../src/proactive-detectors';
import {createSuggestionCard,listSuggestionCards} from '../../src/proactive';

const env=testEnv as unknown as Env;
const TZ='America/New_York';
const NOW=Date.parse('2026-10-08T12:00:00Z');

async function fixture(){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)')
  .bind(actor.tenantId,'Ranked list fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')")
  .bind(actor.tenantId,actor.userId).run();
 await confirmProfile(env,actor,{name:'Ranked Salon',vertical:'salon',timeZone:TZ},0);
 return actor;
}
async function addMissedCall(tenantId:string,minutesAgo:number,caller:string){
 const id=crypto.randomUUID();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_missed_calls(id,tenant_id,caller_number,business_number,occurred_at,source,status,textback_sent_at)
  VALUES(?,?,?,?,?,'test','missed',NULL)`)
  .bind(id,tenantId,caller,'+17477772687',new Date(NOW-minutesAgo*60000).toISOString()).run();
}
async function addCustomer(actor:{tenantId:string;userId:string},name:string,phone:string){
 const id=crypto.randomUUID(),now=new Date().toISOString();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_customers(id,tenant_id,name,name_key,email,phone,confirmed_by,created_at,updated_at)
  VALUES(?,?,?,?,NULL,?,?,?,?)`).bind(id,actor.tenantId,name,name.toLowerCase(),phone,actor.userId,now,now).run();
 return id;
}
async function addBooking(actor:{tenantId:string;userId:string},customerId:string,startMs:number){
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const input=JSON.stringify({title:'Cut',appointmentType:'Cut',start:new Date(startMs).toISOString(),end:new Date(startMs+1800000).toISOString(),attendees:[]});
 await env.AGENT_DB.prepare(`INSERT INTO mayor_appointment_jobs(id,tenant_id,actor_id,provider,grant_id,calendar_id,authorization_stamp,policy_revision,input_json,reserved_start,reserved_end,state,expires_at,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .bind(id,actor.tenantId,actor.userId,'google','g1','c1','stamp',1,input,new Date(startMs).toISOString(),new Date(startMs+1800000).toISOString(),'applied',now,now,now).run();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_appointments(id,tenant_id,provider,calendar_id,event_id,input_json,state,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?)`).bind(id,actor.tenantId,'google','c1','e1',input,'confirmed',now,now).run();
 await env.AGENT_DB.prepare('INSERT INTO mayor_appointment_customers(booking_id,tenant_id,customer_id,customer_revision) VALUES(?,?,?,1)')
  .bind(id,actor.tenantId,customerId).run();
}

/* WS1 build 3 (2026-10-17): the card list is the ranked queue —
 * strongest evidence first inside the pending group, regardless of
 * which card was created first. */
describe('ranked suggestion list',()=>{
 it('orders pending cards by confidence level before recency',async()=>{
  const actor=await fixture();
  // Lapsed regular (level 2) detected FIRST, missed call (level 3) second.
  const lapsed=await addCustomer(actor,'Lapsed Laura','+17185550001');
  await addBooking(actor,lapsed,NOW-60*86400000);
  await addMissedCall(actor.tenantId,20,'+17185550009');
  const {context,created}=await runDetectors(env,actor.tenantId,NOW);
  expect(created.map(d=>d.detector)).toEqual(expect.arrayContaining(['lapsed_regular','missed_call_followup']));
  for(const d of created)await createSuggestionCard(env,context,d);
  const {cards}=await listSuggestionCards(env,actor);
  const pending=cards.filter(c=>c.state==='pending');
  expect(pending.length).toBeGreaterThanOrEqual(2);
  expect(pending[0].detector).toBe('missed_call_followup');
  expect(pending[0].confidence).toBe(3);
  const lapsedCard=pending.find(c=>c.detector==='lapsed_regular');
  expect(lapsedCard?.confidence).toBe(2);
  expect(pending.indexOf(lapsedCard!)).toBeGreaterThan(0);
 });
});
