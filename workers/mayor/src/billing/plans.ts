export const BILLING_DOMAIN='mayor_pwa';
export const BILLING_VERSION='2026-10-03.1';
export const PRO_PRICE_VERSION='2026-10-03.2';
export const PRO_PRICE_CENTS=1400;
export const CREDIT_PACK_VERSION='2026-10-03.1';
export const CREDIT_PACK_DOMAIN='mayor_credit_pack';
export const CREDIT_PACKS=Object.freeze([
 Object.freeze({id:'small',name:'Small',priceCents:400,currency:'USD',replyAttempts:200,voiceMinutes:15}),
 Object.freeze({id:'medium',name:'Medium',priceCents:800,currency:'USD',replyAttempts:500,voiceMinutes:45}),
 Object.freeze({id:'large',name:'Large',priceCents:1200,currency:'USD',replyAttempts:800,voiceMinutes:90}),
] as const);
export type CreditPackId=typeof CREDIT_PACKS[number]['id'];
export const PLANS=Object.freeze([
 Object.freeze({id:'free',name:'Free',priceCents:0,currency:'USD',interval:'calendar_month',replyLimit:100,voiceMinuteLimit:10}),
 Object.freeze({id:'pro',name:'Pro',priceCents:PRO_PRICE_CENTS,currency:'USD',interval:'month',replyLimit:1000,voiceMinuteLimit:120}),
] as const);
export type PlanId='free'|'pro';
export type BillingMode='test'|'live';
export function freePeriod(now=Date.now()){
 const date=new Date(now),start=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1),end=Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1);
 return {periodKey:`free:${new Date(start).toISOString().slice(0,7)}`,periodStart:start/1000,periodEnd:end/1000};
}
