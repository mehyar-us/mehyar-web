import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError,json,readJson,requireOrigin,digest} from './http';
import {OPERATORS,requireMembership,requireTenant} from './permissions';
import {customerPatchSchema,prepareCustomer,confirmCustomer,readCustomer,customerReadback,type CustomerProposal} from './customers';
import {bookingSchema,bookingProposalSchema,proposeBooking,confirmBooking} from './appointments';
import {changeSchema,proposeAppointmentChange,confirmAppointmentChange,reconcileAppointmentChange} from './appointment-changes';
import {availabilitySchema,findAvailability} from './availability';
import {handleCallback} from './callbacks';
import {bookingReadback,changeReadback} from './confirmation';
import {readMemory} from './memory';
import {readSchedulingPolicy} from './scheduling-policy';
import {readSchedulingSetup} from './scheduling-setup';
import {selectedCalendar} from './calendars';

const instant=z.iso.datetime({offset:true}).transform(value=>new Date(value).toISOString());
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
 const time=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
},'Choose a valid date.');
const priority=z.enum(['low','normal','high']);
const taskFields={title:z.string().trim().min(1).max(200),dueAt:instant.nullable(),priority,customerId:z.uuid().nullable()};
const taskCreateSchema=z.object({title:taskFields.title,dueAt:taskFields.dueAt.optional(),priority:priority.optional(),customerId:taskFields.customerId.optional(),requestId:z.uuid().optional()}).strict();
const taskUpdateSchema=z.object({revision:z.number().int().min(1),title:taskFields.title.optional(),dueAt:taskFields.dueAt.optional(),priority:priority.optional(),customerId:taskFields.customerId.optional(),status:z.enum(['open','completed']).optional()}).strict()
 .refine(input=>Object.keys(input).some(key=>key!=='revision'),'Describe a task change.');
const confirmationSchema=z.object({id:z.uuid(),confirm:z.literal(true)}).strict();
const cursorSchema=z.object({v:z.literal(1),scope:z.string().regex(/^[a-f0-9]{64}$/),key:z.string().max(512),id:z.uuid()}).strict();
const nullDue='9999-12-31T23:59:59.999Z';
const permission=`EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status='active'
 AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?))`;
const agendaSource={label:'Mayor appointments',scope:'Appointments booked through Mayor. Other events in your connected calendar are not imported.'};
type TaskRow={id:string;title:string;due_at:string|null;priority:'low'|'normal'|'high';status:'open'|'completed';customer_id:string|null;customer_name:string|null;revision:number;created_at:string;updated_at:string;completed_at:string|null};
const taskSelect=`SELECT t.id,t.title,t.due_at,t.priority,t.status,t.customer_id,c.name AS customer_name,t.revision,t.created_at,t.updated_at,t.completed_at
 FROM mayor_tasks t LEFT JOIN mayor_customers c ON c.id=t.customer_id AND c.tenant_id=t.tenant_id`;
const taskView=(row:TaskRow)=>({id:row.id,title:row.title,dueAt:row.due_at,priority:row.priority,status:row.status,
 customer:row.customer_id?{id:row.customer_id,name:row.customer_name,identityVerified:false}:null,
 revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,completedAt:row.completed_at});
type AgendaRow={id:string;input_json:string;state:string;pending:string|null;change_id:string|null;start_epoch:number;customer_id:string|null;customer_name:string|null;recovery_state:string|null;attempts:number|null;next_attempt_at:number|null;actor_id:string;created_at:string;updated_at:string};
const agendaFrom=`FROM mayor_appointments a JOIN mayor_appointment_jobs j ON j.id=a.id AND j.tenant_id=a.tenant_id
 LEFT JOIN mayor_appointment_changes c ON c.appointment_id=a.id AND c.tenant_id=a.tenant_id AND c.state IN ('running','uncertain')
 LEFT JOIN mayor_recovery_attempts r ON r.tenant_id=a.tenant_id AND r.request_id=COALESCE(c.id,j.id) AND r.kind=CASE WHEN c.id IS NULL THEN 'booking' ELSE 'change' END
 LEFT JOIN mayor_appointment_customers ac ON ac.booking_id=a.id AND ac.tenant_id=a.tenant_id
 LEFT JOIN mayor_customers cu ON cu.id=ac.customer_id AND cu.tenant_id=a.tenant_id`;
const agendaSelect=`SELECT a.id,a.input_json,a.state,c.state AS pending,c.id AS change_id,a.start_epoch,
 ac.customer_id,cu.name AS customer_name,r.state AS recovery_state,r.attempts,r.next_attempt_at,
 COALESCE(c.actor_id,j.actor_id) AS actor_id,a.created_at,a.updated_at ${agendaFrom}`;
const agendaView=(row:AgendaRow,actor:Actor)=>({id:row.id,input:bookingSchema.parse(JSON.parse(row.input_json)),status:row.pending??row.state,pendingChangeId:row.change_id,
 customer:row.customer_id?{id:row.customer_id,name:row.customer_name,identityVerified:false}:null,
 recovery:row.recovery_state?{status:row.recovery_state,attempts:row.attempts,nextCheckAt:row.recovery_state==='pending'&&row.next_attempt_at!==null?new Date(row.next_attempt_at).toISOString():null}:null,
 canCheck:row.actor_id===actor.userId,createdAt:row.created_at,updatedAt:row.updated_at});

function pageLimit(url:URL){return z.coerce.number().int().min(1).max(100).parse(url.searchParams.get('limit')??'25');}
function encodeCursor(scope:string,key:string,id:string){
 const bytes=new TextEncoder().encode(JSON.stringify({v:1,scope,key,id}));
 return btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
function decodeCursor(raw:string|null,scope:string){
 if(!raw)return null;
 try{
  if(raw.length>2048||!/^[a-zA-Z0-9_-]+$/.test(raw))throw new Error();
  const bytes=Uint8Array.from(atob(raw.replaceAll('-','+').replaceAll('_','/')),char=>char.charCodeAt(0));
  const input=cursorSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes)));
  if(input.scope!==scope)throw new Error();
  return input;
 }catch{throw new HttpError(400,'invalid_cursor','This page belongs to a different search. Refresh the list.');}
}
function localDate(time:number,timeZone:string){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time));
 const value=(name:string)=>parts.find(part=>part.type===name)!.value;
 return `${value('year')}-${value('month')}-${value('day')}`;
}
/** The first instant of a business-local date handles 23/25-hour DST days. */
function localDateBoundary(day:string,timeZone:string){
 const target=Date.parse(day+'T00:00:00Z');let lo=target-36*3600000,hi=target+36*3600000;
 while(lo<hi){const mid=Math.floor((lo+hi)/2);if(localDate(mid,timeZone)<day)lo=mid+1;else hi=mid;}
 return lo;
}
function dayWindow(day:string,timeZone:string){
 const parsed=date.parse(day),next=new Date(Date.parse(parsed+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 const start=localDateBoundary(parsed,timeZone),end=localDateBoundary(next,timeZone);
 if(start===end)throw new HttpError(400,'invalid_date','This date does not occur in the business timezone.');
 return {start:new Date(start).toISOString(),end:new Date(end).toISOString(),date:parsed};
}
async function businessClock(env:Env,actor:Actor){
 const [memory,scheduling]=await Promise.all([readMemory(env,actor),readSchedulingPolicy(env,actor)]);
 const confirmed=scheduling.policy?.timeZone??memory.profile.timeZone;
 return {timeZone:confirmed??'UTC',timeZoneKnown:Boolean(confirmed),timeZoneSource:scheduling.policy?'scheduling_policy':confirmed?'profile':'fallback',memory,scheduling};
}
async function readTask(env:Env,actor:Actor,id:string){
 const row=await env.AGENT_DB.prepare(`${taskSelect} WHERE t.id=? AND t.tenant_id=?`).bind(id,actor.tenantId).first<TaskRow>();
 if(!row)throw new HttpError(404,'task_unavailable','This task is not available.');
 await requireMembership(env,actor,OPERATORS);
 return row;
}
async function createTask(env:Env,actor:Actor,request:Request){
 const input=taskCreateSchema.parse(await readJson(request,4096));
 if(input.customerId)await readCustomer(env,actor,input.customerId);
 const id=input.requestId??crypto.randomUUID(),now=new Date().toISOString();
 const existing=await env.AGENT_DB.prepare('SELECT * FROM mayor_tasks WHERE id=? AND tenant_id=?').bind(id,actor.tenantId).first<TaskRow&{created_by:string}>();
 if(existing){
  if(existing.created_by!==actor.userId||existing.title!==input.title||existing.due_at!==(input.dueAt??null)||existing.priority!==(input.priority??'normal')||existing.customer_id!==(input.customerId??null))
   throw new HttpError(409,'request_changed','This request was already used for a different task.');
  await requireMembership(env,actor,OPERATORS);return json({task:taskView(await readTask(env,actor,id))});
 }
 const row=await env.AGENT_DB.prepare(`INSERT OR IGNORE INTO mayor_tasks(id,tenant_id,title,due_at,priority,customer_id,created_by,updated_by,created_at,updated_at)
 SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${permission} RETURNING id`).bind(id,actor.tenantId,input.title,input.dueAt??null,input.priority??'normal',input.customerId??null,actor.userId,actor.userId,now,now,actor.tenantId,actor.userId,now).first();
 if(!row)throw new HttpError(409,'task_changed','The task or your access changed. Refresh and try again.');
 await requireMembership(env,actor,OPERATORS);return json({task:taskView(await readTask(env,actor,id))},201);
}
async function updateTask(env:Env,actor:Actor,id:string,request:Request){
 const input=taskUpdateSchema.parse(await readJson(request,4096)),current=await readTask(env,actor,id);
 if(input.customerId)await readCustomer(env,actor,input.customerId);
 const now=new Date().toISOString(),status=input.status??current.status;
 const row=await env.AGENT_DB.prepare(`UPDATE mayor_tasks SET title=?,due_at=?,priority=?,customer_id=?,status=?,completed_at=?,updated_by=?,updated_at=?,revision=revision+1
 WHERE id=? AND tenant_id=? AND revision=? AND ${permission} RETURNING id`).bind(input.title??current.title,input.dueAt===undefined?current.due_at:input.dueAt,input.priority??current.priority,
 input.customerId===undefined?current.customer_id:input.customerId,status,status==='completed'?current.completed_at??now:null,actor.userId,now,id,actor.tenantId,input.revision,actor.tenantId,actor.userId,now).first();
 if(!row)throw new HttpError(409,'task_changed','The task changed. Review its current version before saving.');
 await requireMembership(env,actor,OPERATORS);return json({task:taskView(await readTask(env,actor,id))});
}
async function listTasks(env:Env,actor:Actor,url:URL){
 const limit=pageLimit(url),status=z.enum(['open','completed','all']).parse(url.searchParams.get('status')??'open');
 const customerId=url.searchParams.has('customerId')?z.uuid().parse(url.searchParams.get('customerId')):null;
 if(customerId)await readCustomer(env,actor,customerId);
 const before=url.searchParams.has('dueBefore')?instant.parse(url.searchParams.get('dueBefore')):null;
 const after=url.searchParams.has('dueAfter')?instant.parse(url.searchParams.get('dueAfter')):null;
 const clauses=['t.tenant_id=?'],values:(string|number)[]=[actor.tenantId];
 if(customerId){clauses.push('t.customer_id=?');values.push(customerId);}
 if(before){clauses.push('t.due_at<?');values.push(before);}
 if(after){clauses.push('t.due_at>=?');values.push(after);}
 const base=clauses.join(' AND ');
 const counts=await env.AGENT_DB.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(t.status='open'),0) AS open,COALESCE(SUM(t.status='completed'),0) AS completed FROM mayor_tasks t WHERE ${base}`).bind(...values).first<{total:number;open:number;completed:number}>();
 if(status!=='all'){clauses.push('t.status=?');values.push(status);}
 const scope=await digest(JSON.stringify(['tasks',actor.tenantId,actor.userId,status,customerId,before,after])),cursor=decodeCursor(url.searchParams.get('cursor'),scope);
 if(cursor){clauses.push("(COALESCE(t.due_at,?)>? OR (COALESCE(t.due_at,?)=? AND t.id>?))");values.push(nullDue,cursor.key,nullDue,cursor.key,cursor.id);}
 const rows=await env.AGENT_DB.prepare(`${taskSelect} WHERE ${clauses.join(' AND ')} ORDER BY COALESCE(t.due_at,?),t.id LIMIT ?`).bind(...values,nullDue,limit+1).all<TaskRow>();
 const items=rows.results.slice(0,limit),last=items.at(-1),hasMore=rows.results.length>limit;
 await requireMembership(env,actor,OPERATORS);
 return json({tasks:items.map(taskView),counts,total:status==='all'?counts!.total:counts![status],hasMore,nextCursor:hasMore&&last?encodeCursor(scope,last.due_at??nullDue,last.id):null});
}
async function listCustomers(env:Env,actor:Actor,url:URL){
 const limit=pageLimit(url),query=z.string().trim().max(160).parse(url.searchParams.get('q')??url.searchParams.get('query')??'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
 const scope=await digest(JSON.stringify(['customers',actor.tenantId,actor.userId,query])),cursor=decodeCursor(url.searchParams.get('cursor'),scope);
 const where=`tenant_id=? AND (?='' OR instr(name_key,?)>0 OR instr(COALESCE(email,''),?)>0 OR instr(COALESCE(phone,''),?)>0)`;
 const values:(string|number)[]=[actor.tenantId,query,query,query,query];
 const count=await env.AGENT_DB.prepare(`SELECT COUNT(*) AS total FROM mayor_customers WHERE ${where}`).bind(...values).first<{total:number}>();
 if(cursor)values.push(cursor.key,cursor.key,cursor.id);
 const rows=await env.AGENT_DB.prepare(`SELECT id,name,name_key,email,phone,revision,created_at,updated_at FROM mayor_customers WHERE ${where}
 ${cursor?'AND (name_key>? OR (name_key=? AND id>?))':''} ORDER BY name_key,id LIMIT ?`).bind(...values,limit+1).all<{id:string;name:string;name_key:string;email:string|null;phone:string|null;revision:number;created_at:string;updated_at:string}>();
 const items=rows.results.slice(0,limit),last=items.at(-1),hasMore=rows.results.length>limit;
 await requireMembership(env,actor,OPERATORS);
 return json({customers:items.map(({name_key,created_at,updated_at,...row})=>({...row,createdAt:created_at,updatedAt:updated_at,identityVerified:false})),total:count!.total,hasMore,nextCursor:hasMore&&last?encodeCursor(scope,last.name_key,last.id):null});
}
async function prepareContact(env:Env,actor:Actor,request:Request){
 const proposal=await prepareCustomer(env,actor,customerPatchSchema.parse(await readJson(request,4096))),now=new Date().toISOString();
 const id=crypto.randomUUID(),expiresAt=new Date(Date.now()+120000).toISOString();
 const row=await env.AGENT_DB.prepare(`INSERT INTO mayor_customer_proposals(id,tenant_id,actor_id,proposal_json,expires_at,created_at)
 SELECT ?,?,?,?,?,? WHERE ${permission} RETURNING id`).bind(id,actor.tenantId,actor.userId,JSON.stringify(proposal),expiresAt,now,actor.tenantId,actor.userId,now).first();
 if(!row)throw new HttpError(409,'customer_changed','Your access changed. Review the customer again.');
 return json({proposal:{id,customerId:proposal.id,expectedRevision:proposal.expectedRevision,profile:proposal.profile,expiresAt,readback:customerReadback(proposal)}},201);
}
async function confirmContact(env:Env,actor:Actor,request:Request){
 const input=confirmationSchema.parse(await readJson(request,512));
 const stored=await env.AGENT_DB.prepare('SELECT proposal_json,state,expires_at,result_json FROM mayor_customer_proposals WHERE id=? AND tenant_id=? AND actor_id=?')
  .bind(input.id,actor.tenantId,actor.userId).first<{proposal_json:string;state:string;expires_at:string;result_json:string|null}>();
 if(!stored)throw new HttpError(404,'confirmation_unavailable','This customer confirmation is not available.');
 if(stored.state==='confirmed'){await requireMembership(env,actor,OPERATORS);return json({result:JSON.parse(stored.result_json!)});}
 if(stored.expires_at<=new Date().toISOString())throw new HttpError(409,'confirmation_expired','Review the customer details again before saving.');
 const proposal=JSON.parse(stored.proposal_json) as CustomerProposal;
 let result;
 try{result=await confirmCustomer(env,actor,proposal);}catch(error){
  // A simultaneous confirmation may have won after both reads. The existing
  // service verifies exact content/revision before returning an idempotent receipt.
  if(!(error instanceof HttpError)||error.code!=='customer_changed')throw error;
  result=await confirmCustomer(env,actor,proposal);
 }
 const now=new Date().toISOString();
 await env.AGENT_DB.prepare(`UPDATE mayor_customer_proposals SET state='confirmed',result_json=?,confirmed_at=?
 WHERE id=? AND tenant_id=? AND actor_id=? AND state='pending' AND ${permission}`).bind(JSON.stringify(result),now,input.id,actor.tenantId,actor.userId,actor.tenantId,actor.userId,now).run();
 await requireMembership(env,actor,OPERATORS);return json({result});
}
async function listAgenda(env:Env,actor:Actor,url:URL){
 const clock=await businessClock(env,actor),limit=pageLimit(url);
 if(url.searchParams.has('date')&&(url.searchParams.has('start')||url.searchParams.has('end')))throw new HttpError(400,'invalid_range','Choose a date or a date range.');
 let range:{start:string;end:string};
 if(url.searchParams.has('start')||url.searchParams.has('end'))range={start:instant.parse(url.searchParams.get('start')),end:instant.parse(url.searchParams.get('end'))};
 else range=dayWindow(url.searchParams.get('date')??localDate(Date.now(),clock.timeZone),clock.timeZone);
 if(Date.parse(range.end)<=Date.parse(range.start)||Date.parse(range.end)-Date.parse(range.start)>93*86400000)throw new HttpError(400,'invalid_range','Choose a range of up to 93 days.');
 const status=z.enum(['all','confirmed','cancelled','running','uncertain']).parse(url.searchParams.get('status')??'all');
 const customerId=url.searchParams.has('customerId')?z.uuid().parse(url.searchParams.get('customerId')):null;
 if(customerId)await readCustomer(env,actor,customerId);
 const clauses=['a.tenant_id=?','a.start_epoch<?','a.end_epoch>?'],values:(string|number)[]=[actor.tenantId,Date.parse(range.end)/1000,Date.parse(range.start)/1000];
 if(status!=='all'){clauses.push('COALESCE(c.state,a.state)=?');values.push(status);}
 if(customerId){clauses.push('ac.customer_id=?');values.push(customerId);}
 const count=await env.AGENT_DB.prepare(`SELECT COUNT(*) AS total ${agendaFrom} WHERE ${clauses.join(' AND ')}`).bind(...values).first<{total:number}>();
 const scope=await digest(JSON.stringify(['agenda',actor.tenantId,actor.userId,range.start,range.end,status,customerId])),cursor=decodeCursor(url.searchParams.get('cursor'),scope);
 if(cursor){const key=z.coerce.number().int().safe().parse(cursor.key);clauses.push('(a.start_epoch>? OR (a.start_epoch=? AND a.id>?))');values.push(key,key,cursor.id);}
 const rows=await env.AGENT_DB.prepare(`${agendaSelect} WHERE ${clauses.join(' AND ')} ORDER BY a.start_epoch,a.id LIMIT ?`).bind(...values,limit+1).all<AgendaRow>();
 const items=rows.results.slice(0,limit),last=items.at(-1),hasMore=rows.results.length>limit;
 await requireMembership(env,actor,OPERATORS);
 return json({appointments:items.map(row=>agendaView(row,actor)),total:count!.total,hasMore,nextCursor:hasMore&&last?encodeCursor(scope,String(last.start_epoch),last.id):null,...range,timeZone:clock.timeZone,timeZoneKnown:clock.timeZoneKnown,source:{...agendaSource,checkedAt:new Date().toISOString()}});
}
async function listCallbacks(env:Env,actor:Actor,url:URL){
 const limit=pageLimit(url),scope=await digest(JSON.stringify(['callbacks',actor.tenantId,actor.userId])),cursor=decodeCursor(url.searchParams.get('cursor'),scope);
 const count=await env.AGENT_DB.prepare("SELECT COUNT(*) AS total FROM mayor_callbacks WHERE tenant_id=? AND status='pending'").bind(actor.tenantId).first<{total:number}>();
 const rows=await env.AGENT_DB.prepare(`SELECT id,number,reason,created_at AS createdAt FROM mayor_callbacks WHERE tenant_id=? AND status='pending'
 ${cursor?'AND (created_at>? OR (created_at=? AND id>?))':''} ORDER BY created_at,id LIMIT ?`).bind(actor.tenantId,...(cursor?[cursor.key,cursor.key,cursor.id]:[]),limit+1).all<{id:string;number:string;reason:string;createdAt:string}>();
 const items=rows.results.slice(0,limit),last=items.at(-1),hasMore=rows.results.length>limit;
 await requireMembership(env,actor,OPERATORS);
 return json({callbacks:items,total:count!.total,hasMore,nextCursor:hasMore&&last?encodeCursor(scope,last.createdAt,last.id):null,identityVerified:false});
}
async function overview(env:Env,actor:Actor,url:URL){
 const [tenant,clock,calendar,schedulingSetup]=await Promise.all([requireTenant(env,actor),businessClock(env,actor),selectedCalendar(env,actor),readSchedulingSetup(env,actor)]);
 const now=new Date().toISOString(),nowSeconds=Date.parse(now)/1000,range=dayWindow(url.searchParams.get('date')??localDate(Date.parse(now),clock.timeZone),clock.timeZone);
 const [customerCount,taskCounts,callbackCount,missedCallsPending,appointmentCounts,bookingCounts,changeCounts,unread,phoneCount,tasks,appointments,routineNotice]=await Promise.all([
  env.AGENT_DB.prepare('SELECT COUNT(*) AS total FROM mayor_customers WHERE tenant_id=?').bind(actor.tenantId).first<{total:number}>(),
  env.AGENT_DB.prepare(`SELECT COALESCE(SUM(status='open'),0) AS open,COALESCE(SUM(status='completed'),0) AS completed,
   COALESCE(SUM(status='open' AND due_at>=? AND due_at<?),0) AS due_today,
   COALESCE(SUM(status='open' AND due_at<?),0) AS overdue FROM mayor_tasks WHERE tenant_id=?`).bind(range.start,range.end,now,actor.tenantId).first<{open:number;completed:number;due_today:number;overdue:number}>(),
  env.AGENT_DB.prepare("SELECT COUNT(*) AS total FROM mayor_callbacks WHERE tenant_id=? AND status='pending'").bind(actor.tenantId).first<{total:number}>(),
  env.AGENT_DB.prepare("SELECT COUNT(*) AS total FROM mayor_missed_calls WHERE tenant_id=? AND status='missed' AND textback_sent_at IS NULL").bind(actor.tenantId).first<{total:number}>(),
  env.AGENT_DB.prepare("SELECT COUNT(*) AS today FROM mayor_appointments WHERE tenant_id=? AND state!='cancelled' AND start_epoch<? AND end_epoch>?").bind(actor.tenantId,Date.parse(range.end)/1000,Date.parse(range.start)/1000).first<{today:number}>(),
  env.AGENT_DB.prepare(`SELECT COUNT(*) AS pending,COALESCE(SUM(j.state='uncertain' OR r.state='review'),0) AS review
   FROM mayor_appointment_jobs j LEFT JOIN mayor_recovery_attempts r ON r.kind='booking' AND r.request_id=j.id AND r.tenant_id=j.tenant_id
   WHERE j.tenant_id=? AND j.state IN ('running','uncertain')`).bind(actor.tenantId).first<{pending:number;review:number}>(),
  env.AGENT_DB.prepare(`SELECT COUNT(*) AS pending,COALESCE(SUM(c.state='uncertain' OR r.state='review'),0) AS review
   FROM mayor_appointment_changes c LEFT JOIN mayor_recovery_attempts r ON r.kind='change' AND r.request_id=c.id AND r.tenant_id=c.tenant_id
   WHERE c.tenant_id=? AND c.state IN ('running','uncertain')`).bind(actor.tenantId).first<{pending:number;review:number}>(),
  env.AGENT_DB.prepare("SELECT COUNT(*) AS total FROM mayor_notifications WHERE tenant_id=? AND user_id=? AND state='open' AND read_at IS NULL").bind(actor.tenantId,actor.userId).first<{total:number}>(),
  env.AGENT_DB.prepare("SELECT COUNT(*) AS total FROM mayor_phone_connections WHERE tenant_id=? AND status='authorized' AND selected_number IS NOT NULL").bind(actor.tenantId).first<{total:number}>(),
  env.AGENT_DB.prepare(`${taskSelect} WHERE t.tenant_id=? AND t.status='open' ORDER BY COALESCE(t.due_at,?),t.id LIMIT 6`).bind(actor.tenantId,nullDue).all<TaskRow>(),
  env.AGENT_DB.prepare(`${agendaSelect} WHERE a.tenant_id=? AND a.state!='cancelled' AND a.start_epoch<? AND a.end_epoch>?
   ORDER BY a.start_epoch,a.id LIMIT 6`).bind(actor.tenantId,Date.parse(range.end)/1000,url.searchParams.has('date')?Date.parse(range.start)/1000:Math.max(nowSeconds,Date.parse(range.start)/1000)).all<AgendaRow>(),
  env.AGENT_DB.prepare("SELECT id FROM mayor_business_routine_runs WHERE tenant_id=? AND user_id=? AND state='ready' AND read_at IS NULL ORDER BY updated_at DESC,id DESC LIMIT 1").bind(actor.tenantId,actor.userId).first<{id:string}>(),
 ]);
 const profileComplete=Boolean(clock.memory.profile.name&&(clock.memory.profile.description?.trim()||clock.memory.profile.services?.length));
 type Attention={id:string;kind:string;title:string;detail:string;action:string;resourceId:string|null;count:number};
 const attention:Attention[]=[],missing:Attention[]=[];
 const addSetup=(id:string,title:string,detail:string,action:string)=>{const item={id,kind:'setup',title,detail,action,resourceId:null,count:1};missing.push(item);attention.push(item);};
 if(!profileComplete)addSetup('business-profile','Add your business details','Confirm your business name and the services you offer.','chat');
 if(!clock.timeZoneKnown)addSetup('business-timezone','Set your business timezone','Dates currently use UTC until you confirm your business timezone.','chat');
 if(!calendar?.available)addSetup('scheduling-calendar',calendar?'Reconnect your scheduling calendar':'Connect a scheduling calendar','A working selected calendar is required before booking appointments.','account');
 if(!clock.scheduling.policy)addSetup('scheduling-rules','Finish your booking rules',schedulingSetup.nextQuestion??'Review and activate your scheduling setup.','chat');
 if(taskCounts!.overdue)attention.push({id:'overdue-tasks',kind:'task',title:`${taskCounts!.overdue} overdue ${taskCounts!.overdue===1?'task':'tasks'}`,detail:'Review open tasks whose due time has passed.',action:'tasks',resourceId:null,count:taskCounts!.overdue});
 if(callbackCount!.total)attention.push({id:'pending-callbacks',kind:'callback',title:`${callbackCount!.total} pending ${callbackCount!.total===1?'callback':'callbacks'}`,detail:'Return contacts are unverified. Mark each request handled after you follow up.',action:'callbacks',resourceId:null,count:callbackCount!.total});
 if(missedCallsPending!.total)attention.push({id:'missed-calls',kind:'missed_call',title:`${missedCallsPending!.total} missed ${missedCallsPending!.total===1?'call needs':'calls need'} text-back`,detail:'A fast text-back can still recover the customer. Review the missed calls.',action:'missed-calls',resourceId:null,count:missedCallsPending!.total});
 const reviewCount=bookingCounts!.review+changeCounts!.review;
 if(reviewCount)attention.push({id:'appointment-review',kind:'appointment_review',title:`${reviewCount} appointment ${reviewCount===1?'request needs':'requests need'} review`,detail:'The provider result is uncertain. Check the original request before creating another appointment.',action:'agenda',resourceId:null,count:reviewCount});
 if(unread!.total)attention.push({id:'unread-notifications',kind:'notification',title:`${unread!.total} unread ${unread!.total===1?'notification':'notifications'}`,detail:'Review account checks and phone issues in your notifications.',action:'notifications',resourceId:null,count:unread!.total});
 if(routineNotice)attention.push({id:'business-routine-ready',kind:'notification',title:'Your business brief is ready',detail:'Review grounded priorities and draft suggestions. Nothing was sent or changed.',action:'tasks',resourceId:routineNotice.id,count:1});
 await requireMembership(env,actor,OPERATORS);
 return json({business:{id:tenant.id,name:clock.memory.profile.name??tenant.name,timeZone:clock.timeZone,timeZoneKnown:clock.timeZoneKnown,timeZoneSource:clock.timeZoneSource},date:range.date,start:range.start,end:range.end,
  attention,appointments:appointments.results.map(row=>agendaView(row,actor)),tasks:tasks.results.map(taskView),
  counts:{customers:customerCount!.total,appointmentsToday:appointmentCounts!.today,tasksOpen:taskCounts!.open,tasksCompleted:taskCounts!.completed,tasksDueToday:taskCounts!.due_today,tasksOverdue:taskCounts!.overdue,
   callbacksPending:callbackCount!.total,bookingsPending:bookingCounts!.pending,appointmentChangesPending:changeCounts!.pending,appointmentReviews:reviewCount,unreadNotifications:unread!.total+Number(Boolean(routineNotice)),attention:attention.reduce((sum,item)=>sum+item.count,0)},
  setup:{profileComplete,timeZoneKnown:clock.timeZoneKnown,calendarConnected:Boolean(calendar?.available),schedulingReady:Boolean(clock.scheduling.policy),phoneConnected:Boolean(phoneCount!.total),missing},
  source:{...agendaSource,checkedAt:now,appointmentPreviewLimit:6,taskPreviewLimit:6}});
}

/** Router supplies a session actor; every matched route independently checks the
 * business, management role and mutation origin. Unmatched routes return null. */
export async function handleOperationsRequest(request:Request,env:Env,actor:Actor):Promise<Response|null>{
 const url=new URL(request.url),route=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/(overview|tasks(?:\/[a-f0-9-]{36})?|customers(?:\/(?:prepare|confirm|[a-f0-9-]{36}))?|agenda|callbacks(?:\/[a-f0-9-]{36}\/handled)?|appointments\/(?:propose|confirm)|appointment-changes\/(?:propose|confirm|reconcile)|availability)$/);
 if(!route)return null;
 if(route[1]!==actor.tenantId)throw new HttpError(404,'workspace_not_found','This workspace is not available.');
 await requireMembership(env,actor,OPERATORS);
 if(request.method!=='GET')requireOrigin(request,env.APP_ORIGIN);
 const path=route[2];
 if(request.method==='GET'){
  if(path==='overview')return overview(env,actor,url);
  if(path==='tasks')return listTasks(env,actor,url);
  if(path==='customers')return listCustomers(env,actor,url);
  if(/^customers\/[a-f0-9-]{36}$/.test(path)){const id=z.uuid().parse(path.slice(10));const customer=await readCustomer(env,actor,id);await requireMembership(env,actor,OPERATORS);return json({customer});}
  if(path==='agenda')return listAgenda(env,actor,url);
  if(path==='callbacks')return listCallbacks(env,actor,url);
 }
 if(request.method==='POST'){
  if(path==='tasks')return createTask(env,actor,request);
  if(path.startsWith('tasks/'))return updateTask(env,actor,z.uuid().parse(path.slice(6)),request);
  if(path==='customers/prepare')return prepareContact(env,actor,request);
  if(path==='customers/confirm')return confirmContact(env,actor,request);
  if(path.startsWith('callbacks/')){z.object({confirm:z.literal(true)}).strict().parse(await readJson(request,256));const callback=await handleCallback(env,actor,z.uuid().parse(path.split('/')[1]));await requireMembership(env,actor,OPERATORS);return json({callback});}
  if(path==='appointments/propose'){const proposal=await proposeBooking(env,actor,bookingProposalSchema.parse(await readJson(request,8192)));return json({proposal:{...proposal,readback:bookingReadback(proposal)}},201);}
  if(path==='appointments/confirm'){const input=confirmationSchema.parse(await readJson(request,512));return json({result:await confirmBooking(env,actor,input.id)});}
  if(path==='appointment-changes/propose'){const proposal=await proposeAppointmentChange(env,actor,changeSchema.parse(await readJson(request,4096)));return json({proposal:{...proposal,readback:changeReadback(proposal)}},201);}
  if(path==='appointment-changes/confirm'){const input=confirmationSchema.parse(await readJson(request,512));return json({result:await confirmAppointmentChange(env,actor,input.id)});}
  if(path==='appointment-changes/reconcile'){const input=z.object({id:z.uuid()}).strict().parse(await readJson(request,512));return json({result:await reconcileAppointmentChange(env,actor,input.id)});}
  if(path==='availability')return json(await findAvailability(env,actor,availabilitySchema.parse(await readJson(request,4096))));
 }
 return json({error:'method_not_allowed',message:'This action is not supported.'},405);
}
