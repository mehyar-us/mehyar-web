import {expect,it,vi} from 'vitest';
import {StripeClient} from '../src/billing/stripe';
import {assertCashTextPrice,cashtextConfiguration,processCashTextEvent} from '../src/billing/cashtext';
import {assertLeadProofPrice,leadproofConfiguration,processLeadProofEvent} from '../src/billing/leadproof';

/* Phase 0 foundations (integration spec §9): the Stripe-Account client
 * extension (§3.5), both module price assertions (§5.1/§5.2), and the
 * events-router claim seams. Fulfillment bodies land in Phases 1 and 5;
 * these pins hold the seams' discipline until then. */

// ── Stripe-Account header (Connect transport) ────────────────────────────
it('sends the Stripe-Account header only when a connected account is named',async()=>{
 const transport=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({id:'fixture'})),client=new StripeClient('sk_test_private',transport);
 await client.request('/v1/invoices','POST',{customer:'cus_fixture'},'mayor-pwa:fixture',{stripeAccount:'acct_TenantFixture'});
 expect(transport.mock.calls[0][1]?.headers).toMatchObject({'stripe-account':'acct_TenantFixture'});
 await client.request('/v1/invoices/in_fixture');
 expect(transport.mock.calls[1][1]?.headers).not.toHaveProperty('stripe-account');
 await client.request('/v1/accounts/acct_TenantFixture','GET',undefined,undefined,{stripeAccount:'acct_TenantFixture'});
 expect(transport.mock.calls[2][1]?.headers).toMatchObject({'stripe-account':'acct_TenantFixture'});
 await expect(client.request('/v1/invoices','POST',{},'mayor-pwa:fixture',{stripeAccount:'not-an-account'})).rejects.toThrow('invalid_stripe_account');
 expect(transport).toHaveBeenCalledTimes(3);
});

// ── Module price assertions ──────────────────────────────────────────────
const priceEnv=(over:Record<string,unknown>={})=>({MAYOR_STRIPE_MODE:'test',MAYOR_STRIPE_SECRET_KEY:'sk_test_fixture',MAYOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',MAYOR_STRIPE_CASHTEXT_PRICE_ID:'price_CashTextFixture',MAYOR_STRIPE_LEADPROOF_PRICE_ID:'price_LeadProofFixture',...over}) as any;
it('asserts the CashText module price shape ($29/mo recurring, own domain)',()=>{
 const good={id:'price_CashTextFixture',livemode:false,active:true,currency:'usd',unit_amount:2900,type:'recurring',recurring:{interval:'month',interval_count:1},billing_scheme:'per_unit',tax_behavior:'unspecified'};
 expect(()=>assertCashTextPrice(good,priceEnv())).not.toThrow();
 expect(()=>assertCashTextPrice({...good,unit_amount:9900},priceEnv())).toThrowError(/CashText price could not be verified/);
 expect(()=>assertCashTextPrice({...good,type:'one_time',recurring:null},priceEnv())).toThrowError(/CashText price could not be verified/);
 expect(()=>cashtextConfiguration(priceEnv({MAYOR_STRIPE_CASHTEXT_PRICE_ID:undefined}))).toThrowError(/CashText is being prepared/);
});
it('asserts the LeadProof pack price shape ($49 one-time, domain + version metadata)',()=>{
 const good={id:'price_LeadProofFixture',livemode:false,active:true,currency:'usd',unit_amount:4900,type:'one_time',recurring:null,billing_scheme:'per_unit',tax_behavior:'unspecified',metadata:{mayor_billing_domain:'mayor_leadproof_pack',mayor_leadproof_version:'2026-10-23.1'}};
 expect(()=>assertLeadProofPrice(good,priceEnv())).not.toThrow();
 expect(()=>assertLeadProofPrice({...good,unit_amount:2900},priceEnv())).toThrowError(/LeadProof pack price could not be verified/);
 expect(()=>assertLeadProofPrice({...good,metadata:{mayor_billing_domain:'mayor_leadproof_pack'}},priceEnv())).toThrowError(/LeadProof pack price could not be verified/);
 expect(()=>leadproofConfiguration(priceEnv({MAYOR_STRIPE_LEADPROOF_PRICE_ID:undefined}))).toThrowError(/LeadProof is being prepared/);
});

// ── Events-router claim seams ────────────────────────────────────────────
function fakeDb(row:unknown){return {prepare:(_sql:string)=>({bind:(..._args:unknown[])=>({first:async()=>row})})};}
function branchEnv(row:unknown){return {...priceEnv(),AGENT_DB:fakeDb(row)};}
function checkoutEvent(domain:string|undefined,sessionId='cs_test_fixture'){return {id:'evt_fixture',type:'checkout.session.completed',created:0,livemode:false,data:{object:{id:sessionId,...(domain?{metadata:{mayor_billing_domain:domain}}:{})}}} as any;}
it('cashtext branch: foreign events pass through, claimed-but-unmapped fails loud, mapped waits for Phase 1',async()=>{
 await expect(processCashTextEvent(branchEnv(null),{id:'evt_fixture',type:'invoice.paid',created:0,livemode:false,data:{object:{id:'in_fixture'}}} as any)).resolves.toBeNull();
 await expect(processCashTextEvent(branchEnv(null),checkoutEvent(undefined))).resolves.toBeNull();
 await expect(processCashTextEvent(branchEnv(null),checkoutEvent('mayor_cashtext'))).rejects.toMatchObject({code:'cashtext_checkout_unmapped'});
 await expect(processCashTextEvent(branchEnv({id:'ct_fixture'}),checkoutEvent('mayor_cashtext'))).rejects.toMatchObject({code:'cashtext_fulfillment_not_ready'});
});
it('leadproof branch: foreign events pass through, claimed-but-unmapped fails loud, mapped waits for Phase 5',async()=>{
 await expect(processLeadProofEvent(branchEnv(null),{id:'evt_fixture',type:'charge.refunded',created:0,livemode:false,data:{object:{id:'ch_fixture'}}} as any)).resolves.toBeNull();
 await expect(processLeadProofEvent(branchEnv(null),checkoutEvent(undefined))).resolves.toBeNull();
 await expect(processLeadProofEvent(branchEnv(null),checkoutEvent('mayor_leadproof_pack'))).rejects.toMatchObject({code:'leadproof_checkout_unmapped'});
 await expect(processLeadProofEvent(branchEnv({id:'lp_fixture'}),checkoutEvent('mayor_leadproof_pack'))).rejects.toMatchObject({code:'leadproof_fulfillment_not_ready'});
});
