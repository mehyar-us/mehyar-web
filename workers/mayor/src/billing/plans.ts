export const BILLING_DOMAIN='mayor_pwa';
export const BILLING_VERSION='2026-10-03.1';
export const PRO_PRICE_VERSION='2026-10-16.1';
export const PRO_PRICE_CENTS=9900;
/* Founding cohort (Mayor's resolution 2026-10-16): the first 25
 * businesses lock $79.20/mo (9900 x 0.80 exactly) FOR LIFE on a separate
 * dedicated Price. Existing $14 subscribers are grandfathered — never
 * migrated; the cohort and the $99 list apply to new checkouts only. */
export const FOUNDING_PRICE_CENTS=7920;
export const FOUNDING_PRICE_VERSION='2026-10-16.1';
export const FOUNDING_SEATS_TOTAL=25;
export const CREDIT_PACK_VERSION='2026-10-03.1';
export const CREDIT_PACK_DOMAIN='mayor_credit_pack';
/* CashText + LeadProof modules (integration spec §5, 2026-10-23): each is a
 * PARALLEL billing domain with its own checkout surface — never an item on
 * the Pro subscription, whose fulfillment contract admits exactly one line.
 * Prices exist here as constants only; the asks render from these values
 * and the Stripe price ids stay server-side secrets (spec §5.3). */
export const CASHTEXT_PRICE_VERSION='2026-10-23.1';
export const CASHTEXT_DOMAIN='mayor_cashtext';
export const CASHTEXT_PRICE_CENTS=2900;
export const CASHTEXT_MODULE=Object.freeze({id:'cashtext',name:'CashText',priceCents:CASHTEXT_PRICE_CENTS,currency:'USD',interval:'month'});
export const LEADPROOF_PRICE_VERSION='2026-10-23.1';
export const LEADPROOF_DOMAIN='mayor_leadproof_pack';
export const LEADPROOF_PACK_PRICE_CENTS=4900;
/* The pack promises up to 25 evidence-backed leads; under 15 admitted the
 * credit restores automatically (spec §4.3, decision D9). */
export const LEADPROOF_PACK_LEAD_TARGET=25;
export const LEADPROOF_PACK_MIN_LEADS=15;
export const LEADPROOF_PACK=Object.freeze({id:'leadproof-pack',name:'LeadProof pack',priceCents:LEADPROOF_PACK_PRICE_CENTS,currency:'USD',interval:'one_time',leadTarget:LEADPROOF_PACK_LEAD_TARGET});
export const CREDIT_PACKS=Object.freeze([
 Object.freeze({id:'small',name:'Small',priceCents:400,currency:'USD',replyAttempts:200,voiceMinutes:15}),
 Object.freeze({id:'medium',name:'Medium',priceCents:800,currency:'USD',replyAttempts:500,voiceMinutes:45}),
 Object.freeze({id:'large',name:'Large',priceCents:1200,currency:'USD',replyAttempts:800,voiceMinutes:90}),
] as const);
export type CreditPackId=typeof CREDIT_PACKS[number]['id'];
/* Buyer-facing translation of the attempt meter (rot149): allowances are
 * also shown as approximate conversations, always computed from the same
 * attempt numbers with this single divisor, and the basis is printed
 * wherever the equivalence appears ("roughly 10 replies per conversation"). */
export const REPLIES_PER_CONVERSATION=10;
export function approxConversations(attempts:number):number{return Math.max(1,Math.round(attempts/REPLIES_PER_CONVERSATION));}
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
