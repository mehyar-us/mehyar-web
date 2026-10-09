import {env as testEnv} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {runDetectors,loadProactiveContext,localDayKey,shiftLocalDate,localParts} from '../../src/proactive-detectors';
import {confirmProfile} from '../../src/memory';
import {
 createSuggestionCard,runProactiveCycle,surfaceGate,logNudge,buildBriefing,buildRoi,
 setRoiConfig,seedRoiEvents,recordNoShow,listSuggestionCards,sendSuggestionCard,
 editSuggestionCard,dismissSuggestionCard,setProactiveSettings,
} from '../../src/proactive';

const env=testEnv as unknown as Env;
const TZ='America/New_York';
// Thursday 2026-10-08 08:00 EDT — outside quiet hours, inside business hours.
const NOW=Date.parse('2026-10-08T12:00:00Z');
const WD={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6} as const;

async function fixture(){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)')
  .bind(actor.tenantId,'Proactive fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')")
  .bind(actor.tenantId,actor.userId).run();
 await confirmProfile(env,actor,{name:'Test Salon',vertical:'salon',timeZone:TZ},0);
 return actor;
}
async function setPolicy(actor:{tenantId:string;userId:string},weekday:number){
 const policy={timeZone:TZ,weeklyHours:[{day:weekday,startMinute:540,endMinute:1020}],closedDates:[],
  appointmentTypes:[{name:'Cut',durationMinutes:30,bufferBeforeMinutes:0,bufferAfterMinutes:0}],
  staff:[],minimumNoticeMinutes:60,maximumAdvanceDays:30,cancellationNoticeMinutes:60};
 const now=new Date().toISOString();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_memory(tenant_id,field,value_json,source_kind,confirmed_by,confirmed_at,revision,updated_at)
  VALUES(?,'scheduling_policy',?,'owner_confirmed',?,?,1,?)`)
  .bind(actor.tenantId,JSON.stringify(policy),actor.userId,now,now).run();
}
async function addMissedCall(actor:{tenantId:string},minutesAgo:number,caller='+17185551212',texted=false){
 const id=crypto.randomUUID();
 const occurred=new Date(NOW-minutesAgo*60000).toISOString();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_missed_calls(id,tenant_id,caller_number,business_number,occurred_at,source,status,textback_sent_at)
  VALUES(?,?,?,?,?,'test','missed',?)`)
  .bind(id,actor.tenantId,caller,'+17477772687',occurred,texted?occurred:null).run();
 return id;
}
async function addCustomer(actor:{tenantId:string;userId:string},name:string,phone:string){
 const id=crypto.randomUUID(),now=new Date().toISOString();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_customers(id,tenant_id,name,name_key,email,phone,confirmed_by,created_at,updated_at)
  VALUES(?,?,?,?,NULL,?,?,?,?)`).bind(id,actor.tenantId,name,name.toLowerCase(),phone,actor.userId,now,now).run();
 return id;
}
async function addBooking(actor:{tenantId:string;userId:string},customerId:string|null,startMs:number,endMs:number,state='confirmed'){
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const input=JSON.stringify({title:'Cut',appointmentType:'Cut',start:new Date(startMs).toISOString(),end:new Date(endMs).toISOString(),attendees:[]});
 await env.AGENT_DB.prepare(`INSERT INTO mayor_appointment_jobs(id,tenant_id,actor_id,provider,grant_id,calendar_id,authorization_stamp,policy_revision,input_json,reserved_start,reserved_end,state,expires_at,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .bind(id,actor.tenantId,actor.userId,'google','g1','c1','stamp',1,input,new Date(startMs).toISOString(),new Date(endMs).toISOString(),'applied',now,now,now).run();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_appointments(id,tenant_id,provider,calendar_id,event_id,input_json,state,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?)`).bind(id,actor.tenantId,'google','c1','e1',input,state,now,now).run();
 if(customerId)await env.AGENT_DB.prepare('INSERT INTO mayor_appointment_customers(booking_id,tenant_id,customer_id,customer_revision) VALUES(?,?,?,1)')
  .bind(id,actor.tenantId,customerId).run();
 return id;
}
async function addSms(actor:{tenantId:string},direction:'inbound'|'outbound',from:string,to:string,minutesAgo:number,status='sent'){
 const created=new Date(NOW-minutesAgo*60000).toISOString();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_sms_log(id,tenant_id,direction,to_number,from_number,body,created_at,provider_message_id,status)
  VALUES(?,?,?,?,?,?,?,NULL,?)`).bind(crypto.randomUUID(),actor.tenantId,direction,to,from,'test body',created,status).run();
}
const detectionKinds=(rows:{detector:string}[])=>rows.map(r=>r.detector);

describe('missed-call followup detector',()=>{
 it('fires when no text-back went out within 15 minutes',async()=>{
  const actor=await fixture();
  const id=await addMissedCall(actor,20);
  const {created}=await runDetectors(env,actor.tenantId,NOW);
  expect(detectionKinds(created)).toContain('missed_call_followup');
  expect(created.find(d=>d.detector==='missed_call_followup')!.dedupe_key).toBe(`mc:${id}`);
 });
 it('is idempotent on re-run',async()=>{
  const actor=await fixture();
  await addMissedCall(actor,20);
  await runDetectors(env,actor.tenantId,NOW);
  const again=await runDetectors(env,actor.tenantId,NOW);
  expect(again.created).toHaveLength(0);
 });
 it('stays quiet when a text-back already went out',async()=>{
  const actor=await fixture();
  await addMissedCall(actor,20,'+17185551212',true);
  const {created}=await runDetectors(env,actor.tenantId,NOW);
  expect(detectionKinds(created)).not.toContain('missed_call_followup');
 });
 it('stays quiet when any outbound follow-up exists',async()=>{
  const actor=await fixture();
  await addMissedCall(actor,20);
  await addSms(actor,'outbound','+17477772687','+17185551212',10);
  const {created}=await runDetectors(env,actor.tenantId,NOW);
  expect(detectionKinds(created)).not.toContain('missed_call_followup');
 });
 it('does not fire inside the 15-minute grace window',async()=>{
  const actor=await fixture();
  await addMissedCall(actor,5);
  const {created}=await runDetectors(env,actor.tenantId,NOW);
  expect(detectionKinds(created)).not.toContain('missed_call_followup');
 });
});

describe('slow-day detector',()=>{
 it('fires on a >=2h open gap tomorrow',async()=>{
  const actor=await fixture();
  const weekday=WD[localParts(NOW+86400000,TZ).weekday as keyof typeof WD];
  await setPolicy(actor,weekday);
  const {created}=await runDetectors(env,actor.tenantId,NOW);
  const slow=created.find(d=>d.detector==='slow_day');
  expect(slow).toBeDefined();
  expect(slow!.dedupe_key).toBe(`day:${shiftLocalDate(localDayKey(NOW,TZ),1)}`);
  expect((JSON.parse(slow!.payload_json) as {maxGapMinutes:number}).maxGapMinutes).toBe(480);
 });
 it('stays quiet without a scheduling policy',async()=>{
  const actor=await fixture();
  const {created}=await runDetectors(env,actor.tenantId,NOW);
  expect(detectionKinds(created)).not.toContain('slow_day');
 });
 it('shrinks the gap when a booking lands',async()=>{
  const actor=await fixture();
  const weekday=WD[localParts(NOW+86400000,TZ).weekday as keyof typeof WD];
  await setPolicy(actor,weekday);
  // Book 09:00–13:00 local tomorrow (13:00–17:00Z in October EDT).
  const day=shiftLocalDate(localDayKey(NOW,TZ),1);
  const [y,m,d]=day.split('-').map(Number);
  await addBooking(actor,null,Date.UTC(y,m-1,d,13,0),Date.UTC(y,m-1,d,17,0));
  const {created}=await runDetectors(env,actor.tenantId,NOW);
  const slow=created.find(d=>d.detector==='slow_day');
  expect(slow).toBeDefined();
  expect((JSON.parse(slow!.payload_json) as {maxGapMinutes:number}).maxGapMinutes).toBe(240);
 });
});

describe('lapsed-regular detector',()=>{
 it('finds customers past the salon 45-day window only',async()=>{
  const actor=await fixture();
  const lapsed=await addCustomer(actor,'Lapsed Laura','+17185550001');
  const fresh=await addCustomer(actor,'Fresh Fred','+17185550002');
  await addBooking(actor,lapsed,NOW-60*86400000,NOW-60*86400000+1800000);
  await addBooking(actor,fresh,NOW-10*86400000,NOW-10*86400000+1800000);
  const {created}=await runDetectors(env,actor.tenantId,NOW);
  const det=created.find(d=>d.detector==='lapsed_regular');
  expect(det).toBeDefined();
  const payload=JSON.parse(det!.payload_json) as {count:number;customers:{name:string}[]};
  expect(payload.count).toBe(1);
  expect(payload.customers[0].name).toBe('Lapsed Laura');
 });
});

describe('unanswered-lead detector',()=>{
 it('fires on an inbound SMS with no reply after 2h',async()=>{
  const actor=await fixture();
  await addSms(actor,'inbound','+17185550003','+17477772687',180);
  const {created}=await runDetectors(env,actor.tenantId,NOW);
  expect(detectionKinds(created)).toContain('unanswered_lead');
 });
 it('stays quiet when the lead got a reply',async()=>{
  const actor=await fixture();
  await addSms(actor,'inbound','+17185550004','+17477772687',180);
  await addSms(actor,'outbound','+17477772687','+17185550004',60);
  const {created}=await runDetectors(env,actor.tenantId,NOW);
  expect(detectionKinds(created)).not.toContain('unanswered_lead');
 });
});

describe('no-show-risk detector',()=>{
 it('fires for at-risk bookings without reminders',async()=>{
  const actor=await fixture();
  const risky=await addCustomer(actor,'Risky Rita','+17185550005');
  const safe=await addCustomer(actor,'Safe Sam','+17185550006');
  await recordNoShow(env,actor,{customerId:risky});
  const riskyBooking=await addBooking(actor,risky,NOW+24*3600000,NOW+24*3600000+1800000);
  const safeBooking=await addBooking(actor,safe,NOW+26*3600000,NOW+26*3600000+1800000);
  await recordNoShow(env,actor,{customerId:safe});
  const now=new Date().toISOString();
  await env.AGENT_DB.prepare(`INSERT INTO mayor_appointment_reminders(id,tenant_id,booking_id,appointment_at,customer_number,reminder_sent_at)
   VALUES(?,?,?,?,?,?)`).bind(crypto.randomUUID(),actor.tenantId,safeBooking,new Date(NOW+26*3600000).toISOString(),'+17185550006',now).run();
  const {created}=await runDetectors(env,actor.tenantId,NOW);
  const risks=created.filter(d=>d.detector==='no_show_risk');
  expect(risks).toHaveLength(1);
  expect(risks[0].dedupe_key).toBe(`booking:${riskyBooking}`);
 });
});

describe('suggestion cards',()=>{
 it('builds a vertical-aware followup card and sends it in simulation',async()=>{
  const actor=await fixture();
  await addMissedCall(actor,20);
  const {context,created}=await runDetectors(env,actor.tenantId,NOW);
  const det=created.find(d=>d.detector==='missed_call_followup')!;
  const card=await createSuggestionCard(env,context,det);
  expect(card!.kind).toBe('followup');
  expect(card!.title).toMatch(/text-back/i);
  expect(card!.draft.message).toContain('Test Salon');
  expect(card!.draft.message.length).toBeLessThan(306);
  const sent=await sendSuggestionCard(env,actor,card!.id);
  expect(sent).toMatchObject({sent:true,simulated:true,audienceCount:1});
  const sms=await env.AGENT_DB.prepare("SELECT status FROM mayor_sms_log WHERE tenant_id=? AND status='simulated'")
   .bind(actor.tenantId).all();
  expect(sms.results.length).toBeGreaterThan(0);
  const state=await env.AGENT_DB.prepare('SELECT state FROM mayor_suggestion_cards WHERE id=?').bind(card!.id).first<{state:string}>();
  expect(state!.state).toBe('sent');
  const detState=await env.AGENT_DB.prepare('SELECT state FROM mayor_proactive_detections WHERE id=?').bind(det.id).first<{state:string}>();
  expect(detState!.state).toBe('resolved');
  const roi=await env.AGENT_DB.prepare("SELECT kind FROM mayor_roi_events WHERE tenant_id=? AND kind='textback_sent'").bind(actor.tenantId).all();
  expect(roi.results.length).toBeGreaterThan(0);
  // Sending again is idempotent.
  expect(await sendSuggestionCard(env,actor,card!.id)).toMatchObject({sent:true,simulated:true});
 });
 it('writes honest winback copy with no invented offers',async()=>{
  const actor=await fixture();
  const lapsed=await addCustomer(actor,'Lapsed Laura','+17185550001');
  await addBooking(actor,lapsed,NOW-60*86400000,NOW-60*86400000+1800000);
  const {context,created}=await runDetectors(env,actor.tenantId,NOW);
  const det=created.find(d=>d.detector==='lapsed_regular')!;
  const card=await createSuggestionCard(env,context,det);
  expect(card!.kind).toBe('winback');
  expect(card!.title).toMatch(/lapsed client/); // salon vocabulary
  expect(card!.body).toMatch(/hasn't booked in 45\+ days/);
  expect(card!.draft.message).not.toMatch(/%|discount|free/i);
  expect(card!.draft.message).toContain('STOP');
  expect(card!.draft.message.length).toBeLessThan(306);
 });
 it('edits and dismisses cards',async()=>{
  const actor=await fixture();
  const lapsed=await addCustomer(actor,'Lapsed Laura','+17185550001');
  await addBooking(actor,lapsed,NOW-60*86400000,NOW-60*86400000+1800000);
  const {context,created}=await runDetectors(env,actor.tenantId,NOW);
  const card=await createSuggestionCard(env,context,created.find(d=>d.detector==='lapsed_regular')!);
  const edited=await editSuggestionCard(env,actor,card!.id,'Hi {name}, custom message here.');
  expect(edited).toMatchObject({state:'edited',message:'Hi {name}, custom message here.'});
  const listed=await listSuggestionCards(env,actor);
  expect(listed.cards[0]).toMatchObject({id:card!.id,state:'edited',kind:'winback',detector:'lapsed_regular'});
  expect(await dismissSuggestionCard(env,actor,card!.id)).toEqual({dismissed:true});
  const detState=await env.AGENT_DB.prepare('SELECT state FROM mayor_proactive_detections WHERE id=?')
   .bind(created.find(d=>d.detector==='lapsed_regular')!.id).first<{state:string}>();
  expect(detState!.state).toBe('dismissed');
 });
 it('rejects sends from non-operators',async()=>{
  const actor=await fixture();
  await addMissedCall(actor,20);
  const {context,created}=await runDetectors(env,actor.tenantId,NOW);
  const card=await createSuggestionCard(env,context,created.find(d=>d.detector==='missed_call_followup')!);
  const staff={tenantId:actor.tenantId,userId:crypto.randomUUID()};
  await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'staff')")
   .bind(actor.tenantId,staff.userId).run();
  await expect(sendSuggestionCard(env,staff,card!.id)).rejects.toThrow();
 });
});

describe('nudge gating',()=>{
 it('caps at 3 nudges per day',async()=>{
  const actor=await fixture();
  const ctx=await loadProactiveContext(env,actor.tenantId,NOW);
  const day=localDayKey(NOW,TZ);
  await logNudge(env,actor.tenantId,'suggestion',day);
  await logNudge(env,actor.tenantId,'suggestion',day);
  expect(await surfaceGate(env,ctx)).toEqual({ok:true});
  await logNudge(env,actor.tenantId,'suggestion',day);
  expect(await surfaceGate(env,ctx)).toEqual({ok:false,reason:'nudge_cap'});
 });
 it('blocks surfacing during quiet hours',async()=>{
  const actor=await fixture();
  const quiet=Date.parse('2026-10-09T02:00:00Z'); // Oct 8 22:00 EDT
  const ctx=await loadProactiveContext(env,actor.tenantId,quiet);
  expect(await surfaceGate(env,ctx)).toEqual({ok:false,reason:'quiet_hours'});
 });
});

describe('briefing honesty',()=>{
 it('never invents dollars without a configured average ticket',async()=>{
  const actor=await fixture();
  const b=await buildBriefing(env,actor,NOW);
  expect(b.yesterday.revenueCents).toBeNull();
  expect(b.businessName).toBe('Test Salon');
  expect(b.vertical).toBe('salon');
  expect(b.generatedAt).toBeTruthy();
  const cfg=await setRoiConfig(env,actor,{avgTicketCents:5000});
  expect(cfg.avgTicketCents).toBe(5000);
  const b2=await buildBriefing(env,actor,NOW);
  expect(b2.yesterday.revenueCents).toBe(0); // no appointments yesterday
 });
 it('rejects invalid average tickets',async()=>{
  const actor=await fixture();
  await expect(setRoiConfig(env,actor,{avgTicketCents:0})).rejects.toThrow();
  await expect(setRoiConfig(env,actor,{avgTicketCents:-100})).rejects.toThrow();
  await expect(setRoiConfig(env,actor,{avgTicketCents:12.5})).rejects.toThrow();
 });
});

describe('ROI',()=>{
 it('reports null revenue until dollars are configured',async()=>{
  const actor=await fixture();
  const roi=await buildRoi(env,actor,undefined,NOW);
  expect(roi.month).toBe('2026-10');
  expect(roi.recoveredRevenueCents).toBeNull();
  expect(roi.revenueSource).toBe('not_configured');
  expect(roi.avgTicketConfigured).toBe(false);
  expect(roi.noShowTrend).toHaveLength(6);
  expect(roi.avgResponseTimeSeconds).toBeNull();
 });
 it('seeds text-back events from real history',async()=>{
  const actor=await fixture();
  await addMissedCall(actor,20,'+17185551212',true);
  const seed=await seedRoiEvents(env,actor.tenantId);
  expect(seed.textbacks).toBe(1);
  const again=await seedRoiEvents(env,actor.tenantId);
  expect(again.textbacks).toBe(1); // idempotent — no duplicate events
  const rows=await env.AGENT_DB.prepare("SELECT COUNT(*) AS n FROM mayor_roi_events WHERE tenant_id=? AND kind='textback_sent'")
   .bind(actor.tenantId).first<{n:number}>();
  expect(rows!.n).toBe(1);
 });
 it('measures response time from real sends only',async()=>{
  const actor=await fixture();
  await addSms(actor,'inbound','+17185550007','+17477772687',60);
  await addSms(actor,'outbound','+17477772687','+17185550007',50,'sent');
  await addSms(actor,'inbound','+17185550008','+17477772687',60);
  await addSms(actor,'outbound','+17477772687','+17185550008',30,'simulated');
  const roi=await buildRoi(env,actor,undefined,NOW);
  expect(roi.avgResponseTimeSeconds).toBe(600); // only the real 10-minute reply counts
 });
 it('credits configured average ticket on recoveries',async()=>{
  const actor=await fixture();
  await addMissedCall(actor,20,'+17185551212',true);
  await env.AGENT_DB.prepare("UPDATE mayor_missed_calls SET booking_id='b1' WHERE tenant_id=?").bind(actor.tenantId).run();
  await setRoiConfig(env,actor,{avgTicketCents:7500});
  const roi=await buildRoi(env,actor,undefined,NOW);
  expect(roi.recoveredRevenueCents).toBe(7500);
  expect(roi.revenueSource).toBe('configured_avg_ticket');
  expect(roi.missedCallsRecovered).toMatchObject({recovered:1,total:1});
 });
});

describe('proactive settings',()=>{
 it('defaults to simulation and toggles live mode',async()=>{
  const actor=await fixture();
  const off=await setProactiveSettings(env,actor,{liveSms:false});
  expect(off.liveSms).toBe(false);
  expect(off.note).toMatch(/simulation/i);
  const on=await setProactiveSettings(env,actor,{liveSms:true});
  expect(on.liveSms).toBe(true);
 });
});

describe('proactive cycle',()=>{
 it('detects, cards, and surfaces within the nudge budget',async()=>{
  const actor=await fixture();
  await addMissedCall(actor,20);
  const summary=await runProactiveCycle(env,NOW);
  expect(summary).toMatchObject({detections:1,cards:1,surfaced:1,briefings:0});
  const notes=await env.AGENT_DB.prepare("SELECT kind FROM mayor_notifications WHERE tenant_id=? AND kind='proactive_suggestion'")
   .bind(actor.tenantId).all();
  expect(notes.results.length).toBe(1);
  // Second run: nothing new, no duplicate cards or notifications.
  const again=await runProactiveCycle(env,NOW);
  expect(again).toMatchObject({detections:0,cards:0,surfaced:0});
 });
 it('surfaces the morning briefing once in the 08:05 window',async()=>{
  const actor=await fixture();
  const at807=Date.parse('2026-10-08T12:07:00Z');
  // The cycle fans out to every tenant; assert on this tenant's own rows.
  await runProactiveCycle(env,at807);
  const notes=await env.AGENT_DB.prepare("SELECT dedupe_key FROM mayor_notifications WHERE tenant_id=? AND kind='proactive_briefing'")
   .bind(actor.tenantId).all<{dedupe_key:string}>();
  expect(notes.results).toHaveLength(1);
  expect(notes.results[0].dedupe_key).toBe('proactive_briefing:2026-10-08');
  const nudges=await env.AGENT_DB.prepare("SELECT COUNT(*) AS n FROM mayor_nudge_log WHERE tenant_id=? AND kind='briefing' AND day_key='2026-10-08'")
   .bind(actor.tenantId).first<{n:number}>();
  expect(nudges!.n).toBe(1);
  await runProactiveCycle(env,at807);
  const again=await env.AGENT_DB.prepare("SELECT COUNT(*) AS n FROM mayor_notifications WHERE tenant_id=? AND kind='proactive_briefing'")
   .bind(actor.tenantId).first<{n:number}>();
  expect(again!.n).toBe(1); // no duplicate briefing
 });
 it('does not surface during quiet hours',async()=>{
  const actor=await fixture();
  await addMissedCall(actor,20);
  const quiet=Date.parse('2026-10-09T02:00:00Z'); // Oct 8 22:00 EDT
  const summary=await runProactiveCycle(env,quiet);
  expect(summary.surfaced).toBe(0);
  expect(summary.briefings).toBe(0);
  const notes=await env.AGENT_DB.prepare("SELECT COUNT(*) AS n FROM mayor_notifications WHERE tenant_id=? AND kind LIKE 'proactive%'")
   .bind(actor.tenantId).first<{n:number}>();
  expect(notes!.n).toBe(0);
 });
});

describe('record-time follow-up cards',()=>{
 it('creates a prepared [Send] [Edit] [Dismiss] card the moment a missed call is recorded',async()=>{
  const actor=await fixture();
  const {recordMissedCall}=await import('../../src/missed-call-textback');
  const call=await recordMissedCall(env,actor,{callerNumber:'+17185551212',businessNumber:'+17477772687',source:'test'});
  expect(call.status).toBe('missed');
  // No 15-minute wait, no cron cycle — the card is there immediately.
  const listed=await listSuggestionCards(env,actor);
  expect(listed.cards).toHaveLength(1);
  const card=listed.cards[0];
  expect(card).toMatchObject({kind:'followup',detector:'missed_call_followup',state:'pending'});
  expect(card.title).toMatch(/text-back/i);
  expect(card.body).toContain('+17185551212');
  expect(card.draft.message).toContain('Test Salon');
  expect(card.draft.audience).toBe('missed caller');
  expect(card.draft.audienceCount).toBe(1);
  // The card is actionable: send works (simulated), edit and dismiss endpoints exist.
  const sent=await sendSuggestionCard(env,actor,card.id);
  expect(sent).toMatchObject({sent:true,simulated:true,audienceCount:1});
  const state=await env.AGENT_DB.prepare('SELECT state FROM mayor_suggestion_cards WHERE id=?').bind(card.id).first<{state:string}>();
  expect(state!.state).toBe('sent');
 });
 it('never duplicates a card for the same missed call',async()=>{
  const actor=await fixture();
  const {recordMissedCall}=await import('../../src/missed-call-textback');
  const input={callerNumber:'+17185551212',businessNumber:'+17477772687',source:'test' as const,callControlId:'dup-1'};
  await recordMissedCall(env,actor,input);
  await recordMissedCall(env,actor,input); // idempotent re-record
  const listed=await listSuggestionCards(env,actor);
  expect(listed.cards).toHaveLength(1);
 });
 it('does not recreate a card the owner dismissed',async()=>{
  const actor=await fixture();
  const {recordMissedCall}=await import('../../src/missed-call-textback');
  const input={callerNumber:'+17185551212',businessNumber:'+17477772687',source:'test' as const,callControlId:'dup-2'};
  await recordMissedCall(env,actor,input);
  const listed=await listSuggestionCards(env,actor);
  await dismissSuggestionCard(env,actor,listed.cards[0].id);
  await recordMissedCall(env,actor,input);
  // The dismissed card is not recreated: still exactly one card, still dismissed.
  const again=await listSuggestionCards(env,actor);
  expect(again.cards).toHaveLength(1);
  expect(again.cards[0].state).toBe('dismissed');
 });
 it('resolves the card when the text-back goes out through any path',async()=>{
  const actor=await fixture();
  const {recordMissedCall,simulateTextBack}=await import('../../src/missed-call-textback');
  const call=await recordMissedCall(env,actor,{callerNumber:'+17185551212',businessNumber:'+17477772687',source:'test'});
  const before=await listSuggestionCards(env,actor);
  expect(before.cards).toHaveLength(1);
  await simulateTextBack(env,actor,call.id); // direct engine path, not the card Send
  const state=await env.AGENT_DB.prepare('SELECT state FROM mayor_suggestion_cards WHERE id=?').bind(before.cards[0].id).first<{state:string}>();
  expect(state!.state).toBe('sent');
  const det=await env.AGENT_DB.prepare("SELECT state FROM mayor_proactive_detections WHERE tenant_id=? AND detector='missed_call_followup'").bind(actor.tenantId).first<{state:string}>();
  expect(det!.state).toBe('resolved');
  // No actionable card left behind: the handled call shows as sent, never pending.
  const after=await listSuggestionCards(env,actor);
  expect(after.cards.filter(c=>c.state==='pending'||c.state==='edited')).toHaveLength(0);
  expect(after.cards.find(c=>c.id===before.cards[0].id)!.state).toBe('sent');
 });
 it('the 15-minute backstop does not double-fire a record-time card',async()=>{
  const actor=await fixture();
  const {recordMissedCall}=await import('../../src/missed-call-textback');
  await recordMissedCall(env,actor,{callerNumber:'+17185551212',businessNumber:'+17477772687',source:'test'});
  // Age the call past the backstop window, then run the detector cycle.
  await env.AGENT_DB.prepare("UPDATE mayor_missed_calls SET occurred_at=? WHERE tenant_id=?")
   .bind(new Date(NOW-20*60000).toISOString(),actor.tenantId).run();
  const {created}=await runDetectors(env,actor.tenantId,NOW);
  expect(created.filter(d=>d.detector==='missed_call_followup')).toHaveLength(0);
  const listed=await listSuggestionCards(env,actor);
  expect(listed.cards).toHaveLength(1);
 });
});

describe('ROI average-ticket config',()=>{
 it('exposes the configured ticket so the tile editor can prefill it',async()=>{
  const actor=await fixture();
  await setRoiConfig(env,actor,{avgTicketCents:8500});
  const roi=await buildRoi(env,actor,undefined,NOW);
  expect(roi.avgTicketConfigured).toBe(true);
  expect(roi.avgTicketCents).toBe(8500);
 });
 it('rejects non-positive tickets',async()=>{
  const actor=await fixture();
  await expect(setRoiConfig(env,actor,{avgTicketCents:0})).rejects.toThrow();
 });
});
