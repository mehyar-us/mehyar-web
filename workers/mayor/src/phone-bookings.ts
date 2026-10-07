import {z} from 'zod';
import type {Env} from './env';
import {phoneCustomer,assertPhoneCustomer} from './customer-phone-access';
import {readSchedulingPolicy} from './scheduling-policy';
import {selectedCalendar} from './calendars';
import {availabilitySchema,findAvailability} from './availability';
import {bookingSchema,proposeBooking,confirmBooking} from './appointments';
import {assertPhoneBookingAuthority} from './phone-booking-authorization';
import {HttpError} from './http';
const deny=()=>new HttpError(403,'phone_booking_unavailable','Phone booking is unavailable. Please ask the business for help.');
async function bookingScope(env:Env,callId:string){const scope=await phoneCustomer(env,callId);if(!scope.allowBookings)throw deny();return scope;}
export async function phoneBookingOptions(env:Env,callId:string){
 const scope=await bookingScope(env,callId),actor={tenantId:scope.tenantId,userId:scope.grantor};
 const [{policy},calendar]=await Promise.all([readSchedulingPolicy(env,actor),selectedCalendar(env,actor)]);
 if(!policy||!calendar?.available)throw deny();
 await assertPhoneCustomer(env,callId,scope);
 return {scope,timeZone:policy.timeZone,appointmentTypes:policy.appointmentTypes.map(type=>({name:type.name,durationMinutes:type.durationMinutes})),staff:policy.staff.map(person=>({name:person.name,appointmentTypes:person.appointmentTypes}))};
}
export async function findPhoneAvailability(env:Env,callId:string,raw:z.infer<typeof availabilitySchema>,transport:typeof fetch=fetch){
 const scope=await bookingScope(env,callId),input=availabilitySchema.parse(raw);
 const result=await findAvailability(env,{tenantId:scope.tenantId,userId:scope.grantor},{...input,limit:Math.min(input.limit,3)},transport);
 await assertPhoneCustomer(env,callId,scope);
 return {scope,slots:result.slots,timeZone:result.timeZone,checkedAt:result.checkedAt};
}
export const phoneBookingSlotSchema=bookingSchema.omit({title:true,attendees:true});
export async function proposePhoneBooking(env:Env,callId:string,raw:z.infer<typeof phoneBookingSlotSchema>){
 const slot=phoneBookingSlotSchema.parse(raw),scope=await bookingScope(env,callId),actor={tenantId:scope.tenantId,userId:scope.grantor};
 const proposal=await proposeBooking(env,actor,{...slot,title:'Appointment',attendees:[],customerId:scope.customerId});
 await assertPhoneCustomer(env,callId,scope);
 const now=new Date().toISOString();
 await env.AGENT_DB.batch([
  env.AGENT_DB.prepare('INSERT INTO mayor_phone_bookings(booking_id,tenant_id,call_id,customer_id,scope_json,created_at) VALUES(?,?,?,?,?,?)').bind(proposal.id,scope.tenantId,callId,scope.customerId,JSON.stringify(scope),now),
  env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) VALUES(?,?,?,'phone.booking_proposed',?,?)").bind(crypto.randomUUID(),scope.tenantId,'phone:'+callId,proposal.id,now),
 ]);
 return {id:proposal.id,scope,slot,timeZone:proposal.timeZone,expiresAt:proposal.expiresAt};
}
export async function confirmPhoneBooking(env:Env,callId:string,id:string,valid:()=>boolean,transport:typeof fetch=fetch){
 const scope=await bookingScope(env,callId),actor={tenantId:scope.tenantId,userId:scope.grantor};
 await assertPhoneBookingAuthority(env,actor,id,callId);if(!valid())throw new Error('phone_confirmation_interrupted');
 const result=await confirmBooking(env,actor,id,transport,async()=>{await assertPhoneBookingAuthority(env,actor,id,callId);if(!valid())throw new Error('phone_confirmation_interrupted');});
 return {status:result.status};
}
export function phoneBookingReadback(proposal:Awaited<ReturnType<typeof proposePhoneBooking>>){
 const time=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:proposal.timeZone,dateStyle:'full',timeStyle:'short'}).format(new Date(value));
 return `Book ${proposal.slot.appointmentType}${proposal.slot.staff?` with ${proposal.slot.staff}`:''} from ${time(proposal.slot.start)} to ${time(proposal.slot.end)}, time zone ${proposal.timeZone}? No email invitation will be sent. Say yes to book, or tell me what to correct.`;
}
