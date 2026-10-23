import {z} from 'zod';
import type {Actor} from '../env';
import {HttpError,json,readJson,requireOrigin} from '../http';
import {BILLING_ROLES,requireMembership} from '../permissions';
import {processBillingEvent} from './events';
import {billingStatus,createCheckout,portalSession,syncBilling} from './service';
import {baseConfiguration,parseEvent,rawBody,verifySignature,type BillingEnv,type StripeClient} from './stripe';
import {handleAuditPublic,auditOrders} from './audit';
import {createCreditCheckout} from './credits';
import {createModuleCheckout,processConnectEvent,refreshConnectStatus,setCashTextCancelAtPeriodEnd,startConnectOnboarding} from './cashtext';
import {createLeadProofCheckout} from './leadproof';
import {requestLeadProofPack} from '../leadproof/packs';
export {billingUsageContext,usageBalance} from './state';
import {PLANS,CREDIT_PACKS,BILLING_VERSION,PRO_PRICE_VERSION,CREDIT_PACK_VERSION,FOUNDING_PRICE_CENTS,CASHTEXT_MODULE,LEADPROOF_PACK} from './plans';
import {FOUNDING_UNAVAILABLE} from './founding';
import {readCatalog} from '../catalog-service';
import {analyticsConsentAsserted,pendingPurchaseDirectives} from '../engine-events';
export {PLANS,CREDIT_PACKS} from './plans';
export {STRIPE_API_VERSION} from './stripe';
export function billingRequestId(request:Request){const value=request.headers.get('idempotency-key')??request.headers.get('x-idempotency-key');if(!value||!z.uuid().safeParse(value).success)throw new HttpError(400,'idempotency_key_required','Retry with the same unique billing request.');return value;}
// ── Public pricing catalog (full-QA fix F3) ────────────────────────────────
// GET /api/billing/catalog — the single source of truth for public pricing.
// plans.ts is authoritative; the mehyar.us marketing page (MayorPlans.tsx)
// and any other surface MUST read this endpoint, never hardcode prices.
// Public and unauthenticated by design (it's marketing copy); CORS-open only
// to the mehyar.us origins that render it.
const CATALOG_ORIGINS=new Set(['https://mehyar.us','https://www.mehyar.us']);
export async function catalogResponse(request:Request,env?:BillingEnv):Promise<Response|null>{
 const url=new URL(request.url);
 if(url.pathname!=='/api/billing/catalog')return null;
 if(request.method!=='GET')throw new HttpError(405,'method_not_allowed','Use GET for the billing catalog.');
 const origin=request.headers.get('origin')??'';
 const headers:Record<string,string>={'cache-control':'public, max-age=300','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
 if(CATALOG_ORIGINS.has(origin))headers['access-control-allow-origin']=origin;
 // Slice 0: the response is a public projection of the CatalogService
 // snapshot (src/catalog-service.ts) — same fields, same order. The
 // service's price-ID keying stays server-side: this surface never
 // prints Stripe price IDs (pinned by tests/billing-catalog.test.ts).
 const catalog=env?await readCatalog(env):null;
 return Response.json({
  currency:'USD',
  catalogVersion:catalog?.catalogVersion??BILLING_VERSION,
  priceVersion:catalog?.priceVersion??PRO_PRICE_VERSION,
  creditPackVersion:catalog?.creditPackVersion??CREDIT_PACK_VERSION,
  // The founding-cohort seam (locked 2026-10-16): computed per request
  // from billing state; on any failure the block reports unavailable
  // with null counts and surfaces show no number.
  founding:catalog?catalog.founding:FOUNDING_UNAVAILABLE,
  // Parity with the authenticated billing payload (rot315 note,
  // 2026-10-17): the cohort's amount rides the public catalog too,
  // so the machine-readable surface never shows counts without it.
  foundingPriceCents:FOUNDING_PRICE_CENTS,
  plans:PLANS.map(p=>({id:p.id,name:p.name,priceCents:p.priceCents,interval:p.interval,replyLimit:p.replyLimit,voiceMinuteLimit:p.voiceMinuteLimit})),
  creditPacks:CREDIT_PACKS.map(p=>({id:p.id,name:p.name,priceCents:p.priceCents,replyAttempts:p.replyAttempts,voiceMinutes:p.voiceMinutes})),
  // Modules (integration spec §5.5): CashText + LeadProof ride the catalog
  // as their own domains' constants — amounts from plans.ts only, never a
  // page literal, and (like every section here) no Stripe price ids.
  modules:[
   {id:CASHTEXT_MODULE.id,name:CASHTEXT_MODULE.name,priceCents:CASHTEXT_MODULE.priceCents,interval:CASHTEXT_MODULE.interval},
   {id:LEADPROOF_PACK.id,name:LEADPROOF_PACK.name,priceCents:LEADPROOF_PACK.priceCents,interval:LEADPROOF_PACK.interval,leadTarget:LEADPROOF_PACK.leadTarget},
  ],
 },{headers});
}
export async function handleBillingPublic(request:Request,env:BillingEnv,injected?:StripeClient):Promise<Response|null>{
 const catalog=await catalogResponse(request,env);if(catalog)return catalog;
 const audit=await handleAuditPublic(request,env,injected);if(audit)return audit;
 const pathname=new URL(request.url).pathname;
 // CashText Connect webhook (spec §3.5): its OWN endpoint and its OWN
 // secret — Connect events cannot ride the platform endpoint (different
 // secret, and processBillingEvent drops non-platform accounts). The
 // endpoint fails closed when the secret is not configured.
 if(pathname==='/api/billing/connect-webhook'){
  if(request.method!=='POST')throw new HttpError(405,'method_not_allowed','Use POST for Connect events.');
  if(!env.MAYOR_STRIPE_CONNECT_WEBHOOK_SECRET?.startsWith('whsec_'))throw new HttpError(503,'connect_webhook_not_ready','Connect events are being prepared.');
  const bytes=await rawBody(request);await verifySignature(bytes,request.headers.get('stripe-signature'),env.MAYOR_STRIPE_CONNECT_WEBHOOK_SECRET);
  return json(await processConnectEvent(env,parseEvent(bytes),injected));
 }
 if(pathname!=='/api/billing/webhook')return null;if(request.method!=='POST')throw new HttpError(405,'method_not_allowed','Use POST for billing events.');baseConfiguration(env);const bytes=await rawBody(request);await verifySignature(bytes,request.headers.get('stripe-signature'),env.MAYOR_STRIPE_WEBHOOK_SECRET!);return json(await processBillingEvent(env,parseEvent(bytes),injected));
}
export async function handleBillingRequest(request:Request,env:BillingEnv,actor:Actor,injected?:StripeClient):Promise<Response|null>{
 const match=new URL(request.url).pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/billing(?:\/(checkout|credit-checkout|module-checkout|module-cancel|connect-onboard|connect-refresh|leadproof-checkout|leadproof-request|portal|sync|audit-orders))?$/);if(!match)return null;
 if(match[1]!==actor.tenantId)throw new HttpError(403,'billing_tenant_mismatch','Select the correct business.');await requireMembership(env,actor);
 if(!match[2]&&request.method==='GET'){const status=await billingStatus(env,actor);
  // Engine events (§1.7): purchase_completed was recorded by the
  // webhook with no browser present; its analytics copy rides this
  // response ONLY when the request asserts a current granted consent
  // record — the consent-gated loader re-verifies before firing.
  if(analyticsConsentAsserted(request)){const pending=await pendingPurchaseDirectives(env,actor.tenantId).catch(()=>[]);if(pending.length)return json({...status,analyticsEvents:pending});}
  return json(status);}if(match[2]==='audit-orders'&&request.method==='GET')return json(await auditOrders(env,actor));if(request.method!=='POST'||!match[2]||match[2]==='audit-orders')throw new HttpError(405,'method_not_allowed','This billing action is not available.');requireOrigin(request,env.APP_ORIGIN);await requireMembership(env,actor,BILLING_ROLES);const key=billingRequestId(request),body=await readJson(request,2048);
 if(match[2]==='checkout'){const quote=z.object({planId:z.enum(['pro','pro-founding'])}).strict().parse(body);return json(await createCheckout(env,actor,key,injected,quote.planId==='pro-founding'?'founding':undefined,analyticsConsentAsserted(request)));}
 if(match[2]==='credit-checkout'){const quote=z.object({packId:z.enum(['small','medium','large']),periodKey:z.string().min(1).max(200)}).strict().parse(body);return json(await createCreditCheckout(env,actor,key,quote.packId,quote.periodKey,injected,analyticsConsentAsserted(request)));}
 if(match[2]==='module-checkout'){const quote=z.object({module:z.enum(['cashtext'])}).strict().parse(body);return json(await createModuleCheckout(env,actor,key,injected,analyticsConsentAsserted(request)));}
 if(match[2]==='module-cancel'){const quote=z.object({module:z.enum(['cashtext']),cancel:z.boolean()}).strict().parse(body);return json(await setCashTextCancelAtPeriodEnd(env,actor,key,quote.cancel,injected));}
 if(match[2]==='connect-onboard'){z.object({module:z.enum(['cashtext'])}).strict().parse(body);return json(await startConnectOnboarding(env,actor,key,injected));}
 if(match[2]==='connect-refresh'){z.object({module:z.enum(['cashtext'])}).strict().parse(body);return json(await refreshConnectStatus(env,actor,injected));}
 if(match[2]==='leadproof-checkout'){z.object({}).strict().parse(body);return json(await createLeadProofCheckout(env,actor,key,injected,analyticsConsentAsserted(request)));}
 if(match[2]==='leadproof-request'){const ask=z.object({icpText:z.string().min(1).max(500),icpParams:z.object({category:z.string().min(1).max(120),geography:z.string().min(1).max(120),qualifiers:z.array(z.string().max(120)).max(8).optional(),scope:z.literal('businesses').optional()}).strict()}).strict().parse(body);return json(await requestLeadProofPack(env,actor,ask));}
 z.object({}).strict().parse(body);return json(match[2]==='portal'?await portalSession(env,actor,key,injected):await syncBilling(env,actor,injected));
}
