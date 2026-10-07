import type {Env} from '../env';
import {HttpError} from '../http';
import {BILLING_DOMAIN,BILLING_VERSION,PRO_PRICE_CENTS,PRO_PRICE_VERSION,type BillingMode} from './plans';

// Pin request and dedicated webhook versions together. See docs.stripe.com/api/versioning.
export const STRIPE_API_VERSION='2026-09-30.endive';
export type StripeObject=Record<string,any>;
export interface StripeEvent {id:string;type:string;created:number;livemode:boolean;account?:string;data:{object:StripeObject};}
export type BillingEnv=Pick<Env,'AGENT_DB'|'APP_ORIGIN'|'MAYOR_STRIPE_MODE'|'MAYOR_STRIPE_SECRET_KEY'|'MAYOR_STRIPE_WEBHOOK_SECRET'|'MAYOR_STRIPE_PRICE_ID'|'MAYOR_STRIPE_PORTAL_CONFIGURATION'|'MAYOR_STRIPE_ACCOUNT_ID'|'MAYOR_STRIPE_AUDIT_PRICE_ID'|'MAYOR_STRIPE_CREDIT_PRICE_SMALL'|'MAYOR_STRIPE_CREDIT_PRICE_MEDIUM'|'MAYOR_STRIPE_CREDIT_PRICE_LARGE'|'MAYOR_AUDIT_STATUS_SECRET'|'MAYOR_AUDIT_ALLOWED_ORIGINS'|'MAYOR_AUDIT_OPERATOR_USER_IDS'|'MAYOR_AUDIT_FULFILLMENT_READY'>;
export function mode(env:Pick<Env,'MAYOR_STRIPE_MODE'>):BillingMode|null{return env.MAYOR_STRIPE_MODE==='test'||env.MAYOR_STRIPE_MODE==='live'?env.MAYOR_STRIPE_MODE:null;}
export function baseConfiguration(env:BillingEnv){
 const selected=mode(env),key=env.MAYOR_STRIPE_SECRET_KEY;
 if(!selected||!key||!new RegExp(`^(sk|rk)_${selected==='test'?'test':'live'}_`).test(key)||!env.MAYOR_STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'))throw new HttpError(503,'billing_not_ready','Payments are being prepared. You can keep using Free.');
 return {mode:selected,key};
}
export function configuration(env:BillingEnv){const base=baseConfiguration(env);if(!/^price_[A-Za-z0-9]+$/.test(env.MAYOR_STRIPE_PRICE_ID??''))throw new HttpError(503,'billing_not_ready','Payments are being prepared. You can keep using Free.');return {...base,priceId:env.MAYOR_STRIPE_PRICE_ID!};}
export function metadata(tenantId:string,checkoutId?:string){return {mayor_billing_domain:BILLING_DOMAIN,mayor_tenant_id:tenantId,mayor_catalog_version:BILLING_VERSION,...(checkoutId?{mayor_checkout_id:checkoutId,mayor_price_version:PRO_PRICE_VERSION}:{})};}
export function objectId(value:unknown):string|undefined{return typeof value==='string'?value:typeof (value as StripeObject)?.id==='string'?(value as StripeObject).id:undefined;}
export function parameters(data:Record<string,unknown>){
 const result=new URLSearchParams();
 const append=(key:string,value:unknown)=>{if(value===undefined||value===null)return;if(Array.isArray(value))value.forEach((entry,index)=>append(`${key}[${index}]`,entry));else if(typeof value==='object')Object.entries(value).forEach(([child,entry])=>append(`${key}[${child}]`,entry));else result.append(key,String(value));};
 Object.entries(data).forEach(([key,value])=>append(key,value));return result;
}
export class StripeClient {
 constructor(private secret:string,private transport:typeof fetch=fetch){}
 async request(path:string,method:'GET'|'POST'|'DELETE'='GET',body?:Record<string,unknown>,key?:string):Promise<StripeObject>{
  if(!/^\/v1\/[A-Za-z0-9_/?=&%.[\]-]+$/.test(path)||path.includes('..'))throw new Error('invalid_stripe_path');
  if(method!=='GET'&&(!key||!key.startsWith('mayor-pwa:')))throw new Error('billing_idempotency_required');
  const transport=this.transport;
  let response:Response;try{response=await transport(`https://api.stripe.com${path}`,{method,headers:{authorization:`Bearer ${this.secret}`,'stripe-version':STRIPE_API_VERSION,...(method!=='GET'?{'content-type':'application/x-www-form-urlencoded','idempotency-key':key!}:{})},...(method==='POST'?{body:parameters(body??{}).toString()}:{}),redirect:'manual',signal:AbortSignal.timeout(15000)});}catch{throw new HttpError(503,'stripe_unavailable','Billing is temporarily unavailable. Retry the same request.');}
  let result:StripeObject;try{result=await response.json() as StripeObject;}catch{throw new HttpError(503,'stripe_unavailable','Billing is temporarily unavailable.');}
  if(!response.ok){
   const safe=(value:unknown,pattern:RegExp)=>typeof value==='string'&&pattern.test(value)?value:null;
   console.warn(JSON.stringify({event:'mayor_stripe_request_failed',status:response.status,path:path.split('?')[0].replace(/\/(?:price|cus|sub|pi|in|cs|bpc|acct|ch)_[^/]+/g,'/[id]'),code:safe(result.error?.code,/^[a-z_]{1,80}$/),type:safe(result.error?.type,/^[a-z_]{1,80}$/),param:safe(result.error?.param,/^[a-z0-9_[\].]{1,100}$/)}));
   throw new HttpError(response.status===429||response.status>=500?503:502,'stripe_request_failed','Stripe could not complete this request. Retry the same request.');
  }
  return result;
 }
}
export function clientFor(env:BillingEnv,injected?:StripeClient){return injected??new StripeClient(baseConfiguration(env).key);}
export function assertMode(value:StripeObject,selected:BillingMode){if(value.livemode!==(selected==='live'))throw new HttpError(409,'stripe_mode_mismatch','The billing environment could not be verified.');}
export function assertPrice(price:StripeObject,env:BillingEnv){const config=configuration(env);assertMode(price,config.mode);if(price.id!==config.priceId||price.active!==true||price.currency!=='usd'||price.unit_amount!==PRO_PRICE_CENTS||price.type!=='recurring'||price.recurring?.interval!=='month'||price.recurring?.interval_count!==1||price.billing_scheme!=='per_unit'||price.tax_behavior==='inclusive')throw new HttpError(409,'price_mismatch','The Pro price could not be verified.');}
export function stripeUrl(value:unknown,host:'checkout.stripe.com'|'billing.stripe.com'){
 let parsed:URL;try{parsed=new URL(String(value));}catch{throw new HttpError(502,'billing_url_invalid','Stripe did not return a valid destination.');}
 if(parsed.protocol!=='https:'||parsed.hostname!==host||parsed.username||parsed.password||parsed.port)throw new HttpError(502,'billing_url_invalid','Stripe did not return a valid destination.');return parsed.href;
}
export async function rawBody(request:Request,maxBytes=524288){const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'invalid_event','A billing event is required.');const parts:Uint8Array[]=[];let size=0;for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes){await reader.cancel();throw new HttpError(413,'event_too_large','The billing event is too large.');}parts.push(part.value);}const result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;}
export async function verifySignature(raw:Uint8Array,header:string|null,secret:string,now=Math.floor(Date.now()/1000)){
 if(!header||header.length>8192||!secret)throw new HttpError(400,'invalid_signature','Invalid billing event signature.');
 const parts=header.split(',').map(part=>part.trim().split('=')),timestamps=parts.filter(([key])=>key==='t').map(([,value])=>value),signatures=parts.filter(([key,value])=>key==='v1'&&/^[a-f0-9]{64}$/i.test(value??'')).map(([,value])=>value);
 if(timestamps.length!==1||!/^\d+$/.test(timestamps[0]??'')||!signatures.length||signatures.length>16||!Number.isSafeInteger(Number(timestamps[0]))||Math.abs(now-Number(timestamps[0]))>300)throw new HttpError(400,'invalid_signature','Invalid or expired billing event signature.');
 const prefix=new TextEncoder().encode(`${timestamps[0]}.`),signed=new Uint8Array(prefix.length+raw.length);signed.set(prefix);signed.set(raw,prefix.length);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 for(const signature of signatures)if(await crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/.{2}/g)!,hex=>parseInt(hex,16)),signed))return;
 throw new HttpError(400,'invalid_signature','Invalid billing event signature.');
}
export function parseEvent(raw:Uint8Array):StripeEvent{let event:StripeEvent;try{event=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(raw));}catch{throw new HttpError(400,'invalid_event','The billing event could not be read.');}if(!event||!/^evt_[A-Za-z0-9_]+$/.test(event.id??'')||typeof event.type!=='string'||!Number.isSafeInteger(event.created)||typeof event.livemode!=='boolean'||typeof event.data?.object?.id!=='string')throw new HttpError(400,'invalid_event','The billing event could not be read.');return event;}
