import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError} from './http';
import {OPERATORS,requireMembership} from './permissions';
import {verticalProfile,isProfessionalTone,professionalFillGapTemplate,professionalWinbackTemplate,PROFESSIONAL_LEAD_REPLY_TEMPLATE,reminderTemplateFor,type Vertical} from './verticals';
import {esTemplates,esFillGapCard,esWinbackCard,esLeadReplyCard,esNoShowCard,esFillGapDraft,esWinbackDraft,esLeadReplyDraft,esAgoText,esBriefingCopy,renderReminder} from './i18n';
import {sendTextBack,simulateTextBack} from './missed-call-textback';
import {telnyxManagementAccess} from './telnyx-connections';
import {
 inQuietHours,localDayKey,localParts,localDayBoundsUtc,monthBoundsUtc,shiftLocalDate,dayGaps,
 lapsedCustomers,loadProactiveContext,runDetectors,agoText,buildFollowupCardCopy,LAPSED_DAYS,
 type ProactiveContext,type DetectionRow,type DetectorName,type LapsedCustomer,
} from './proactive-detectors';

/** Crew 3 proactive engine: cards, nudge gating, scheduler, briefing, ROI.
 * All HTTP entry points require OPERATORS membership. Nothing here sends a real
 * SMS unless the business confirmed live mode AND an authorized Telnyx connection
 * exists; otherwise every send path runs in simulation and says so. */

export type CardKind='fill_gap'|'winback'|'followup'|'lead_reply'|'reminder_nudge';
const DETECTOR_CARD:Record<DetectorName,CardKind>={
 slow_day:'fill_gap',lapsed_regular:'winback',missed_call_followup:'followup',
 unanswered_lead:'lead_reply',no_show_risk:'reminder_nudge',
};
const MAX_NUDGES_PER_DAY=3;
const STOP='Reply STOP to opt out.';

interface CardRow{
 id:string;tenant_id:string;detection_id:string;kind:CardKind;title:string;body:string;
 draft_json:string;state:'pending'|'edited'|'sent'|'dismissed';created_at:string;decided_at:string|null;result_json:string;
}
interface Draft{
 message:string;audience:string;audienceCount:number;
 recipients:{name:string;phone:string;when?:string;bookingId?:string}[];
 meta:Record<string,string>;
}

/* ---------------- nudge gating ---------------- */

export async function nudgesToday(env:Env,tenantId:string,dayKey:string){
 const row=await env.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM mayor_nudge_log WHERE tenant_id=? AND day_key=?')
  .bind(tenantId,dayKey).first<{n:number}>();
 return row?.n??0;
}
export async function logNudge(env:Env,tenantId:string,kind:'suggestion'|'briefing',dayKey:string){
 await env.AGENT_DB.prepare('INSERT INTO mayor_nudge_log(id,tenant_id,kind,day_key) VALUES(?,?,?,?)')
  .bind(crypto.randomUUID(),tenantId,kind,dayKey).run();
}
/** Surface only outside quiet hours and under the daily nudge cap. Pure logic + one count query. */
export async function surfaceGate(env:Env,ctx:ProactiveContext):Promise<{ok:true}|{ok:false;reason:'quiet_hours'|'nudge_cap'}>{
 if(inQuietHours(ctx.nowMs,ctx.timeZone))return {ok:false,reason:'quiet_hours'};
 if(await nudgesToday(env,ctx.tenantId,localDayKey(ctx.nowMs,ctx.timeZone))>=MAX_NUDGES_PER_DAY)
  return {ok:false,reason:'nudge_cap'};
 return {ok:true};
}

async function notifyOwners(env:Env,tenantId:string,kind:'proactive_suggestion'|'proactive_briefing',dedupeKey:string){
 const now=new Date().toISOString();
 const owners=await env.AGENT_DB.prepare(`SELECT user_id FROM agent_memberships
  WHERE tenant_id=? AND status='active' AND role IN ('owner','manager') AND (expires_at IS NULL OR expires_at>?)`)
  .bind(tenantId,now).all<{user_id:string}>();
 const statements=owners.results.map(o=>env.AGENT_DB.prepare(`INSERT INTO mayor_notifications(id,tenant_id,user_id,dedupe_key,kind,state,created_at,updated_at)
  SELECT ?,?,?,?,?,'open',?,?
  WHERE NOT EXISTS(SELECT 1 FROM mayor_notifications WHERE tenant_id=? AND user_id=? AND dedupe_key=?)
  AND EXISTS(SELECT 1 FROM agent_tenants WHERE id=? AND status='active')`)
  .bind(crypto.randomUUID(),tenantId,o.user_id,dedupeKey,kind,now,now,tenantId,o.user_id,dedupeKey,tenantId));
 if(statements.length)await env.AGENT_DB.batch(statements);
}

/* ---------------- card copy (vertical-aware) ---------------- */
function formatWhen(ms:number,timeZone:string,nowMs:number){
 const day=localDayKey(ms,timeZone),today=localDayKey(nowMs,timeZone);
 const time=new Intl.DateTimeFormat('en-US',{timeZone,hour:'numeric',minute:'2-digit'}).format(ms);
 if(day===today)return `today at ${time}`;
 if(day===shiftLocalDate(today,1))return `tomorrow at ${time}`;
 const date=new Intl.DateTimeFormat('en-US',{timeZone,weekday:'short',month:'short',day:'numeric'}).format(ms);
 return `${date} at ${time}`;
}
function personalize(message:string,businessName:string,recipient:{name:string}){
 return message.replace('{business}',businessName).replace('{name}',recipient.name||'there');
}

async function buildCardCopy(env:Env,ctx:ProactiveContext,detection:DetectionRow):Promise<{kind:CardKind;title:string;body:string;draft:Draft}|null>{
 const kind=DETECTOR_CARD[detection.detector];
 const v=verticalProfile(ctx.vertical);
 const cust=v.vocabulary.customer,booking=v.vocabulary.booking;
 const professional=isProfessionalTone(ctx.tone);
 const payload=JSON.parse(detection.payload_json) as Record<string,any>;
 const es=ctx.language==='es';
 const esNouns=es?esTemplates(ctx.vertical).nouns:null;
 if(kind==='fill_gap'){
  const audience=await lapsedCustomers(env,ctx.tenantId,ctx.vertical,ctx.nowMs,25);
  const hours=Math.max(2,Math.round((payload.maxGapMinutes??120)/60));
  const n=audience.length;
  if(es){
   const copy=esFillGapCard(hours,n,esNouns!.customers);
   return {kind,
    title:copy.title,
    body:copy.body,
    draft:{message:esFillGapDraft(),
     audience:'clientes que no vuelven',audienceCount:n,
     recipients:audience.map(a=>({name:a.name,phone:a.phone})),meta:{}}};
  }
  return {kind,
   title:`Fill ${hours} slow hour${hours===1?'':'s'} tomorrow`,
   body:`${hours} slow hour${hours===1?'':'s'} tomorrow with nothing booked — send this fill-the-chairs text to ${n} lapsed ${cust}${n===1?'':'s'}?`,
   draft:{message:professional?professionalFillGapTemplate(booking):`Hi {name}, it's {business}! We have a few open ${booking}s tomorrow — want in? Reply YES and we'll find you a time. ${STOP}`,
    audience:'lapsed regulars',audienceCount:n,
    recipients:audience.map(a=>({name:a.name,phone:a.phone})),meta:{}}};
 }
 if(kind==='winback'){
  const customers=(payload.customers??[]) as LapsedCustomer[];
  const days=payload.cutoffDays??LAPSED_DAYS[ctx.vertical];
  const n=customers.length;
  if(es){
   const copy=esWinbackCard(n,esNouns!.customers,days);
   return {kind,
    title:copy.title,
    body:copy.body,
    draft:{message:esWinbackDraft(esNouns!.booking),
     audience:'clientes que no vuelven',audienceCount:n,
     recipients:customers.map(c=>({name:c.name,phone:c.phone})),meta:{}}};
  }
  return {kind,
   title:`Win back ${n} lapsed ${cust}${n===1?'':'s'}`,
   body:`${n} ${cust}${n===1?'':'s'} ${n===1?'has':'have'}n't booked in ${days}+ days — send this win-back text?`,
   draft:{message:professional?professionalWinbackTemplate(booking):`Hi {name}, it's {business} — it's been a while! Ready to book your next ${booking}? Reply YES and we'll find you a time. ${STOP}`,
    audience:'lapsed regulars',audienceCount:n,
    recipients:customers.map(c=>({name:c.name,phone:c.phone})),meta:{}}};
 }
 if(kind==='followup'){
  // Shared with the record-time path (ensureMissedCallFollowupCard) — one copy builder.
  return {kind,...buildFollowupCardCopy(ctx,payload as {missedCallId:string;callerNumber:string;occurredAt:string})};
 }
 if(kind==='lead_reply'){
  if(es){
   const copy=esLeadReplyCard(payload.fromNumber,esAgoText(Date.parse(payload.receivedAt),ctx.nowMs));
   return {kind,
    title:copy.title,
    body:copy.body,
    draft:{message:esLeadReplyDraft(),
     audience:'contacto',audienceCount:1,
     recipients:[{name:'',phone:payload.fromNumber}],meta:{smsId:payload.smsId}}};
  }
  return {kind,
   title:'Unanswered lead',
   body:`A text from ${payload.fromNumber} ${agoText(Date.parse(payload.receivedAt),ctx.nowMs)} has no reply — send this follow-up?`,
   draft:{message:professional?PROFESSIONAL_LEAD_REPLY_TEMPLATE:`Hi, this is {business} — thanks for reaching out! Sorry for the delay — how can we help? ${STOP}`,
    audience:'lead',audienceCount:1,
    recipients:[{name:'',phone:payload.fromNumber}],meta:{smsId:payload.smsId}}};
 }
 // reminder_nudge
 const when=formatWhen(Date.parse(payload.startsAt),ctx.timeZone,ctx.nowMs);
 if(es){
  const copy=esNoShowCard(payload.customerName,when);
  return {kind,
   title:copy.title,
   body:copy.body,
   draft:{message:renderReminder(ctx.vertical,'es',ctx.businessName,when),
    audience:'cliente en riesgo',audienceCount:1,
    recipients:[{name:payload.customerName,phone:payload.customerPhone,when,bookingId:payload.bookingId}],meta:{bookingId:payload.bookingId,customerId:payload.customerId}}};
 }
 return {kind,
  title:`No-show risk: ${payload.customerName}`,
  body:`${payload.customerName} missed before and has no reminder for ${when} — send a reminder now?`,
  draft:{message:reminderTemplateFor(v,ctx.tone).replace('{business}',ctx.businessName).replace('{when}',when),
   audience:'at-risk customer',audienceCount:1,
   recipients:[{name:payload.customerName,phone:payload.customerPhone,when,bookingId:payload.bookingId}],meta:{bookingId:payload.bookingId,customerId:payload.customerId}}};
}

export async function createSuggestionCard(env:Env,ctx:ProactiveContext,detection:DetectionRow){
 const copy=await buildCardCopy(env,ctx,detection);
 if(!copy)return null;
 const id=crypto.randomUUID(),now=new Date(ctx.nowMs).toISOString();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_suggestion_cards(id,tenant_id,detection_id,kind,title,body,draft_json,state,created_at)
  VALUES(?,?,?,?,?,?,?,'pending',?)`)
  .bind(id,ctx.tenantId,detection.id,copy.kind,copy.title,copy.body,JSON.stringify(copy.draft),now).run();
 return {id,...copy};
}

/* ---------------- scheduler ---------------- */

async function surfaceDetection(env:Env,ctx:ProactiveContext,detection:DetectionRow,card:{id:string;title:string;body:string}){
 await env.AGENT_DB.prepare("UPDATE mayor_proactive_detections SET state='surfaced' WHERE id=? AND state='open'")
  .bind(detection.id).run();
 await notifyOwners(env,ctx.tenantId,'proactive_suggestion',`proactive_suggestion:${detection.id}`);
 await logNudge(env,ctx.tenantId,'suggestion',localDayKey(ctx.nowMs,ctx.timeZone));
}

/** Cheap, idempotent 5-minute cycle: detect → card → surface (gated). */
export async function runProactiveCycle(env:Env,nowMs=Date.now()){
 const tenants=await env.AGENT_DB.prepare("SELECT id FROM agent_tenants WHERE status='active'").all<{id:string}>();
 let detections=0,cards=0,surfaced=0,briefings=0;
 for(const t of tenants.results){
  try{
   const {context,created}=await runDetectors(env,t.id,nowMs);
   detections+=created.length;
   for(const d of created){
    const card=await createSuggestionCard(env,context,d);
    if(!card)continue;
    cards++;
    if(!(await surfaceGate(env,context)).ok)continue;
    await surfaceDetection(env,context,d,card);
    surfaced++;
   }
   // Morning briefing: once per local day, in the 08:05–08:10 window, nudge-capped.
   const parts=localParts(nowMs,context.timeZone);
   if(parts.hour===8&&parts.minute>=5&&parts.minute<10){
    const dayKey=parts.date;
    const already=await env.AGENT_DB.prepare('SELECT 1 FROM mayor_notifications WHERE tenant_id=? AND dedupe_key=? LIMIT 1')
     .bind(t.id,`proactive_briefing:${dayKey}`).first();
    if(!already&&(await surfaceGate(env,context)).ok){
     await notifyOwners(env,t.id,'proactive_briefing',`proactive_briefing:${dayKey}`);
     await logNudge(env,t.id,'briefing',dayKey);
     briefings++;
    }
   }
  }catch(error){
   console.warn(JSON.stringify({event:'proactive_cycle_tenant_failed',tenant:t.id}));
  }
 }
 return {tenants:tenants.results.length,detections,cards,surfaced,briefings};
}

/* ---------------- suggestion card actions ---------------- */

function publicCard(row:CardRow&{detector:DetectorName}){
 const draft=JSON.parse(row.draft_json) as Draft;
 return {id:row.id,kind:row.kind,detector:row.detector,title:row.title,body:row.body,
  draft:{message:draft.message,audience:draft.audience,audienceCount:draft.audienceCount},
  state:row.state,createdAt:row.created_at};
}
export async function listSuggestionCards(env:Env,actor:Actor){
 await requireMembership(env,actor,OPERATORS);
 const rows=await env.AGENT_DB.prepare(`SELECT c.*,d.detector FROM mayor_suggestion_cards c
  JOIN mayor_proactive_detections d ON d.id=c.detection_id WHERE c.tenant_id=?
  ORDER BY CASE c.state WHEN 'pending' THEN 0 WHEN 'edited' THEN 1 WHEN 'sent' THEN 2 ELSE 3 END, c.created_at DESC LIMIT 50`)
  .bind(actor.tenantId).all<CardRow&{detector:DetectorName}>();
 await requireMembership(env,actor,OPERATORS);
 return {cards:rows.results.map(publicCard)};
}

export const proactiveSettingsSchema=z.object({liveSms:z.boolean()}).strict();
async function readProactiveSettings(env:Env,tenantId:string){
 const row=await env.AGENT_DB.prepare("SELECT value_json FROM mayor_memory WHERE tenant_id=? AND field='proactive_settings'")
  .bind(tenantId).first<{value_json:string}>();
 return row?proactiveSettingsSchema.parse(JSON.parse(row.value_json)):{liveSms:false};
}
export async function setProactiveSettings(env:Env,actor:Actor,input:z.infer<typeof proactiveSettingsSchema>){
 await requireMembership(env,actor,OPERATORS);
 const parsed=proactiveSettingsSchema.parse(input),now=new Date().toISOString();
 const permitted="EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?))";
 await env.AGENT_DB.prepare(`INSERT INTO mayor_memory(tenant_id,field,value_json,source_kind,confirmed_by,confirmed_at,revision,updated_at)
  SELECT ?,'proactive_settings',?,'owner_confirmed',?,?,1,? WHERE ${permitted}
  ON CONFLICT(tenant_id,field) DO UPDATE SET value_json=excluded.value_json,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at,revision=mayor_memory.revision+1,updated_at=excluded.updated_at`)
  .bind(actor.tenantId,JSON.stringify(parsed),actor.userId,now,now,actor.tenantId,actor.userId,now).run();
 return {liveSms:parsed.liveSms,note:parsed.liveSms
  ?'Live mode ON: suggestion sends will text real customers via Telnyx.'
  :'Simulation mode: suggestion sends are logged only — nothing is texted.'};
}

async function telnyxFromNumber(env:Env,actor:Actor){
 const row=await env.AGENT_DB.prepare("SELECT selected_number FROM mayor_phone_connections WHERE tenant_id=? AND provider='telnyx' AND status='authorized'")
  .bind(actor.tenantId).first<{selected_number:string|null}>();
 return row?.selected_number??null;
}
async function sendViaTelnyx(env:Env,actor:Actor,transport:typeof fetch,from:string,to:string,text:string){
 const access=await telnyxManagementAccess(env,actor,transport);
 const response=await transport('https://api.telnyx.com/v2/messages',{
  method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),
  headers:{authorization:access.authorization,'content-type':'application/json',accept:'application/json'},
  body:JSON.stringify({from,to,text}),
 });
 if(!response.ok){await response.body?.cancel();throw new HttpError(502,'sms_send_failed','The suggestion SMS could not be sent. Check the Telnyx connection.');}
 const body=await response.json() as {data?:{id?:string}};
 return typeof body.data?.id==='string'?body.data.id:null;
}
async function logRoiEvent(env:Env,tenantId:string,kind:string,occurredAt:string,amountCents:number|null,meta:Record<string,unknown>){
 await env.AGENT_DB.prepare('INSERT INTO mayor_roi_events(id,tenant_id,kind,occurred_at,amount_cents,meta_json) VALUES(?,?,?,?,?,?)')
  .bind(crypto.randomUUID(),tenantId,kind,occurredAt,amountCents,JSON.stringify(meta)).run();
}

/** Execute a card. Live only when the business confirmed live mode AND an
 * authorized Telnyx connection with a selected number exists; otherwise every
 * recipient is logged as 'simulated' and nothing leaves the building. */
export async function sendSuggestionCard(env:Env,actor:Actor,cardId:string,transport:typeof fetch=fetch){
 await requireMembership(env,actor,OPERATORS);
 const card=await env.AGENT_DB.prepare('SELECT * FROM mayor_suggestion_cards WHERE id=? AND tenant_id=?')
  .bind(cardId,actor.tenantId).first<CardRow>();
 if(!card)throw new HttpError(404,'suggestion_unavailable','This suggestion is no longer available.');
 if(card.state==='sent')return {sent:true,...JSON.parse(card.result_json)};
 if(card.state==='dismissed')throw new HttpError(409,'suggestion_dismissed','This suggestion was dismissed.');
 const draft=JSON.parse(card.draft_json) as Draft;
 const ctx=await loadProactiveContext(env,actor.tenantId);
 const settings=await readProactiveSettings(env,actor.tenantId);
 const fromNumber=await telnyxFromNumber(env,actor);
 const live=settings.liveSms&&!!fromNumber;
 const now=new Date().toISOString();
 const finish=async(result:{simulated:boolean;audienceCount:number;sentCount:number;failed:number})=>{
  await env.AGENT_DB.batch([
   env.AGENT_DB.prepare("UPDATE mayor_suggestion_cards SET state='sent',decided_at=?,result_json=? WHERE id=? AND state IN ('pending','edited')")
    .bind(now,JSON.stringify(result),cardId),
   env.AGENT_DB.prepare("UPDATE mayor_proactive_detections SET state='resolved' WHERE id=? AND state IN ('open','surfaced')")
    .bind(card.detection_id),
  ]);
  await logRoiEvent(env,actor.tenantId,'textback_sent',now,null,
   {card_id:cardId,detection_id:card.detection_id,simulated:result.simulated,audience_count:result.audienceCount});
  return {sent:true,audienceCount:result.audienceCount,simulated:result.simulated};
 };

 // Missed-call follow-up reuses the money-loop engine (test calls stay simulated).
 if(card.kind==='followup'&&draft.meta.missedCallId){
  const missedCallId=draft.meta.missedCallId;
  const call=await env.AGENT_DB.prepare('SELECT source,textback_sent_at FROM mayor_missed_calls WHERE id=? AND tenant_id=?')
   .bind(missedCallId,actor.tenantId).first<{source:string;textback_sent_at:string|null}>();
  if(!call)throw new HttpError(404,'suggestion_unavailable','The missed call for this suggestion is gone.');
  if(call.source==='test'){
   await simulateTextBack(env,actor,missedCallId);
   return finish({simulated:true,audienceCount:1,sentCount:1,failed:0});
  }
  if(live){
   const res=await sendTextBack(env,actor,missedCallId,transport);
   return finish({simulated:false,audienceCount:1,sentCount:res.alreadySent?0:1,failed:0});
  }
  await env.AGENT_DB.prepare(`INSERT INTO mayor_sms_log(id,tenant_id,direction,to_number,from_number,body,provider_message_id,status,related_missed_call_id)
   VALUES(?,?,'outbound',?,?,?,NULL,'simulated',?)`)
   .bind(crypto.randomUUID(),actor.tenantId,draft.recipients[0].phone,fromNumber??'unconfigured',personalize(draft.message,ctx.businessName,draft.recipients[0]),missedCallId).run();
  return finish({simulated:true,audienceCount:1,sentCount:1,failed:0});
 }

 let sentCount=0,failed=0;
 const smsRows=[];
 for(const r of draft.recipients){
  const text=personalize(draft.message,ctx.businessName,r);
  try{
   let messageId:string|null=null;
   if(live){
    messageId=await sendViaTelnyx(env,actor,transport,fromNumber!,r.phone,text);
    if(card.kind==='reminder_nudge'&&r.bookingId){
     const appt=await env.AGENT_DB.prepare('SELECT reserved_start FROM mayor_appointment_jobs WHERE id=? AND tenant_id=?')
      .bind(r.bookingId,actor.tenantId).first<{reserved_start:string}>();
     if(appt)smsRows.push(env.AGENT_DB.prepare(`INSERT INTO mayor_appointment_reminders(id,tenant_id,booking_id,appointment_at,customer_number,reminder_sent_at)
       VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,booking_id) DO UPDATE SET reminder_sent_at=excluded.reminder_sent_at,customer_number=excluded.customer_number`)
       .bind(crypto.randomUUID(),actor.tenantId,r.bookingId,appt.reserved_start,r.phone,now));
    }
   }
   sentCount++;
   smsRows.push(env.AGENT_DB.prepare(`INSERT INTO mayor_sms_log(id,tenant_id,direction,to_number,from_number,body,provider_message_id,status)
    VALUES(?,?,'outbound',?,?,?,?,?)`)
    .bind(crypto.randomUUID(),actor.tenantId,r.phone,fromNumber??'unconfigured',text,messageId,live?'sent':'simulated'));
  }catch{failed++;}
 }
 if(smsRows.length)await env.AGENT_DB.batch(smsRows);
 return finish({simulated:!live,audienceCount:draft.audienceCount,sentCount,failed});
}

export async function editSuggestionCard(env:Env,actor:Actor,cardId:string,message:string){
 await requireMembership(env,actor,OPERATORS);
 const card=await env.AGENT_DB.prepare('SELECT * FROM mayor_suggestion_cards WHERE id=? AND tenant_id=?')
  .bind(cardId,actor.tenantId).first<CardRow>();
 if(!card)throw new HttpError(404,'suggestion_unavailable','This suggestion is no longer available.');
 if(card.state==='sent'||card.state==='dismissed')throw new HttpError(409,'suggestion_decided','This suggestion was already decided.');
 const draft={...JSON.parse(card.draft_json),message} as Draft;
 await env.AGENT_DB.prepare("UPDATE mayor_suggestion_cards SET draft_json=?,state='edited' WHERE id=? AND state IN ('pending','edited')")
  .bind(JSON.stringify(draft),cardId).run();
 return {id:cardId,message,audience:draft.audience,audienceCount:draft.audienceCount,state:'edited' as const};
}

export async function dismissSuggestionCard(env:Env,actor:Actor,cardId:string){
 await requireMembership(env,actor,OPERATORS);
 const card=await env.AGENT_DB.prepare('SELECT id,detection_id FROM mayor_suggestion_cards WHERE id=? AND tenant_id=?')
  .bind(cardId,actor.tenantId).first<{id:string;detection_id:string}>();
 if(!card)throw new HttpError(404,'suggestion_unavailable','This suggestion is no longer available.');
 const now=new Date().toISOString();
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare("UPDATE mayor_suggestion_cards SET state='dismissed',decided_at=? WHERE id=? AND state IN ('pending','edited')").bind(now,cardId),
  env.AGENT_DB.prepare("UPDATE mayor_proactive_detections SET state='dismissed' WHERE id=? AND state IN ('open','surfaced')").bind(card.detection_id),
 ]);
 return {dismissed:true};
}

/* ---------------- ROI: config, seeding, report ---------------- */

export const roiConfigSchema=z.object({avgTicketCents:z.number().int().positive().max(100_000_00)}).strict();
export const noShowSchema=z.object({customerId:z.string().min(1).max(64),appointmentId:z.string().min(1).max(64).optional(),occurredAt:z.string().datetime().optional()}).strict();

async function readAvgTicket(env:Env,tenantId:string){
 const row=await env.AGENT_DB.prepare("SELECT value_json FROM mayor_memory WHERE tenant_id=? AND field='roi_config'")
  .bind(tenantId).first<{value_json:string}>();
 if(!row)return null;
 const parsed=roiConfigSchema.safeParse(JSON.parse(row.value_json));
 return parsed.success?parsed.data.avgTicketCents:null;
}
export async function setRoiConfig(env:Env,actor:Actor,input:z.infer<typeof roiConfigSchema>){
 await requireMembership(env,actor,OPERATORS);
 const parsed=roiConfigSchema.parse(input),now=new Date().toISOString();
 const permitted="EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?))";
 await env.AGENT_DB.prepare(`INSERT INTO mayor_memory(tenant_id,field,value_json,source_kind,confirmed_by,confirmed_at,revision,updated_at)
  SELECT ?,'roi_config',?,'owner_confirmed',?,?,1,? WHERE ${permitted}
  ON CONFLICT(tenant_id,field) DO UPDATE SET value_json=excluded.value_json,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at,revision=mayor_memory.revision+1,updated_at=excluded.updated_at`)
  .bind(actor.tenantId,JSON.stringify(parsed),actor.userId,now,now,actor.tenantId,actor.userId,now).run();
 return {avgTicketCents:parsed.avgTicketCents};
}

/** Record a no-show. Called by whichever flow marks one (phone confirmation,
 * owner action); the no_show_risk detector reads these. */
export async function recordNoShow(env:Env,actor:Actor,input:z.infer<typeof noShowSchema>){
 await requireMembership(env,actor,OPERATORS);
 const parsed=noShowSchema.parse(input),now=new Date().toISOString();
 await logRoiEvent(env,actor.tenantId,'no_show',parsed.occurredAt??now,null,
  {customer_id:parsed.customerId,appointment_id:parsed.appointmentId??null});
 return {recorded:true};
}

/** Backfill ROI events from real history. Idempotent via meta_json dedupe.
 * Only writes what the data actually says: text-backs that went out,
 * appointments the Mayor booked, missed calls that turned into bookings. */
export async function seedRoiEvents(env:Env,tenantId:string){
 const missed=await env.AGENT_DB.prepare(`SELECT id,textback_sent_at,booking_id FROM mayor_missed_calls
  WHERE tenant_id=? AND textback_sent_at IS NOT NULL`).bind(tenantId).all<{id:string;textback_sent_at:string;booking_id:string|null}>();
 const booked=await env.AGENT_DB.prepare(`SELECT a.id,j.created_at FROM mayor_appointments a
  JOIN mayor_appointment_jobs j ON j.id=a.id WHERE a.tenant_id=? AND a.state='confirmed'`)
  .bind(tenantId).all<{id:string;created_at:string}>();
 const statements=[];
 for(const m of missed.results){
  statements.push(env.AGENT_DB.prepare(`INSERT INTO mayor_roi_events(id,tenant_id,kind,occurred_at,meta_json)
   SELECT ?,?, 'textback_sent',?,json_object('missed_call_id',?)
   WHERE NOT EXISTS(SELECT 1 FROM mayor_roi_events WHERE tenant_id=? AND kind='textback_sent'
    AND json_extract(meta_json,'$.missed_call_id')=?)`)
   .bind(crypto.randomUUID(),tenantId,m.textback_sent_at,m.id,tenantId,m.id));
  if(m.booking_id)statements.push(env.AGENT_DB.prepare(`INSERT INTO mayor_roi_events(id,tenant_id,kind,occurred_at,meta_json)
   SELECT ?,?, 'recovery',?,json_object('missed_call_id',?,'booking_id',?)
   WHERE NOT EXISTS(SELECT 1 FROM mayor_roi_events WHERE tenant_id=? AND kind='recovery'
    AND json_extract(meta_json,'$.missed_call_id')=?)`)
   .bind(crypto.randomUUID(),tenantId,m.textback_sent_at,m.id,m.booking_id,tenantId,m.id));
 }
 for(const b of booked.results){
  statements.push(env.AGENT_DB.prepare(`INSERT INTO mayor_roi_events(id,tenant_id,kind,occurred_at,meta_json)
   SELECT ?,?, 'booking_made',?,json_object('appointment_id',?)
   WHERE NOT EXISTS(SELECT 1 FROM mayor_roi_events WHERE tenant_id=? AND kind='booking_made'
    AND json_extract(meta_json,'$.appointment_id')=?)`)
   .bind(crypto.randomUUID(),tenantId,b.created_at,b.id,tenantId,b.id));
 }
 for(let i=0;i<statements.length;i+=50)await env.AGENT_DB.batch(statements.slice(i,i+50));
 return {textbacks:missed.results.length,bookings:booked.results.length};
}

const monthParam=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
async function noShowRateFor(env:Env,tenantId:string,start:string,end:string){
 const noShows=await env.AGENT_DB.prepare(`SELECT COUNT(*) AS n FROM mayor_roi_events
  WHERE tenant_id=? AND kind='no_show' AND occurred_at>=? AND occurred_at<?`).bind(tenantId,start,end).first<{n:number}>();
 const starts=await env.AGENT_DB.prepare(`SELECT COUNT(*) AS n FROM mayor_appointments a
  JOIN mayor_appointment_jobs j ON j.id=a.id
  WHERE a.tenant_id=? AND a.state='confirmed' AND j.reserved_start>=? AND j.reserved_start<?`)
  .bind(tenantId,start,end).first<{n:number}>();
 const ns=noShows?.n??0,den=ns+(starts?.n??0);
 return den?ns/den:null;
}

/** Optional per-vertical KPI label overrides. Enriched on the vertical profile by the
 * crew4 vertical track as kpis:[{key,label,hint}]. Keys map 1:1 to the existing ROI
 * dashboard tiles — labels only; this never adds metrics, tiles, or dollar amounts. */
interface RoiKpiDef{key:string;label:string;hint?:string}
function roiKpiLabel(vertical:Vertical,key:string):string|null{
 const v=verticalProfile(vertical) as unknown as {kpis?:RoiKpiDef[]};
 return v.kpis?.find(k=>k.key===key)?.label??null;
}

/** ROI tile nouns stay vertical-aware: reservations vs appointments vs jobs vs visits. */
const ROI_BOOKING_NOUN:Record<Vertical,string>={
 salon:'Appointments',restaurant:'Reservations',plumbing_hvac:'Jobs',
 dental:'Visits',auto_repair:'Service appointments',pet_grooming:'Appointments',med_spa:'Appointments',other:'Appointments',
};

/** ROI dashboard tile labels for a vertical — labels only, no new metrics or amounts. */
export function roiTileLabels(vertical:Vertical){
 const noun=ROI_BOOKING_NOUN[vertical];
 return {
  recoveredRevenue:roiKpiLabel(vertical,'recovered_revenue')??'Recovered revenue',
  bookingsByMayor:roiKpiLabel(vertical,'appointments_booked')??`${noun} booked by Mayor`,
  missedCallsRecovered:roiKpiLabel(vertical,'missed_calls_recovered')??'Missed calls recovered',
  avgResponseTime:roiKpiLabel(vertical,'avg_response_time')??'Avg response time',
  noShowRate:roiKpiLabel(vertical,'no_show_rate')??'No-show rate',
 };
}

export async function buildRoi(env:Env,actor:Actor,month?:string,nowMs=Date.now()){
 await requireMembership(env,actor,OPERATORS);
 const ctx=await loadProactiveContext(env,actor.tenantId,nowMs);
 const m=month??localDayKey(nowMs,ctx.timeZone).slice(0,7);
 const {start,end}=monthBoundsUtc(Number(monthParam.parse(m).slice(0,4)),Number(m.slice(5,7)),ctx.timeZone);
 await seedRoiEvents(env,actor.tenantId);
 const avgTicket=await readAvgTicket(env,actor.tenantId);

 const recoveries=await env.AGENT_DB.prepare(`SELECT amount_cents FROM mayor_roi_events
  WHERE tenant_id=? AND kind='recovery' AND occurred_at>=? AND occurred_at<?`).bind(actor.tenantId,start,end).all<{amount_cents:number|null}>();
 let recoveredRevenueCents:number|null=null,revenueSource:'configured_avg_ticket'|'recorded_amounts'|'not_configured'='not_configured';
 if(avgTicket!=null){
  recoveredRevenueCents=recoveries.results.reduce((s,r)=>s+(r.amount_cents??avgTicket),0);
  revenueSource='configured_avg_ticket';
 }else{
  const recorded=recoveries.results.map(r=>r.amount_cents).filter((v):v is number=>v!=null);
  if(recorded.length){recoveredRevenueCents=recorded.reduce((s,v)=>s+v,0);revenueSource='recorded_amounts';}
 }

 const booked=await env.AGENT_DB.prepare(`SELECT COUNT(*) AS n FROM mayor_roi_events
  WHERE tenant_id=? AND kind='booking_made' AND occurred_at>=? AND occurred_at<?`).bind(actor.tenantId,start,end).first<{n:number}>();
 const missedTotal=await env.AGENT_DB.prepare(`SELECT COUNT(*) AS n FROM mayor_missed_calls
  WHERE tenant_id=? AND occurred_at>=? AND occurred_at<?`).bind(actor.tenantId,start,end).first<{n:number}>();

 const sms=await env.AGENT_DB.prepare(`SELECT direction,to_number,from_number,created_at,status FROM mayor_sms_log
  WHERE tenant_id=? AND created_at>=? AND created_at<? ORDER BY created_at`).bind(actor.tenantId,start,end)
  .all<{direction:string;to_number:string;from_number:string;created_at:string;status:string}>();
 const outbounds=sms.results.filter(r=>r.direction==='outbound'&&r.status==='sent');
 let responseSum=0,responseCount=0;
 for(const inbound of sms.results.filter(r=>r.direction==='inbound')){
  const first=outbounds.find(o=>o.to_number===inbound.from_number&&o.created_at>inbound.created_at);
  if(first){responseSum+=(Date.parse(first.created_at)-Date.parse(inbound.created_at))/1000;responseCount++;}
 }
 const trend=[];
 for(let i=5;i>=0;i--){
  const d=new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7))-1-i,1));
  const b=monthBoundsUtc(d.getUTCFullYear(),d.getUTCMonth()+1,ctx.timeZone);
  trend.push({month:`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`,
   rate:await noShowRateFor(env,actor.tenantId,b.start,b.end)});
 }
 return {
  month:m,
  recoveredRevenueCents,revenueSource,
  appointmentsBookedByMayor:booked?.n??0,
  missedCallsRecovered:{recovered:recoveries.results.length,total:missedTotal?.n??0},
  avgResponseTimeSeconds:responseCount?Math.round(responseSum/responseCount):null,
  noShowRate:await noShowRateFor(env,actor.tenantId,start,end),
  noShowTrend:trend,
  labels:roiTileLabels(ctx.vertical),
  avgTicketConfigured:avgTicket!=null,
  avgTicketCents:avgTicket,
  generatedAt:new Date(nowMs).toISOString(),
 };
}

/* ---------------- briefing ---------------- */

export async function buildBriefing(env:Env,actor:Actor,nowMs=Date.now()){
 await requireMembership(env,actor,OPERATORS);
 const ctx=await loadProactiveContext(env,actor.tenantId,nowMs);
 const today=localDayKey(nowMs,ctx.timeZone),yesterday=shiftLocalDate(today,-1);
 const yb=localDayBoundsUtc(yesterday,ctx.timeZone),tb=localDayBoundsUtc(today,ctx.timeZone);
 const avgTicket=await readAvgTicket(env,actor.tenantId);

 const apptsYesterday=await env.AGENT_DB.prepare(`SELECT COUNT(*) AS n FROM mayor_appointments a
  JOIN mayor_appointment_jobs j ON j.id=a.id
  WHERE a.tenant_id=? AND a.state='confirmed' AND j.reserved_start>=? AND j.reserved_start<?`)
  .bind(actor.tenantId,yb.start,yb.end).first<{n:number}>();
 const noShowsYesterday=await env.AGENT_DB.prepare(`SELECT COUNT(*) AS n FROM mayor_roi_events
  WHERE tenant_id=? AND kind='no_show' AND occurred_at>=? AND occurred_at<?`)
  .bind(actor.tenantId,yb.start,yb.end).first<{n:number}>();
 const kept=Math.max(0,(apptsYesterday?.n??0)-(noShowsYesterday?.n??0));

 const todayRows=await env.AGENT_DB.prepare(`SELECT j.reserved_start,j.reserved_end,c.name AS customer_name
  FROM mayor_appointments a JOIN mayor_appointment_jobs j ON j.id=a.id
  LEFT JOIN mayor_appointment_customers ac ON ac.booking_id=j.id AND ac.tenant_id=j.tenant_id
  LEFT JOIN mayor_customers c ON c.id=ac.customer_id AND c.tenant_id=j.tenant_id
  WHERE a.tenant_id=? AND a.state='confirmed' AND j.reserved_start>=? AND j.reserved_start<? ORDER BY j.reserved_start`)
  .bind(actor.tenantId,tb.start,tb.end).all<{reserved_start:string;reserved_end:string;customer_name:string|null}>();
 const weekday=({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6} as Record<string,number>)[localParts(nowMs,ctx.timeZone).weekday]??-1;
 const periods=ctx.policy?.weeklyHours.filter(p=>p.day===weekday)??[];
 const gaps=dayGaps(periods,todayRows.results.map(r=>({start:r.reserved_start,end:r.reserved_end})),today,ctx.timeZone);

 const missed=await env.AGENT_DB.prepare(`SELECT COUNT(*) AS total,
   SUM(CASE WHEN textback_sent_at IS NOT NULL THEN 1 ELSE 0 END) AS texted,
   SUM(CASE WHEN booking_id IS NOT NULL THEN 1 ELSE 0 END) AS recovered
  FROM mayor_missed_calls WHERE tenant_id=? AND occurred_at>=? AND occurred_at<?`)
  .bind(actor.tenantId,yb.start,yb.end).first<{total:number;texted:number;recovered:number}>();

 const cards=await env.AGENT_DB.prepare(`SELECT id,title,body FROM mayor_suggestion_cards
  WHERE tenant_id=? AND state IN ('pending','edited') ORDER BY created_at DESC LIMIT 10`)
  .bind(actor.tenantId).all<{id:string;title:string;body:string}>();

 const starts=todayRows.results.map(r=>r.reserved_start).sort();
 // Briefing nouns are vertical-aware. The parallel agent's optional briefingNouns
 // field on the vertical profile wins when present; otherwise fall back to the
 // profile's own vocabulary (pluralized), and only then to generic words.
 // For 'other'/unknown verticals the vocabulary IS the generic pair, so the
 // spec fallback ({appointments:'appointments', customers:'customers'}) holds there.
 const vp=verticalProfile(ctx.vertical);
 const maybeNouns=(vp as {briefingNouns?:{appointments?:unknown;customers?:unknown}}).briefingNouns;
 const pluralOf=(word:string)=>`${word}s`;
 const pickNoun=(value:unknown,fallback:string)=>typeof value==='string'&&value.trim()?value.trim():fallback;
 const nouns={appointments:pickNoun(maybeNouns?.appointments,pluralOf(vp.vocabulary.booking)),
  customers:pickNoun(maybeNouns?.customers,pluralOf(vp.vocabulary.customer))};
 const esBriefing=ctx.language==='es'?esTemplates(ctx.vertical).nouns:null;
 if(esBriefing){nouns.appointments=esBriefing.appointments;nouns.customers=esBriefing.customers;}
 const wordFor=(n:number,plural:string)=>n===1?plural.replace(/s$/,''):plural;
 const apptsToday=todayRows.results.length,noShowCount=noShowsYesterday?.n??0;
 const briefingCopy=esBriefing
  ?esBriefingCopy(kept,apptsToday,noShowCount,esBriefing.appointments)
  :{yesterday:`${kept} ${wordFor(kept,nouns.appointments)} yesterday${noShowCount?`, ${noShowCount} ${wordFor(noShowCount,'no-show')}`:''}`,
    today:apptsToday?`${apptsToday} ${wordFor(apptsToday,nouns.appointments)} today`:`No ${wordFor(2,nouns.appointments)} today`};
 return {
  date:today,
  businessName:ctx.businessName,
  vertical:ctx.vertical,
  nouns,
  copy:briefingCopy,
  yesterday:{
   appointments:apptsYesterday?.n??0,
   noShows:noShowsYesterday?.n??0,
   // Honest dollars only: null unless the owner configured an average ticket.
   revenueCents:avgTicket!=null?kept*avgTicket:null,
  },
  today:{
   appointments:todayRows.results.length,
   gaps:gaps.map(g=>({start:g.start,end:g.end})),
   firstAt:starts[0]??null,
   lastAt:starts[starts.length-1]??null,
  },
  missedCalls:{total:missed?.total??0,textedBack:missed?.texted??0,recovered:missed?.recovered??0},
  opportunities:cards.results.map(c=>({cardId:c.id,title:c.title,oneLine:c.body})),
  generatedAt:new Date(nowMs).toISOString(),
 };
}
