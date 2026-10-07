// Fixed synthetic policy and busy time only. No DB, credentials or provider calls.
import {streamText,tool,stepCountIs} from 'ai';
import {mayorModel} from '../../src/ai-model';
import {availabilitySchema,availableSlots} from '../../src/availability';
import type {SchedulingPolicy} from '../../src/scheduling-policy';
export default {async fetch(_request:Request,env:{AI:Ai}){
 const policy:SchedulingPolicy={timeZone:'America/New_York',weeklyHours:[{day:1,startMinute:540,endMinute:720}],closedDates:[],appointmentTypes:[{name:'Visit',durationMinutes:30,bufferBeforeMinutes:15,bufferAfterMinutes:15}],staff:[],minimumNoticeMinutes:0,maximumAdvanceDays:60,cancellationNoticeMinutes:0};
 const started=Date.now();let count=0,first='',policyMs=0;
 const result=streamText({model:mayorModel(env.AI),prompt:'Call findAvailability to find two Visit openings on September 21, 2026 between 09:00 and 12:00 in America/New_York (UTC-04:00). There is no staff configured. This is a synthetic test; do not book anything.',maxOutputTokens:180,
  toolChoice:{type:'tool',toolName:'findAvailability'},stopWhen:stepCountIs(1),
  tools:{findAvailability:tool({inputSchema:availabilitySchema,execute:async input=>{
   count++;const began=Date.now();
   const slots=availableSlots(policy,input,[{start:'2026-09-21T13:30:00Z',end:'2026-09-21T14:00:00Z'}],Date.parse('2026-09-20T12:00:00Z'));
   policyMs=Date.now()-began;first=slots[0]?.start??'';return {slots,held:false};
  }})}});
 let failed=false;for await(const part of result.fullStream)if(['error','tool-error'].includes(part.type))failed=true;
 return Response.json({ok:!failed&&count===1&&first==='2026-09-21T14:15:00.000Z',toolExecutions:count,first,policyMs,modelAndToolMs:Date.now()-started,synthetic:true});
}};
