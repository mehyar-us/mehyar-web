import {z} from 'zod';
import {schedulingPolicySchema} from './scheduling-policy';
import {schedulingDetailsSchema,schedulingDetailsPatchSchema} from './scheduling-setup';

const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'] as const;
const numbers:Record<string,string>={one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',ten:'10',eleven:'11',twelve:'12'};
/** Parse explicit wall-clock notation only; never infer a time zone or AM/PM. */
export function clockMinutes(raw:string):number|null{
 let value=raw.trim().toLowerCase().replace(/\s+/g,' ').replace(/([ap])\.m\.?$/,'$1m');
 if(value==='noon')return 720;if(value==='midnight')return 0;
 value=value.replace(/ in the morning$/,' am').replace(/ in the (afternoon|evening)$/,' pm');
 value=value.replace(/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/,word=>numbers[word]);
 const meridiem=/^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)$/.exec(value);
 if(meridiem){const hour=Number(meridiem[1]);if(hour<1||hour>12)return null;return (hour%12+(meridiem[3]==='pm'?12:0))*60+Number(meridiem[2]??0);}
 const military=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
 if(military)return Number(military[1])*60+Number(military[2]);
 return value==='24:00'?1440:null;
}
const clock=z.string().trim().max(50).refine(value=>clockMinutes(value)!==null,'Use an explicit clock time such as 9 AM, 5 PM or 17:00. Ask which AM/PM when ambiguous.')
 .describe('Local clock time exactly as the user means it, e.g. 9 AM or 5 PM. Do not compute minutes, shift time zones or infer missing AM/PM.');
const spokenHours=z.array(z.object({day:z.enum(weekdays),opens:clock,closes:clock}).strict()).max(42);
const convertHours=(hours:z.infer<typeof spokenHours>)=>hours.map(period=>{
 const startMinute=clockMinutes(period.opens)!,end=clockMinutes(period.closes)!;
 // Closing at midnight ends this day's interval. Other overnight intervals
 // must still be split across their explicitly named days.
 return {day:weekdays.indexOf(period.day),startMinute,endMinute:end===0&&startMinute>0?1440:end};
});
// The model handles language, while the server handles indexes and clock math.
// The resulting data still passes every existing policy/setup validation rule.
export const schedulingDetailsInputSchema=z.object({...schedulingDetailsSchema.shape,
 noStaffChoice:z.literal(true).optional().describe('Set true when the user explicitly says no staff choice or one shared schedule. Omit when unknown.'),
 noClosedDates:z.literal(true).optional().describe('Set true when the user explicitly says no closed dates. Omit when unknown.'),
 closedDates:schedulingDetailsSchema.shape.closedDates.describe('When the user explicitly says no closed dates, include an empty array []. Omit only when not yet answered.'),
 weeklyHours:spokenHours.optional(),
 staff:z.array(schedulingPolicySchema.shape.staff.element.partial({weeklyHours:true,appointmentTypes:true}).extend({weeklyHours:spokenHours.optional()})).max(50).optional().describe('When the user explicitly says no staff choice or one shared schedule, include an empty array []. Omit only when not yet answered.'),
}).strict().superRefine((input,ctx)=>{
 if(input.noStaffChoice&&input.staff?.length)ctx.addIssue({code:'custom',path:['staff'],message:'No staff choice conflicts with listed staff.'});
 if(input.noClosedDates&&input.closedDates?.length)ctx.addIssue({code:'custom',path:['closedDates'],message:'No closed dates conflicts with listed dates.'});
}).transform(({noStaffChoice,noClosedDates,...input})=>({...input,
 ...(noClosedDates?{closedDates:[]}:{}),
 ...(input.weeklyHours!==undefined?{weeklyHours:convertHours(input.weeklyHours)}:{}),
 ...(noStaffChoice?{staff:[]}:input.staff!==undefined?{staff:input.staff.map(person=>({...person,...(person.weeklyHours!==undefined?{weeklyHours:convertHours(person.weeklyHours)}:{})}))}:{}),
})).pipe(schedulingDetailsPatchSchema);
