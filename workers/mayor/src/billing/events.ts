import {digest,HttpError} from '../http';
import {BILLING_DOMAIN} from './plans';
import {acquireLease,commitLease,releaseLease} from './locking';
import {subscriptionEffects} from './service';
import {assertMode,baseConfiguration,clientFor,configuration,objectId,type BillingEnv,type StripeClient,type StripeEvent,type StripeObject} from './stripe';
import {processAuditEvent} from './audit';
import {processCreditEvent} from './credits';
export const BILLING_EVENTS=['checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed','invoice.payment_action_required','charge.refunded','charge.dispute.created'] as const;
function eventMetadata(object:StripeObject){return object.metadata?.mayor_billing_domain===BILLING_DOMAIN?object.metadata:object.parent?.subscription_details?.metadata?.mayor_billing_domain===BILLING_DOMAIN?object.parent.subscription_details.metadata:null;}
export async function processBillingEvent(env:BillingEnv,event:StripeEvent,injected?:StripeClient){
 const config=baseConfiguration(env);if(event.livemode!==(config.mode==='live'))throw new HttpError(400,'stripe_mode_mismatch','Billing event environment mismatch.');if(event.account&&event.account!==env.MAYOR_STRIPE_ACCOUNT_ID)return {received:true,outcome:'unrelated_account'};
 if(!(BILLING_EVENTS as readonly string[]).includes(event.type))return {received:true,outcome:'unrelated_event'};
 const audit=await processAuditEvent(env,event,injected);if(audit)return audit;
 const credits=await processCreditEvent(env,event,injected);if(credits)return credits;
 configuration(env);
 const object=event.data.object,meta=eventMetadata(object);let adjustment:StripeObject|undefined;if(event.type==='charge.dispute.created'){const chargeId=objectId(object.charge);if(!chargeId||!/^ch_[A-Za-z0-9]+$/.test(chargeId))throw new HttpError(409,'billing_charge_missing','The payment adjustment needs review.');adjustment=await clientFor(env,injected).request(`/v1/charges/${chargeId}`);assertMode(adjustment,config.mode);}const customerId=objectId(adjustment?.customer)??objectId(object.customer),mapped=customerId?await env.AGENT_DB.prepare('SELECT tenant_id FROM mayor_billing_customers WHERE stripe_customer_id=? AND mode=?').bind(customerId,config.mode).first<{tenant_id:string}>():null;
 const tenantId=mapped?.tenant_id??meta?.mayor_tenant_id;
 if(!tenantId||!/^[a-f0-9]{32}$/.test(tenantId))return {received:true,outcome:'unrelated_event'};
 if(meta?.mayor_tenant_id&&mapped&&meta.mayor_tenant_id!==mapped.tenant_id)throw new HttpError(409,'billing_ownership_mismatch','Billing event ownership mismatch.');
 const hash=await digest(JSON.stringify(event)),created=new Date().toISOString(),token=crypto.randomUUID();
 await env.AGENT_DB.prepare("INSERT INTO mayor_billing_events(mode,event_id,payload_hash,status,event_type,received_at) VALUES(?,?,?,'pending',?,?) ON CONFLICT(mode,event_id) DO NOTHING").bind(config.mode,event.id,hash,event.type,created).run();
 const stored=await env.AGENT_DB.prepare('SELECT payload_hash,status FROM mayor_billing_events WHERE mode=? AND event_id=?').bind(config.mode,event.id).first<{payload_hash:string;status:string}>();if(stored?.payload_hash!==hash)throw new HttpError(409,'billing_event_conflict','The billing event needs review.');if(stored.status==='processed')return {received:true,outcome:'duplicate'};
 const claimed=await env.AGENT_DB.prepare("UPDATE mayor_billing_events SET status='processing',processing_token=?,lease_expires_at=?,error_code=NULL WHERE mode=? AND event_id=? AND (status IN ('pending','failed') OR (status='processing' AND lease_expires_at<=?))").bind(token,Date.now()+120000,config.mode,event.id,Date.now()).run();if(!claimed.meta.changes)throw new HttpError(503,'billing_event_busy','This billing event is being processed.');
 let lease:string|undefined;
 try{
  lease=await acquireLease(env,tenantId,config.mode);const client=clientFor(env,injected);let effects:D1PreparedStatement[]=[];
  if(event.type.startsWith('checkout.session.')){
   const session=await client.request(`/v1/checkout/sessions/${object.id}`);assertMode(session,config.mode);
   const checkout=await env.AGENT_DB.prepare('SELECT id FROM mayor_billing_checkouts WHERE stripe_session_id=? AND tenant_id=? AND mode=?').bind(session.id,tenantId,config.mode).first<{id:string}>();
   if(!checkout||session.metadata?.mayor_billing_domain!==BILLING_DOMAIN||session.metadata?.mayor_tenant_id!==tenantId||session.metadata?.mayor_checkout_id!==checkout.id||objectId(session.customer)!==customerId)throw new HttpError(409,'billing_checkout_unmapped','The billing event is waiting for its checkout record.');
   const subscriptionId=objectId(session.subscription);if(subscriptionId)effects=await subscriptionEffects(env,tenantId,subscriptionId,event.created,client);else if(session.status==='expired')effects=[env.AGENT_DB.prepare("UPDATE mayor_billing_checkouts SET status='expired',updated_at=? WHERE id=?").bind(created,checkout.id)];
  }else if(event.type.startsWith('customer.subscription.'))effects=await subscriptionEffects(env,tenantId,object.id,event.created,client);
  else if(event.type.startsWith('invoice.')){
   const invoice=await client.request(`/v1/invoices/${object.id}`);assertMode(invoice,config.mode);if(objectId(invoice.customer)!==customerId)throw new HttpError(409,'billing_customer_mismatch','The invoice owner could not be verified.');const subscriptionId=objectId(invoice.parent?.subscription_details?.subscription)??objectId(invoice.subscription);if(subscriptionId)effects=await subscriptionEffects(env,tenantId,subscriptionId,event.created,client,invoice.id);
  }else{
   const chargeId=event.type==='charge.refunded'?object.id:objectId(object.charge);if(!chargeId)throw new HttpError(409,'billing_charge_missing','The payment adjustment needs review.');const charge=adjustment??await client.request(`/v1/charges/${chargeId}`);assertMode(charge,config.mode);if(objectId(charge.customer)!==customerId)throw new HttpError(409,'billing_customer_mismatch','The payment adjustment owner could not be verified.');const intent=objectId(charge.payment_intent);
   if(intent&&(event.type==='charge.dispute.created'||charge.refunded===true||charge.amount_refunded>=charge.amount))effects.push(env.AGENT_DB.prepare('UPDATE mayor_billing_paid_periods SET invalidated=1 WHERE tenant_id=? AND mode=? AND stripe_payment_intent_id=?').bind(tenantId,config.mode,intent));
  }
  // Event and tenant leases must both remain ours when entitlement changes commit.
  const fence=`${token}:event`;effects.unshift(env.AGENT_DB.prepare('INSERT INTO mayor_billing_fences(token,verified_token) VALUES(?,(SELECT processing_token FROM mayor_billing_events WHERE mode=? AND event_id=? AND processing_token=? AND lease_expires_at>?))').bind(fence,config.mode,event.id,token,Date.now()));effects.push(env.AGENT_DB.prepare("UPDATE mayor_billing_events SET status='processed',processing_token=NULL,lease_expires_at=NULL WHERE mode=? AND event_id=? AND processing_token=?").bind(config.mode,event.id,token),env.AGENT_DB.prepare('DELETE FROM mayor_billing_fences WHERE token=?').bind(fence));
  await commitLease(env,tenantId,config.mode,lease,effects);return {received:true,outcome:'processed'};
 }catch(error){if(lease)await releaseLease(env,tenantId,config.mode,lease);await env.AGENT_DB.prepare("UPDATE mayor_billing_events SET status='failed',processing_token=NULL,lease_expires_at=NULL,error_code=? WHERE mode=? AND event_id=? AND processing_token=?").bind(error instanceof HttpError?error.code:'billing_processing_failed',config.mode,event.id,token).run();throw error;}
}
