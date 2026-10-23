import {HttpError} from '../http';
import {LEADPROOF_DOMAIN,LEADPROOF_PACK_PRICE_CENTS,LEADPROOF_PRICE_VERSION} from './plans';
import {assertMode,baseConfiguration,type BillingEnv,type StripeClient,type StripeEvent,type StripeObject} from './stripe';

/* LeadProof pack billing (integration spec §5.2): a one-time pack on its
 * own domain, the third use of the one-time checkout pattern (credits,
 * audit). Phase 0 lands the configuration, the price assertion (shaped
 * like the credit-pack assertion), and the events-router claim seam;
 * checkout creation + credit grant/consume land in Phase 5. */
export {LEADPROOF_DOMAIN};
export function leadproofConfiguration(env:BillingEnv){const base=baseConfiguration(env);if(!/^price_[A-Za-z0-9]+$/.test(env.MAYOR_STRIPE_LEADPROOF_PRICE_ID??''))throw new HttpError(503,'leadproof_not_ready','LeadProof is being prepared.');return {...base,priceId:env.MAYOR_STRIPE_LEADPROOF_PRICE_ID!};}
export function assertLeadProofPrice(price:StripeObject,env:BillingEnv){const config=leadproofConfiguration(env);assertMode(price,config.mode);if(price.id!==config.priceId||price.active!==true||price.unit_amount!==LEADPROOF_PACK_PRICE_CENTS||price.currency!=='usd'||price.type!=='one_time'||price.recurring!=null||price.billing_scheme!=='per_unit'||price.tax_behavior==='inclusive'||price.metadata?.mayor_billing_domain!==LEADPROOF_DOMAIN||price.metadata?.mayor_leadproof_version!==LEADPROOF_PRICE_VERSION)throw new HttpError(409,'leadproof_price_mismatch','The LeadProof pack price could not be verified.');}
interface LeadProofCheckout {id:string;tenant_id:string;mode:'test'|'live';request_id:string;status:string;stripe_session_id:string|null;}
/* Router branch scaffolding (spec §9 Phase 0): the same claim discipline
 * as the CashText branch — a pack session with no checkout row fails loud
 * (409) instead of falling through to the Pro domain, and a session WITH
 * a row fails loud until the Phase 5 fulfillment branch replaces this
 * seam. Every other event type returns null. */
export async function processLeadProofEvent(env:BillingEnv,event:StripeEvent,injected?:StripeClient){
 if(!event.type.startsWith('checkout.session.'))return null;
 const object=event.data.object,config=baseConfiguration(env);
 const row=await env.AGENT_DB.prepare('SELECT id,tenant_id,mode,request_id,status,stripe_session_id FROM mayor_leadproof_checkouts WHERE stripe_session_id=? AND mode=?').bind(object.id,config.mode).first<LeadProofCheckout>();
 if(!row){if(object.metadata?.mayor_billing_domain===LEADPROOF_DOMAIN)throw new HttpError(409,'leadproof_checkout_unmapped','This LeadProof payment is waiting for its checkout record.');return null;}
 throw new HttpError(409,'leadproof_fulfillment_not_ready','LeadProof fulfillment is not ready.');
}
