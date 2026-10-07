import type {Actor,Env} from './env';
import {readCustomer} from './customers';
import {requireMembership,OPERATORS} from './permissions';
import {HttpError} from './http';
export async function appointmentCustomer(env:Env,actor:Actor,bookingId:string){
 await requireMembership(env,actor,OPERATORS);
 const link=await env.AGENT_DB.prepare('SELECT customer_id,customer_revision FROM mayor_appointment_customers WHERE booking_id=? AND tenant_id=?').bind(bookingId,actor.tenantId).first<{customer_id:string;customer_revision:number}>();
 if(!link)return null;
 return {...await readCustomer(env,actor,link.customer_id),bookedRevision:link.customer_revision};
}
export async function requireAppointmentCustomerVersion(env:Env,actor:Actor,bookingId:string,expectedRevision?:number|null){
 const customer=await appointmentCustomer(env,actor,bookingId);
 if(customer&&customer.revision!==(expectedRevision??customer.bookedRevision)||!customer&&expectedRevision!=null)
  throw new HttpError(409,'customer_changed','The linked customer contact changed. Review the appointment and customer again.');
 return customer;
}
