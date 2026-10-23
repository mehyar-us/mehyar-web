import {expect,it} from 'vitest';
import {cashtextEntitled,CASHTEXT_PAST_DUE_GRACE_MS} from '../src/billing/cashtext';
import {CASHTEXT_MODULE,CASHTEXT_PRICE_CENTS} from '../src/billing/plans';
import {FINAL_SALE_LINE,moduleCardsSsrHtml,pricingCardsSsrHtml,injectPricingCards} from '../src/offer-block-ssr';
import {parseBillingIntent,captureBillingIntent,takeBillingIntent,type IntentStore} from '../web/billing-intent';

/* Phase 1 pins (integration spec §5.1/§5.5, §6 proof 1): the entitlement
 * gate's status matrix, the /pricing CashText module card rendered from
 * plans.ts constants, and the ?module=cashtext billing intent. The
 * money-path battery itself (checkout → webhook → exactly one row) is
 * tests/integration/billing-cashtext.test.ts. */

it('entitlement: active/trialing entitle, past_due only inside its grace window, nothing else does',()=>{
 const now=Date.parse('2026-10-23T12:00:00.000Z'),fresh=new Date(now-1000).toISOString(),stale=new Date(now-CASHTEXT_PAST_DUE_GRACE_MS-1000).toISOString();
 expect(cashtextEntitled(null,now)).toBe(false);
 expect(cashtextEntitled({status:'active',updated_at:fresh},now)).toBe(true);
 expect(cashtextEntitled({status:'trialing',updated_at:fresh},now)).toBe(true);
 expect(cashtextEntitled({status:'past_due',updated_at:fresh},now)).toBe(true);
 expect(cashtextEntitled({status:'past_due',updated_at:stale},now)).toBe(false);
 for(const status of ['incomplete','incomplete_expired','unpaid','paused','canceled','not_subscribed'])expect(cashtextEntitled({status,updated_at:fresh},now)).toBe(false);
});

it('pricing module card: CashText from plans.ts constants, FINAL_SALE_LINE exactly once, real terms at the ask',()=>{
 const card=moduleCardsSsrHtml();
 expect(card).toContain(CASHTEXT_MODULE.name);
 expect(card).toContain(`$${CASHTEXT_PRICE_CENTS/100}`);
 expect(card).toContain('href="/billing?module=cashtext"');
 expect(card.split('Payments are final and non-refundable').length-1).toBe(1);
 expect(card).toContain(FINAL_SALE_LINE);
 // The real terms, stated at the ask (spec §5.5).
 expect(card).toContain('its own subscription');
 expect(card).toContain('cancel ends it at period end');
 expect(card).toContain('your customers pay your own Stripe account');
 expect(card).toContain('you approve every send');
 // Claims discipline (spec §8 R2): mechanics only, never an outcome.
 expect(card.toLowerCase()).not.toContain('get paid faster');
 expect(card.toLowerCase()).not.toContain('guarantee');
 // The pricing renderer carries the same card in its modules section.
 expect(pricingCardsSsrHtml()!.modules).toBe(card);
});

it('injectPricingCards fills the /pricing module-cards container from the same constants',()=>{
 const shell=`<div id="plan-cards" class="plan-grid"><p>Loading plans…</p></div><div id="topup-cards" class="plan-grid"><p>Loading top-ups…</p></div><div id="module-cards" class="plan-grid"><p>fallback</p></div>`;
 const out=injectPricingCards(shell);
 expect(out).toContain('CashText');
 expect(out).toContain(`$${CASHTEXT_PRICE_CENTS/100}`);
 expect(out).not.toContain('<p>fallback</p>');
 expect(injectPricingCards(out)).toBe(out);
});

it('billing intent: ?module=cashtext parses, stashes, and consumes exactly once',()=>{
 expect(parseBillingIntent('?module=cashtext')).toEqual({kind:'module',id:'cashtext'});
 expect(parseBillingIntent('?module=leadproof')).toBeNull();
 const store:IntentStore&{value:string|null}={value:null,getItem(){return this.value;},setItem(_k,v){this.value=v;},removeItem(){this.value=null;}};
 expect(captureBillingIntent('?module=cashtext',store,1000)).toEqual({kind:'module',id:'cashtext'});
 expect(takeBillingIntent('',store,2000)).toEqual({kind:'module',id:'cashtext'});
 expect(takeBillingIntent('',store,3000)).toBeNull();
});
