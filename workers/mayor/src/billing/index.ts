import {z} from 'zod';
import type {Actor} from '../env';
import {HttpError,json,readJson,requireOrigin} from '../http';
import {BILLING_ROLES,requireMembership} from '../permissions';
import {processBillingEvent} from './events';
import {billingStatus,createCheckout,portalSession,syncBilling} from './service';
import {baseConfiguration,parseEvent,rawBody,verifySignature,type BillingEnv,type StripeClient} from './stripe';
import {handleAuditPublic,auditOrders} from './audit';
import {createCreditCheckout} from './credits';
export {billingUsageContext,usageBalance} from './state';
export {PLANS,CREDIT_PACKS} from './plans';
export {STRIPE_API_VERSION} from './stripe';
export function billingRequestId(request:Request){const value=request.headers.get('idempotency-key')??request.headers.get('x-idempotency-key');if(!value||!z.uuid().safeParse(value).success)throw new HttpError(400,'idempotency_key_required','Retry with the same unique billing request.');return value;}
export async function handleBillingPublic(request:Request,env:BillingEnv,injected?:StripeClient):Promise<Response|null>{
 const audit=await handleAuditPublic(request,env,injected);if(audit)return audit;
 if(new URL(request.url).pathname!=='/api/billing/webhook')return null;if(request.method!=='POST')throw new HttpError(405,'method_not_allowed','Use POST for billing events.');baseConfiguration(env);const bytes=await rawBody(request);await verifySignature(bytes,request.headers.get('stripe-signature'),env.MAYOR_STRIPE_WEBHOOK_SECRET!);return json(await processBillingEvent(env,parseEvent(bytes),injected));
}
export async function handleBillingRequest(request:Request,env:BillingEnv,actor:Actor,injected?:StripeClient):Promise<Response|null>{
 const match=new URL(request.url).pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/billing(?:\/(checkout|credit-checkout|portal|sync|audit-orders))?$/);if(!match)return null;
 if(match[1]!==actor.tenantId)throw new HttpError(403,'billing_tenant_mismatch','Select the correct business.');await requireMembership(env,actor);
 if(!match[2]&&request.method==='GET')return json(await billingStatus(env,actor));if(match[2]==='audit-orders'&&request.method==='GET')return json(await auditOrders(env,actor));if(request.method!=='POST'||!match[2]||match[2]==='audit-orders')throw new HttpError(405,'method_not_allowed','This billing action is not available.');requireOrigin(request,env.APP_ORIGIN);await requireMembership(env,actor,BILLING_ROLES);const key=billingRequestId(request),body=await readJson(request,2048);
 if(match[2]==='checkout'){z.object({planId:z.literal('pro')}).strict().parse(body);return json(await createCheckout(env,actor,key,injected));}
 if(match[2]==='credit-checkout'){const quote=z.object({packId:z.enum(['small','medium','large']),periodKey:z.string().min(1).max(200)}).strict().parse(body);return json(await createCreditCheckout(env,actor,key,quote.packId,quote.periodKey,injected));}
 z.object({}).strict().parse(body);return json(match[2]==='portal'?await portalSession(env,actor,key,injected):await syncBilling(env,actor,injected));
}
