import {z} from 'zod';
import type {Actor,Env} from './env';
import {requireMembership,OPERATORS} from './permissions';
import {HttpError} from './http';
import {schedulingPolicySchema,readSchedulingPolicy} from './scheduling-policy';
import {readMemory} from './memory';

const fields=schedulingPolicySchema.shape;
// Unknown values are omitted, never filled with operational defaults.
export const schedulingDetailsSchema=z.object({...fields,
 appointmentTypes:z.array(fields.appointmentTypes.element.partial({durationMinutes:true,bufferBeforeMinutes:true,bufferAfterMinutes:true})).min(1).max(30),
 staff:z.array(fields.staff.element.partial({weeklyHours:true,appointmentTypes:true})).max(50),
}).partial().strict().superRefine((details,ctx)=>{
 for(const field of ['appointmentTypes','staff'] as const){
  const names=details[field]?.map(item=>item.name.toLowerCase());
  if(names&&new Set(names).size!==names.length)ctx.addIssue({code:'custom',path:[field],message:'Names must be unique.'});
 }
 if(details.appointmentTypes&&details.staff?.some(person=>person.appointmentTypes?.some(name=>!details.appointmentTypes!.some(type=>type.name===name))))ctx.addIssue({code:'custom',path:['staff'],message:'Staff must reference a listed appointment type.'});
});
export const schedulingDetailsPatchSchema=schedulingDetailsSchema.refine(value=>Object.keys(value).length>0,'Provide at least one scheduling detail.');
export type SchedulingDetails=z.infer<typeof schedulingDetailsSchema>;
export type SchedulingSetupProposal={details:SchedulingDetails;patch:SchedulingDetails;revision:number};
const changed=()=>new HttpError(409,'scheduling_setup_changed','Scheduling setup changed. Read it again before confirming.');
const label=(value:string)=>value.replace(/([A-Z])/g,' $1').toLowerCase();
function nextSetupQuestion(details:SchedulingDetails,profileTimeZone?:string):string|null{
 if(details.timeZone===undefined)return profileTimeZone?`Use ${profileTimeZone} for appointments too?`:'What time zone does your business use?';
 if(details.weeklyHours===undefined)return 'Which days and hours should be open for appointments?';
 if(details.appointmentTypes===undefined)return 'What kind of appointment should clients be able to book first?';
 for(const type of details.appointmentTypes){
  if(type.durationMinutes===undefined)return `How many minutes should ${type.name} take?`;
  if(type.bufferBeforeMinutes===undefined)return `How many minutes should be kept free before ${type.name}? You can say zero.`;
  if(type.bufferAfterMinutes===undefined)return `How many minutes should be kept free after ${type.name}? You can say zero.`;
 }
 if(details.staff===undefined)return 'Should clients choose a staff member, or use one shared schedule without a staff choice?';
 for(const person of details.staff){
  if(person.weeklyHours===undefined)return `Which days and hours can ${person.name} take appointments?`;
  if(person.appointmentTypes===undefined)return `Which appointment types can ${person.name} provide?`;
 }
 if(details.minimumNoticeMinutes===undefined)return 'How much notice do you need before a new appointment?';
 if(details.maximumAdvanceDays===undefined)return 'How many days ahead should clients be able to book?';
 if(details.cancellationNoticeMinutes===undefined)return 'How much notice do you need for a cancellation?';
 if(details.closedDates===undefined)return 'Are there specific dates when you are closed all day? You can say none.';
 return null;
}
export function schedulingSetupStatus(details:SchedulingDetails,profileTimeZone?:string){
 const complete=schedulingPolicySchema.safeParse(details);
 const missing=complete.success?[]:complete.error.issues.map(issue=>issue.path.map(part=>typeof part==='number'?String(part+1):label(String(part))).join(' / '));
 return {readyForReview:complete.success,missing:[...new Set(missing)],nextQuestion:nextSetupQuestion(details,profileTimeZone)};
}
async function confirmedTimeZoneCandidate(env:Env,actor:Actor,details:SchedulingDetails){
 if(details.timeZone!==undefined)return undefined;
 const memory=await readMemory(env,actor),candidate=fields.timeZone.safeParse(memory.profile.timeZone);
 // A confirmed profile fact is a question candidate, never a saved booking rule.
 return memory.confirmedAt&&candidate.success?candidate.data:undefined;
}
export async function readSchedulingSetup(env:Env,actor:Actor){
 await requireMembership(env,actor);
 const active=await readSchedulingPolicy(env,actor);
 if(active.policy)return {details:null,revision:0,active:true,readyForReview:false,missing:[],lines:schedulingDetailsLines(active.policy),nextQuestion:null};
 const row=await env.AGENT_DB.prepare("SELECT value_json,revision FROM mayor_memory WHERE tenant_id=? AND field='scheduling_setup'").bind(actor.tenantId).first<{value_json:string;revision:number}>();
 // Access can change while D1 is reading; discard data for a revoked reader.
 await requireMembership(env,actor);
 const details=row?schedulingDetailsSchema.parse(JSON.parse(row.value_json)):{};
 return {details,revision:row?.revision??0,active:false,lines:schedulingDetailsLines(details),...schedulingSetupStatus(details,await confirmedTimeZoneCandidate(env,actor,details))};
}
export async function proposeSchedulingSetup(env:Env,actor:Actor,raw:SchedulingDetails):Promise<SchedulingSetupProposal>{
 await requireMembership(env,actor,OPERATORS);
 const supplied=schedulingDetailsPatchSchema.parse(raw),current=await readSchedulingSetup(env,actor);
 if(current.active)throw new HttpError(409,'policy_already_active','Scheduling rules are already active. Propose a change to those rules instead.');
 const patch=Object.fromEntries(Object.entries(supplied).filter(([key,value])=>JSON.stringify(current.details?.[key as keyof SchedulingDetails])!==JSON.stringify(value))) as SchedulingDetails;
 // Top-level replacement is deliberate. Lists are read back in full; omitted
 // top-level fields stay unchanged. No guessed nested defaults or array merging.
 const details=schedulingDetailsSchema.parse({...current.details,...patch});
 return {details,patch,revision:current.revision};
}
export async function confirmSchedulingSetup(env:Env,actor:Actor,proposal:SchedulingSetupProposal){
 await requireMembership(env,actor,OPERATORS);
 if(!Object.keys(proposal.patch).length)throw new HttpError(409,'setup_unchanged','These scheduling details are already saved.');
 const details=schedulingDetailsSchema.parse(proposal.details),now=new Date().toISOString();
 const permitted=`EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?)) AND NOT EXISTS(SELECT 1 FROM mayor_memory WHERE tenant_id=? AND field='scheduling_policy')`;
 const write=proposal.revision===0
  ?env.AGENT_DB.prepare(`INSERT OR IGNORE INTO mayor_memory(tenant_id,field,value_json,source_kind,confirmed_by,confirmed_at,revision,updated_at) SELECT ?,'scheduling_setup',?,'owner_conversation',?,?,1,? WHERE ${permitted}`).bind(actor.tenantId,JSON.stringify(details),actor.userId,now,now,actor.tenantId,actor.userId,now,actor.tenantId)
  :env.AGENT_DB.prepare(`UPDATE mayor_memory SET value_json=?,confirmed_by=?,confirmed_at=?,revision=revision+1,updated_at=? WHERE tenant_id=? AND field='scheduling_setup' AND revision=? AND ${permitted}`).bind(JSON.stringify(details),actor.userId,now,now,actor.tenantId,proposal.revision,actor.tenantId,actor.userId,now,actor.tenantId);
 const result=await env.AGENT_DB.batch([write,env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) SELECT ?,?,?,'scheduling_setup.confirmed',?,? WHERE changes()=1").bind(crypto.randomUUID(),actor.tenantId,actor.userId,String(proposal.revision+1),now)]);
 if(result[0].meta.changes!==1)throw changed();
 return {details,revision:proposal.revision+1,...schedulingSetupStatus(details,await confirmedTimeZoneCandidate(env,actor,details))};
}
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const time=(minute:number)=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
const hours=(items:NonNullable<SchedulingDetails['weeklyHours']>)=>items.length?items.map(item=>`${days[item.day]} ${time(item.startMinute)} to ${time(item.endMinute)}`).join('; '):'no open periods';
const minutes=(value:number|undefined)=>value===undefined?'unknown':`${value} minutes`;
export function schedulingDetailsLines(details:SchedulingDetails){
 const lines:string[]=[];
 if(details.timeZone!==undefined)lines.push(`Time zone: ${details.timeZone}`);
 if(details.weeklyHours!==undefined)lines.push(`Business hours: ${hours(details.weeklyHours)}`);
 if(details.appointmentTypes!==undefined)lines.push(`Appointment types: ${details.appointmentTypes.map(item=>`${item.name}, duration ${minutes(item.durationMinutes)}, buffer before ${minutes(item.bufferBeforeMinutes)}, buffer after ${minutes(item.bufferAfterMinutes)}`).join('; ')}`);
 if(details.staff!==undefined)lines.push(`Staff: ${details.staff.length?details.staff.map(item=>`${item.name}, hours ${item.weeklyHours?hours(item.weeklyHours):'unknown'}, appointment types ${item.appointmentTypes?.join(', ')??'unknown'}`).join('; '):'no staff choice'}`);
 if(details.closedDates!==undefined)lines.push(`Closed dates: ${details.closedDates.join(', ')||'none specified'}`);
 if(details.minimumNoticeMinutes!==undefined)lines.push(`Minimum booking notice: ${minutes(details.minimumNoticeMinutes)}`);
 if(details.maximumAdvanceDays!==undefined)lines.push(`Book up to ${details.maximumAdvanceDays} days ahead`);
 if(details.cancellationNoticeMinutes!==undefined)lines.push(`Cancellation notice: ${minutes(details.cancellationNoticeMinutes)}`);
 return lines;
}
export function schedulingSetupReadback(proposal:SchedulingSetupProposal){
 return `Please verify these scheduling setup details: ${schedulingDetailsLines(proposal.patch).join('. ')}. These replace the listed details only. Missing rules stay unknown; booking rules are not activated. Say “yes, that is correct” to save this progress, or tell me what to correct.`;
}
