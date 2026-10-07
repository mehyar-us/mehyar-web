import {z} from 'zod';
export const checkScheduleSchema=z.object({
 timeZone:z.string().min(1).max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}}),
 frequency:z.enum(['daily','weekdays']),
 hour:z.number().int().min(0).max(23),
 minute:z.number().int().min(0).max(59).refine(value=>value%5===0,'Choose a five-minute increment.'),
}).strict();
export type CheckSchedule=z.infer<typeof checkScheduleSchema>;
/** Once per local day. Nonexistent DST times skip that day; repeated times run once. */
export function nextCheckRun(raw:CheckSchedule,after:number,previousLocalDate?:string){
 const schedule=checkScheduleSchema.parse(raw);
 const format=new Intl.DateTimeFormat('en-CA',{timeZone:schedule.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'});
 for(let time=(Math.floor(after/300000)+1)*300000;time<after+8*86400000;time+=300000){
  const parts=Object.fromEntries(format.formatToParts(time).map(part=>[part.type,part.value]));
  const date=`${parts.year}-${parts.month}-${parts.day}`;
  if(date===previousLocalDate||schedule.frequency==='weekdays'&&['Sat','Sun'].includes(parts.weekday))continue;
  if(Number(parts.hour)===schedule.hour&&Number(parts.minute)===schedule.minute)return {at:new Date(time).toISOString(),date};
 }
 throw new Error('No scheduled occurrence could be determined.');
}
