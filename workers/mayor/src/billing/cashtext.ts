import {HttpError} from '../http';
import {CASHTEXT_DOMAIN,CASHTEXT_PRICE_CENTS} from './plans';
import {assertMode,baseConfiguration,type BillingEnv,type StripeClient,type StripeEvent,type StripeObject} from './stripe';

/* CashText module billing (integration spec §5.1): a SEPARATE subscription
 * on its own domain — never a second item on the Pro subscription, whose
 * fulfillment contract (subscriptionEffects) hard-rejects items.length!==1.
 * Phase 0 lands the configuration, the price assertion, and the events-
 * router claim seam; checkout creation + fulfillment land in Phase 1. */
export {CASHTEXT_DOMAIN};
export function cashtextConfiguration(env:BillingEnv){const base=baseConfiguration(env);if(!/^price_[A-Za-z0-9]+$/.test(env.MAYOR_STRIPE_CASHTEXT_PRICE_ID??''))throw new HttpError(503,'cashtext_not_ready','CashText is being prepared.');return {...base,priceId:env.MAYOR_STRIPE_CASHTEXT_PRICE_ID!};}
export function assertCashTextPrice(price:StripeObject,env:BillingEnv){const config=cashtextConfiguration(env);assertMode(price,config.mode);if(price.id!==config.priceId||price.active!==true||price.currency!=='usd'||price.unit_amount!==CASHTEXT_PRICE_CENTS||price.type!=='recurring'||price.recurring?.interval!=='month'||price.recurring?.interval_count!==1||price.billing_scheme!=='per_unit'||price.tax_behavior==='inclusive')throw new HttpError(409,'cashtext_price_mismatch','The CashText price could not be verified.');}
interface CashTextCheckout {id:string;tenant_id:string;mode:'test'|'live';request_id:string;status:string;stripe_session_id:string|null;}
/* Router branch scaffolding (spec §9 Phase 0): claims only checkout
 * sessions that carry the module domain, exactly like the credits branch —
 * a module session with no checkout row fails loud (409) instead of
 * falling through to the Pro domain, and a session WITH a row fails loud
 * until the Phase 1 fulfillment branch replaces this seam. Every other
 * event type returns null (not this domain's, yet). */
export async function processCashTextEvent(env:BillingEnv,event:StripeEvent,injected?:StripeClient){
 if(!event.type.startsWith('checkout.session.'))return null;
 const object=event.data.object,config=baseConfiguration(env);
 const row=await env.AGENT_DB.prepare('SELECT id,tenant_id,mode,request_id,status,stripe_session_id FROM mayor_cashtext_checkouts WHERE stripe_session_id=? AND mode=?').bind(object.id,config.mode).first<CashTextCheckout>();
 if(!row){if(object.metadata?.mayor_billing_domain===CASHTEXT_DOMAIN)throw new HttpError(409,'cashtext_checkout_unmapped','This CashText payment is waiting for its checkout record.');return null;}
 throw new HttpError(409,'cashtext_fulfillment_not_ready','CashText fulfillment is not ready.');
}
