/**
 * engine-events.ts — EngineEvents (Reinvention Slice 0, blueprint §1.7).
 *
 * Money-path events are emitted by the engine itself, at the moment the
 * server does the thing — never by page JS that can be lost with an
 * unloaded thank-you page. Emission splits per the consent law:
 *
 *  - The OPERATIONAL event always writes to the tenant ledger. In this
 *    slice the ledger is the existing append-only `mayor_audit` table
 *    (blueprint §4.1: the audit trail whose successor is the ActionLog)
 *    under event names `engine.<type>` — no new migration is created in
 *    Slice 0 (the first genuinely new migration stays 0076). The full
 *    EngineEvent table lands with the per-tenant store in Slice 3.
 *  - The ANALYTICS copy (GA4 G-6RCJMF73VJ / Meta pixel 1773921077163350,
 *    dispatched only by web/public/analytics-consent.js) is produced
 *    ONLY when a current analytics consent record exists. The record
 *    lives in the browser (localStorage `mayor.analytics-consent.v1`);
 *    the client asserts it per-request via the header below, and the
 *    consent-gated loader independently re-checks its stored record
 *    before firing — both gates must pass. No consent ⇒ no directive
 *    is even created, so nothing downstream can leak it.
 *
 * Today's measured baseline for these events is ×0 (blueprint §4.8c);
 * a money run without its ledger rows is a failed run.
 */
import type {Env} from './env';
import {CASHTEXT_PRICE_CENTS,CREDIT_PACKS,FOUNDING_PRICE_CENTS,PRO_PRICE_CENTS} from './billing/plans';

export type EngineEventType='sign_up'|'begin_checkout'|'purchase_completed'|'fulfillment_ready'|'first_action_executed'|'action_executed'|'grant_created';
export const ENGINE_EVENT_PREFIX='engine.';
export const ANALYTICS_CONSENT_HEADER='x-mayor-analytics-consent';

/** The analytics event names the consent-gated loader knows how to fire. */
export type AnalyticsEventName='sign_up'|'begin_checkout'|'purchase';
const ANALYTICS_NAMES:Partial<Record<EngineEventType,AnalyticsEventName>>={
 sign_up:'sign_up',
 begin_checkout:'begin_checkout',
 purchase_completed:'purchase',
};

export interface AnalyticsDirective {
 /** Ledger row id — the client dedupes delivery on this. */
 eventId:string;
 name:AnalyticsEventName;
 params:Record<string,string|number>;
}

type EngineEnv=Pick<Env,'AGENT_DB'|'MAYOR_STRIPE_FOUNDING_PRICE_ID'>;

/** True only when the request asserts a CURRENT granted analytics
 * consent record (the client sets this header from its stored record at
 * request time; the loader re-verifies before firing). */
export function analyticsConsentAsserted(request:Request):boolean{
 return request.headers.get(ANALYTICS_CONSENT_HEADER)==='granted';
}

/** Write the operational event to the tenant ledger. Returns its id. */
export async function recordEngineEvent(env:Pick<Env,'AGENT_DB'>,input:{tenantId:string;actorId:string;type:EngineEventType;resourceId?:string|null;at?:string}):Promise<string>{
 const id=crypto.randomUUID();
 await env.AGENT_DB.prepare('INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) VALUES(?,?,?,?,?,?)')
  .bind(id,input.tenantId,input.actorId,ENGINE_EVENT_PREFIX+input.type,input.resourceId??null,input.at??new Date().toISOString()).run();
 return id;
}

/** The idempotent ledger statement for batch contexts (webhook effect
 * lists): inserts the operational event only if this resource has not
 * already recorded this event type — replays and double paths (webhook
 * + sync) can never double-count a purchase. */
export function recordEngineEventOnceStatement(env:Pick<Env,'AGENT_DB'>,input:{tenantId:string;actorId:string;type:EngineEventType;resourceId:string;at?:string}):D1PreparedStatement{
 return env.AGENT_DB.prepare(`INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) SELECT ?,?,?,?,? ,? WHERE NOT EXISTS (SELECT 1 FROM mayor_audit WHERE tenant_id=? AND event=? AND resource_id=?)`)
  .bind(crypto.randomUUID(),input.tenantId,input.actorId,ENGINE_EVENT_PREFIX+input.type,input.resourceId,input.at??new Date().toISOString(),input.tenantId,ENGINE_EVENT_PREFIX+input.type,input.resourceId);
}

/** Build the analytics copy of an event, or null when this event type
 * has no analytics form. Money values ride as GA4-standard params
 * (value in major units, currency, items) computed from catalog truth
 * by the caller — never from client-supplied amounts. */
export function analyticsDirective(input:{type:EngineEventType;eventId:string;valueCents?:number;currency?:string;itemRef?:string;itemName?:string;transactionId?:string}):AnalyticsDirective|null{
 const name=ANALYTICS_NAMES[input.type];
 if(!name)return null;
 const params:Record<string,string|number>={};
 if(input.valueCents!==undefined){params.value=input.valueCents/100;params.currency=input.currency??'USD';}
 if(input.itemRef)params.items=JSON.stringify([{item_id:input.itemRef,item_name:input.itemName??input.itemRef,...(input.valueCents!==undefined?{price:input.valueCents/100,quantity:1}:{})}]);
 if(input.transactionId)params.transaction_id=input.transactionId;
 return {eventId:input.eventId,name,params};
}

/**
 * Emit one engine event: the operational copy ALWAYS lands in the
 * ledger; the analytics directive is returned ONLY when consentGranted
 * is true (the caller derived it from the request's consent assertion —
 * see analyticsConsentAsserted). Fire-and-forget callers must still
 * await this: an unrecorded money event is a failed run (§1.7).
 */
export async function emitEngineEvent(env:Pick<Env,'AGENT_DB'>,input:{tenantId:string;actorId:string;type:EngineEventType;resourceId?:string|null;consentGranted:boolean;valueCents?:number;itemRef?:string;itemName?:string;transactionId?:string}):Promise<AnalyticsDirective[]>{
 const eventId=await recordEngineEvent(env,input);
 if(!input.consentGranted)return [];
 const directive=analyticsDirective({type:input.type,eventId,valueCents:input.valueCents,itemRef:input.itemRef,itemName:input.itemName,transactionId:input.transactionId});
 return directive?[directive]:[];
}

/**
 * Emit-once variant for checkout creation: the operational row is
 * written the first time only (a replayed checkout return must not
 * double-count), and the analytics directive is produced only on that
 * first emission and only with consent.
 */
export async function emitEngineEventOnce(env:Pick<Env,'AGENT_DB'>,input:{tenantId:string;actorId:string;type:EngineEventType;resourceId:string;consentGranted:boolean;valueCents?:number;itemRef?:string;itemName?:string;transactionId?:string}):Promise<AnalyticsDirective[]>{
 const existing=await env.AGENT_DB.prepare('SELECT id FROM mayor_audit WHERE tenant_id=? AND event=? AND resource_id=?')
  .bind(input.tenantId,ENGINE_EVENT_PREFIX+input.type,input.resourceId).first<{id:string}>();
 if(existing)return [];
 const eventId=await recordEngineEvent(env,input);
 if(!input.consentGranted)return [];
 const directive=analyticsDirective({type:input.type,eventId,valueCents:input.valueCents,itemRef:input.itemRef,itemName:input.itemName,transactionId:input.transactionId});
 return directive?[directive]:[];
}

/**
 * Purchase directives awaiting a browser: the webhook records
 * purchase_completed with no client present, so billing surfaces hand
 * the analytics copies to the consent-gated loader on the owner's next
 * visit. Values are re-derived from the billing rows the purchase
 * wrote (paid periods / credit checkouts) against catalog amounts —
 * the charged value, never a client claim. The client dedupes on
 * eventId; rows older than the window are not re-offered.
 */
export async function pendingPurchaseDirectives(env:EngineEnv,tenantId:string,withinMs=7*24*3600*1000):Promise<AnalyticsDirective[]>{
 const since=new Date(Date.now()-withinMs).toISOString();
 const rows=await env.AGENT_DB.prepare("SELECT id,resource_id,created_at FROM mayor_audit WHERE tenant_id=? AND event=? AND created_at>=? ORDER BY created_at ASC LIMIT 20")
  .bind(tenantId,ENGINE_EVENT_PREFIX+'purchase_completed',since).all<{id:string;resource_id:string|null;created_at:string}>();
 const directives:AnalyticsDirective[]=[];
 for(const row of rows.results){
  if(!row.resource_id)continue;
  // Subscription purchase: resource is the paid invoice id.
  const period=await env.AGENT_DB.prepare('SELECT s.price_id AS price_id FROM mayor_billing_paid_periods p JOIN mayor_billing_subscriptions s ON s.tenant_id=p.tenant_id AND s.mode=p.mode AND s.stripe_subscription_id=p.stripe_subscription_id WHERE p.tenant_id=? AND p.stripe_invoice_id=? AND p.invalidated=0')
   .bind(tenantId,row.resource_id).first<{price_id:string|null}>();
  if(period){
   const founding=period.price_id!==null&&period.price_id===env.MAYOR_STRIPE_FOUNDING_PRICE_ID;
   directives.push({eventId:row.id,name:'purchase',params:{value:(founding?FOUNDING_PRICE_CENTS:PRO_PRICE_CENTS)/100,currency:'USD',transaction_id:row.resource_id,items:JSON.stringify([{item_id:founding?'founding':'pro',item_name:founding?'Mayor Pro — Founding':'Mayor Pro',price:(founding?FOUNDING_PRICE_CENTS:PRO_PRICE_CENTS)/100,quantity:1}])}});
   continue;
  }
  // Credit-pack purchase: resource is the credit checkout id.
  const checkout=await env.AGENT_DB.prepare('SELECT pack_id FROM mayor_billing_credit_checkouts WHERE tenant_id=? AND id=?').bind(tenantId,row.resource_id).first<{pack_id:string}>();
  if(checkout){
   const pack=CREDIT_PACKS.find(p=>p.id===checkout.pack_id);
   if(pack)directives.push({eventId:row.id,name:'purchase',params:{value:pack.priceCents/100,currency:'USD',transaction_id:row.resource_id,items:JSON.stringify([{item_id:`pack:${pack.id}`,item_name:`${pack.name} credit pack`,price:pack.priceCents/100,quantity:1}])}});
   continue;
  }
  // CashText module purchase (spec §5.4): resource is the module
  // checkout id; the value re-derives from the plans.ts constant.
  const moduleCheckout=await env.AGENT_DB.prepare('SELECT id FROM mayor_cashtext_checkouts WHERE tenant_id=? AND id=?').bind(tenantId,row.resource_id).first<{id:string}>().catch(()=>null);
  if(moduleCheckout)directives.push({eventId:row.id,name:'purchase',params:{value:CASHTEXT_PRICE_CENTS/100,currency:'USD',transaction_id:row.resource_id,items:JSON.stringify([{item_id:'cashtext_module',item_name:'CashText module',price:CASHTEXT_PRICE_CENTS/100,quantity:1}])}});
 }
 return directives;
}
