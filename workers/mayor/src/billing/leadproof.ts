import type {Actor} from '../env';
import {digest,HttpError} from '../http';
import {BILLING_ROLES,requireMembership} from '../permissions';
import {LEADPROOF_DOMAIN,LEADPROOF_PACK,LEADPROOF_PACK_PRICE_CENTS,LEADPROOF_PRICE_VERSION} from './plans';
import {acquireLease,commitLease,releaseLease} from './locking';
import {assertAccount,ensureCustomer} from './service';
import {assertMode,baseConfiguration,clientFor,mode,objectId,stripeUrl,type BillingEnv,type StripeClient,type StripeEvent,type StripeObject} from './stripe';
import {emitEngineEventOnce,recordEngineEventOnceStatement} from '../engine-events';

/* LeadProof pack billing (integration spec §5.2 Option A): a one-time
 * pack on its own domain — the third use of the one-time checkout
 * pattern (credits, audit), cloned from createCreditCheckout's
 * discipline minus the period machinery (a pack is not period-bound).
 * Phase 0 landed the configuration, the price assertion, and the
 * events-router claim seam; Phase 5 replaces the seam with the real
 * fulfillment branch: checkout creation, the verified-paid credit
 * grant (one credit per checkout — mayor_leadproof_pack_credits.
 * checkout_id is UNIQUE, so a replayed webhook can never grant
 * twice), the §5.4 commitment + purchase engine event, and the
 * owner-facing status read. The credit CONSUME path (pack request)
 * lives in src/leadproof/packs.ts. This domain never touches
 * subscriptionEffects, the Pro funnel, or any sending machinery —
 * LeadProof is export-only and has no send verb (spec §4.3). */
export {LEADPROOF_DOMAIN};
export function leadproofConfiguration(env:BillingEnv){const base=baseConfiguration(env);if(!/^price_[A-Za-z0-9]+$/.test(env.MAYOR_STRIPE_LEADPROOF_PRICE_ID??''))throw new HttpError(503,'leadproof_not_ready','LeadProof is being prepared.');return {...base,priceId:env.MAYOR_STRIPE_LEADPROOF_PRICE_ID!};}
export function assertLeadProofPrice(price:StripeObject,env:BillingEnv){const config=leadproofConfiguration(env);assertMode(price,config.mode);if(price.id!==config.priceId||price.active!==true||price.unit_amount!==LEADPROOF_PACK_PRICE_CENTS||price.currency!=='usd'||price.type!=='one_time'||price.recurring!=null||price.billing_scheme!=='per_unit'||price.tax_behavior==='inclusive'||price.metadata?.mayor_billing_domain!==LEADPROOF_DOMAIN||price.metadata?.mayor_leadproof_version!==LEADPROOF_PRICE_VERSION)throw new HttpError(409,'leadproof_price_mismatch','The LeadProof pack price could not be verified.');}
interface LeadProofCheckout {id:string;tenant_id:string;mode:'test'|'live';request_id:string;catalog_version:string;price_id:string;status:string;stripe_session_id:string|null;stripe_payment_intent_id:string|null;checkout_url:string|null;expires_at:number|null;provider_started_at:number|null;created_at:string;updated_at:string;}
function leadproofMetadata(row:Pick<LeadProofCheckout,'id'|'tenant_id'>){return {mayor_billing_domain:LEADPROOF_DOMAIN,mayor_tenant_id:row.tenant_id,mayor_leadproof_checkout_id:row.id,mayor_leadproof_version:LEADPROOF_PRICE_VERSION};}
function assertLeadProofMetadata(object:StripeObject,row:Pick<LeadProofCheckout,'id'|'tenant_id'>){const expected=leadproofMetadata(row);for(const [name,value] of Object.entries(expected))if(object.metadata?.[name]!==value)throw new HttpError(409,'leadproof_ownership_mismatch','LeadProof payment ownership could not be verified.');}

/** Pack checkout (spec §5.2): row-first, request-id idempotent, one
 * open checkout per tenant+mode (the table's partial unique index is
 * the backstop). A replayed request-id returns the open session; a
 * second request-id while one is open refuses 409 — the established
 * checkout discipline, on the pack domain's own table. */
export async function createLeadProofCheckout(env:BillingEnv,actor:Actor,requestId:string,injected?:StripeClient,consentGranted=false){
 await requireMembership(env,actor,BILLING_ROLES);
 const config=leadproofConfiguration(env),client=clientFor(env,injected);await assertAccount(env,client);
 let row=await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_checkouts WHERE tenant_id=? AND mode=? AND request_id=?').bind(actor.tenantId,config.mode,requestId).first<LeadProofCheckout>();
 if(row?.checkout_url&&row.status==='open'&&(row.expires_at??0)>Date.now()/1000){
  const replayDirectives=await emitEngineEventOnce(env,{tenantId:actor.tenantId,actorId:actor.userId,type:'begin_checkout',resourceId:row.id,consentGranted,valueCents:LEADPROOF_PACK_PRICE_CENTS,itemRef:'leadproof_pack',itemName:'LeadProof pack'});
  return {url:stripeUrl(row.checkout_url,'checkout.stripe.com'),requestId,replay:true,...(replayDirectives.length?{analyticsEvents:replayDirectives}:{})};
 }
 if(row&&!['pending','open'].includes(row.status))throw new HttpError(409,'leadproof_checkout_resolved','This LeadProof checkout has ended. Start a new request.');
 if(!row){
  const pending=await env.AGENT_DB.prepare("SELECT * FROM mayor_leadproof_checkouts WHERE tenant_id=? AND mode=? AND status IN ('pending','open')").bind(actor.tenantId,config.mode).first<LeadProofCheckout>();
  if(pending?.stripe_session_id){const remote=await client.request(`/v1/checkout/sessions/${pending.stripe_session_id}`);assertMode(remote,config.mode);assertLeadProofMetadata(remote,pending);if(remote.status==='expired')await env.AGENT_DB.prepare("UPDATE mayor_leadproof_checkouts SET status='expired',updated_at=? WHERE id=? AND status='open'").bind(new Date().toISOString(),pending.id).run();else throw new HttpError(409,'checkout_pending','A LeadProof checkout is already open. Return to it or start it again once it ends.');}
  else if(pending)throw new HttpError(409,'checkout_pending','A LeadProof checkout request is already being prepared. Retry its original request.');
  const id=crypto.randomUUID(),created=new Date().toISOString();
  try{await env.AGENT_DB.prepare("INSERT INTO mayor_leadproof_checkouts(id,tenant_id,mode,request_id,catalog_version,price_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'pending',?,?)").bind(id,actor.tenantId,config.mode,requestId,LEADPROOF_PRICE_VERSION,config.priceId,created,created).run();}
  catch{const same=await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_checkouts WHERE tenant_id=? AND mode=? AND request_id=?').bind(actor.tenantId,config.mode,requestId).first<LeadProofCheckout>();if(!same)throw new HttpError(409,'checkout_pending','A LeadProof checkout is already open. Return to it or start it again once it ends.');}
  row=await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_checkouts WHERE tenant_id=? AND mode=? AND request_id=?').bind(actor.tenantId,config.mode,requestId).first<LeadProofCheckout>();
 }
 if(!row)throw new HttpError(503,'leadproof_checkout_unavailable','LeadProof checkout is temporarily unavailable.');
 if(row.provider_started_at&&Date.now()-row.provider_started_at>23*3600000)throw new HttpError(409,'leadproof_checkout_needs_review','This LeadProof checkout needs a billing status check before it can be retried.');
 if(row.price_id!==config.priceId||row.catalog_version!==LEADPROOF_PRICE_VERSION)throw new HttpError(409,'leadproof_quote_changed','The original LeadProof price needs review.');
 assertLeadProofPrice(await client.request(`/v1/prices/${row.price_id}`),env);
 const customer=await ensureCustomer(env,actor,client),origin=new URL(env.APP_ORIGIN).origin;
 await env.AGENT_DB.prepare('UPDATE mayor_leadproof_checkouts SET provider_started_at=COALESCE(provider_started_at,?),updated_at=? WHERE id=?').bind(Date.now(),new Date().toISOString(),row.id).run();
 const metadata=leadproofMetadata(row),expiresAt=Math.floor(Date.parse(row.created_at)/1000)+86400;
 const session=await client.request('/v1/checkout/sessions','POST',{mode:'payment',customer,line_items:[{price:row.price_id,quantity:1}],allowed_payment_method_types:['card'],metadata,payment_intent_data:{metadata},expires_at:expiresAt,client_reference_id:row.id,success_url:`${origin}/?billing=leadproof-success&business=${encodeURIComponent(actor.tenantId)}`,cancel_url:`${origin}/?billing=leadproof-canceled&business=${encodeURIComponent(actor.tenantId)}`,custom_text:{submit:{message:'One LeadProof pack: up to 25 evidence-backed business leads, each with its source link. If fewer than 15 qualify, the pack credit comes back automatically. Leads are businesses only, delivered as a download — The Mayor never contacts them for you.'}}},`mayor-pwa:leadproof:${config.mode}:${row.id}`);
 assertMode(session,config.mode);assertLeadProofMetadata(session,row);
 if(!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(session.id??'')||objectId(session.customer)!==customer||session.mode!=='payment'||session.client_reference_id!==row.id||!Number.isSafeInteger(session.expires_at))throw new HttpError(502,'leadproof_checkout_invalid','LeadProof checkout could not be verified.');
 const url=stripeUrl(session.url,'checkout.stripe.com');
 await env.AGENT_DB.prepare("UPDATE mayor_leadproof_checkouts SET stripe_session_id=?,checkout_url=?,expires_at=?,status='open',updated_at=? WHERE id=? AND status='pending'").bind(session.id,url,session.expires_at,new Date().toISOString(),row.id).run();
 const directives=await emitEngineEventOnce(env,{tenantId:actor.tenantId,actorId:actor.userId,type:'begin_checkout',resourceId:row.id,consentGranted,valueCents:LEADPROOF_PACK_PRICE_CENTS,itemRef:'leadproof_pack',itemName:'LeadProof pack'});
 return {url,requestId,replay:false,...(directives.length?{analyticsEvents:directives}:{})};
}

/** The fulfillment core: re-verify the whole payment against Stripe
 * (session, line, price, payment intent, charge — the credits
 * pattern) and, only on a fully verified paid state, grant exactly
 * one pack credit. A declined/abandoned session fulfills nothing and
 * stays resolvable; a refunded/disputed charge flips the checkout to
 * its terminal state and grants nothing — and because the consume
 * path (packs.ts) only spends credits whose checkout is still
 * 'paid', a refund landing before the spend makes the credit
 * unspendable without any extra machinery. No refund is ever
 * INITIATED here: this branch only mirrors Stripe-side state. */
export async function leadproofSessionEffects(env:BillingEnv,row:LeadProofCheckout,injected?:StripeClient):Promise<D1PreparedStatement[]>{
 const config=leadproofConfiguration(env),client=clientFor(env,injected);await assertAccount(env,client);
 const session=await client.request(`/v1/checkout/sessions/${row.stripe_session_id}`);assertMode(session,config.mode);assertLeadProofMetadata(session,row);
 const customer=await env.AGENT_DB.prepare('SELECT stripe_customer_id FROM mayor_billing_customers WHERE tenant_id=? AND mode=?').bind(row.tenant_id,row.mode).first<{stripe_customer_id:string}>();
 if(session.id!==row.stripe_session_id||session.mode!=='payment'||objectId(session.customer)!==customer?.stripe_customer_id||session.client_reference_id!==row.id||row.mode!==config.mode||row.catalog_version!==LEADPROOF_PRICE_VERSION||row.price_id!==config.priceId)throw new HttpError(409,'leadproof_ownership_mismatch','LeadProof payment ownership could not be verified.');
 const updated=new Date().toISOString();
 if(session.status==='expired')return [env.AGENT_DB.prepare("UPDATE mayor_leadproof_checkouts SET status='expired',updated_at=? WHERE id=? AND status IN ('pending','open')").bind(updated,row.id)];
 if(session.status!=='complete'||session.payment_status!=='paid')return [];
 const lines=await client.request(`/v1/checkout/sessions/${row.stripe_session_id}/line_items?limit=2`),line=lines.data?.[0];
 if(lines.has_more||lines.data?.length!==1||objectId(line?.price)!==row.price_id||line.quantity!==1||line.currency!=='usd'||line.amount_subtotal!==LEADPROOF_PACK_PRICE_CENTS||line.amount_total!==LEADPROOF_PACK_PRICE_CENTS||session.currency!=='usd'||session.amount_subtotal!==LEADPROOF_PACK_PRICE_CENTS||session.amount_total!==LEADPROOF_PACK_PRICE_CENTS||session.total_details?.amount_discount!==0||session.total_details?.amount_tax!==0)throw new HttpError(409,'leadproof_payment_mismatch','The LeadProof payment does not match the quoted purchase.');
 assertLeadProofPrice(await client.request(`/v1/prices/${row.price_id}`),env);
 const intentId=objectId(session.payment_intent);if(!/^pi_[A-Za-z0-9]+$/.test(intentId??''))throw new HttpError(409,'leadproof_payment_unverified','LeadProof payment is not verified.');
 const intent=await client.request(`/v1/payment_intents/${intentId}`);assertMode(intent,config.mode);assertLeadProofMetadata(intent,row);
 if(intent.status!=='succeeded'||intent.currency!=='usd'||intent.amount!==LEADPROOF_PACK_PRICE_CENTS||intent.amount_received!==LEADPROOF_PACK_PRICE_CENTS||objectId(intent.customer)!==customer?.stripe_customer_id)throw new HttpError(409,'leadproof_payment_unverified','LeadProof payment is not verified.');
 const chargeId=objectId(intent.latest_charge);if(!/^ch_[A-Za-z0-9]+$/.test(chargeId??''))throw new HttpError(409,'leadproof_payment_unverified','The LeadProof payment charge is not verified.');
 const charge=await client.request(`/v1/charges/${chargeId}`);assertMode(charge,config.mode);
 if(charge.paid!==true||charge.captured!==true||charge.amount!==LEADPROOF_PACK_PRICE_CENTS||charge.currency!=='usd'||objectId(charge.payment_intent)!==intentId||objectId(charge.customer)!==customer?.stripe_customer_id)throw new HttpError(409,'leadproof_payment_unverified','The LeadProof payment charge is not verified.');
 const invalidated=charge.refunded===true||charge.amount_refunded>0||charge.disputed===true;
 if(invalidated)return [env.AGENT_DB.prepare("UPDATE mayor_leadproof_checkouts SET stripe_payment_intent_id=?,status=?,updated_at=? WHERE id=? AND status NOT IN ('refunded','disputed')").bind(intentId,charge.disputed?'disputed':'refunded',updated,row.id)];
 return [
  env.AGENT_DB.prepare("UPDATE mayor_leadproof_checkouts SET stripe_payment_intent_id=?,status='paid',updated_at=? WHERE id=? AND status IN ('pending','open','paid')").bind(intentId,updated,row.id),
  // The credit grant: checkout_id UNIQUE + INSERT OR IGNORE — one
  // credit per verified paid checkout, however often this re-runs.
  env.AGENT_DB.prepare('INSERT OR IGNORE INTO mayor_leadproof_pack_credits(id,tenant_id,checkout_id,created_at,updated_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),row.tenant_id,row.id,updated,updated),
  // Commitments (§5.4): one row per fulfilled pack checkout,
  // deterministic id — replays can never duplicate it.
  env.AGENT_DB.prepare("INSERT OR IGNORE INTO mayor_commitments(id,tenant_id,kind,plan_ref,amount_cents,resource_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?, 'fulfilled',?,?)").bind(`purchase-intent:${row.id}`,row.tenant_id,'lead_pack','leadproof',LEADPROOF_PACK_PRICE_CENTS,row.id,updated,updated),
  // Engine events (§5.4): the purchase, recorded once per checkout in
  // the same atomic batch (item ref leadproof_pack).
  recordEngineEventOnceStatement(env,{tenantId:row.tenant_id,actorId:'system',type:'purchase_completed',resourceId:row.id,at:updated}),
 ];
}

/** The events-router branch (spec §5.2): claims LeadProof checkout
 * sessions and their refund/dispute charge events — a claimed event
 * with no checkout row fails loud (409) instead of falling through
 * to the Pro domain; every foreign event returns null. Dedupe +
 * tenant lease + fence mirror the CashText/credits branches exactly
 * (mayor_billing_events payload-hash ledger). */
export async function processLeadProofEvent(env:BillingEnv,event:StripeEvent,injected?:StripeClient){
 const config=baseConfiguration(env),client=clientFor(env,injected),object=event.data.object;let row:LeadProofCheckout|null=null;
 if(event.type.startsWith('checkout.session.')){
  row=await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_checkouts WHERE stripe_session_id=? AND mode=?').bind(object.id,config.mode).first<LeadProofCheckout>();
  if(!row){if(object.metadata?.mayor_billing_domain===LEADPROOF_DOMAIN)throw new HttpError(409,'leadproof_checkout_unmapped','This LeadProof payment is waiting for its checkout record.');return null;}
 }else if(event.type==='charge.refunded'||event.type==='charge.dispute.created'){
  /* The intent rides on the event object (charge and dispute both
   * carry it). An event whose object names no intent cannot be tied
   * to a LeadProof checkout from its own data, so it is foreign to
   * this domain — no Stripe call is spent on it. */
  const intentId=objectId(object.payment_intent);
  if(!intentId)return null;
  row=intentId?await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_checkouts WHERE stripe_payment_intent_id=? AND mode=?').bind(intentId,config.mode).first<LeadProofCheckout>():null;
  if(!row&&intentId){const intent=await client.request(`/v1/payment_intents/${intentId}`);assertMode(intent,config.mode);if(intent.metadata?.mayor_billing_domain===LEADPROOF_DOMAIN)row=await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_checkouts WHERE id=? AND mode=?').bind(intent.metadata.mayor_leadproof_checkout_id??'',config.mode).first<LeadProofCheckout>();}
  if(!row)return null;
 }else return null;
 const tenantId=row.tenant_id,hash=await digest(JSON.stringify(event)),updated=new Date().toISOString(),token=crypto.randomUUID();
 await env.AGENT_DB.prepare("INSERT INTO mayor_billing_events(mode,event_id,payload_hash,status,event_type,received_at) VALUES(?,?,?,'pending',?,?) ON CONFLICT(mode,event_id) DO NOTHING").bind(config.mode,event.id,hash,event.type,updated).run();
 const stored=await env.AGENT_DB.prepare('SELECT payload_hash,status FROM mayor_billing_events WHERE mode=? AND event_id=?').bind(config.mode,event.id).first<{payload_hash:string;status:string}>();
 if(stored?.payload_hash!==hash)throw new HttpError(409,'billing_event_conflict','This LeadProof event needs review.');
 if(stored.status==='processed')return {received:true,outcome:'duplicate'};
 const claimed=await env.AGENT_DB.prepare("UPDATE mayor_billing_events SET status='processing',processing_token=?,lease_expires_at=?,error_code=NULL WHERE mode=? AND event_id=? AND (status IN ('pending','failed') OR (status='processing' AND lease_expires_at<=?))").bind(token,Date.now()+120000,config.mode,event.id,Date.now()).run();
 if(!claimed.meta.changes)throw new HttpError(503,'billing_event_busy','The LeadProof payment is being processed.');
 let lease:string|undefined;
 try{
  lease=await acquireLease(env,tenantId,config.mode);
  const effects=await leadproofSessionEffects(env,row,client);
  const fence=`${token}:leadproof-event`;
  effects.unshift(env.AGENT_DB.prepare('INSERT INTO mayor_billing_fences(token,verified_token) VALUES(?,(SELECT processing_token FROM mayor_billing_events WHERE mode=? AND event_id=? AND processing_token=? AND lease_expires_at>?))').bind(fence,config.mode,event.id,token,Date.now()));
  effects.push(env.AGENT_DB.prepare("UPDATE mayor_billing_events SET status='processed',processing_token=NULL,lease_expires_at=NULL WHERE mode=? AND event_id=? AND processing_token=?").bind(config.mode,event.id,token),env.AGENT_DB.prepare('DELETE FROM mayor_billing_fences WHERE token=?').bind(fence));
  await commitLease(env,tenantId,config.mode,lease,effects);
  return {received:true,outcome:'processed'};
 }catch(error){
  if(lease)await releaseLease(env,tenantId,config.mode,lease);
  await env.AGENT_DB.prepare("UPDATE mayor_billing_events SET status='failed',processing_token=NULL,lease_expires_at=NULL,error_code=? WHERE mode=? AND event_id=? AND processing_token=?").bind(error instanceof HttpError?error.code:'leadproof_processing_failed',config.mode,event.id,token).run();
  throw error;
 }
}

/** The owner-facing LeadProof state for /billing's Modules section
 * (§5.5): credits held counts only UNSPENT credits whose checkout is
 * still 'paid' (a refunded checkout's credit is unspendable — see
 * leadproofSessionEffects); packs list the tenant's own recent packs
 * with their honest states. Nothing here invents a pack, a credit,
 * or a readiness the configuration doesn't have. */
export async function leadproofStatus(env:BillingEnv,actor:Actor,canManage:boolean){
 const selected=mode(env);
 let ready=false;try{leadproofConfiguration(env);ready=true;}catch{}
 const creditsHeld=selected?await env.AGENT_DB.prepare(`SELECT COUNT(*) AS c FROM mayor_leadproof_pack_credits cr JOIN mayor_leadproof_checkouts co ON co.id=cr.checkout_id
  WHERE cr.tenant_id=? AND co.mode=? AND co.status='paid' AND cr.consumed_by_pack_id IS NULL`).bind(actor.tenantId,selected).first<{c:number}>().catch(()=>null):null;
 const packs=selected?await env.AGENT_DB.prepare('SELECT id,icp_text,status,lead_count,shortfall_reason,created_at,ready_at,exported_at FROM mayor_leadproof_packs WHERE tenant_id=? ORDER BY created_at DESC LIMIT 10').bind(actor.tenantId).all<{id:string;icp_text:string;status:string;lead_count:number|null;shortfall_reason:string|null;created_at:string;ready_at:string|null;exported_at:string|null}>().catch(()=>null):null;
 const pending=selected?await env.AGENT_DB.prepare("SELECT request_id,checkout_url FROM mayor_leadproof_checkouts WHERE tenant_id=? AND mode=? AND status IN ('pending','open') AND (expires_at IS NULL OR expires_at>?)").bind(actor.tenantId,selected,Math.floor(Date.now()/1000)).first<{request_id:string;checkout_url:string|null}>().catch(()=>null):null;
 return {id:LEADPROOF_PACK.id,name:LEADPROOF_PACK.name,priceCents:LEADPROOF_PACK_PRICE_CENTS,currency:'USD',interval:'one_time',leadTarget:LEADPROOF_PACK.leadTarget,ready,creditsHeld:creditsHeld?.c??0,
  packs:(packs?.results??[]).map(p=>({id:p.id,icpText:p.icp_text,status:p.status,leadCount:p.lead_count,shortfallReason:p.shortfall_reason,createdAt:p.created_at,readyAt:p.ready_at,exportedAt:p.exported_at})),
  checkout:{pending:Boolean(pending),...(pending&&canManage?{requestId:pending.request_id,...(pending.checkout_url?{url:stripeUrl(pending.checkout_url,'checkout.stripe.com')}:{})}:{})}};
}
