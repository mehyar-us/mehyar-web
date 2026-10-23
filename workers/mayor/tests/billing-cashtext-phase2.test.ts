import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {CASHTEXT_CONNECT_TERMS_GATE_OPEN,CONNECT_WEBHOOK_EVENTS,deriveConnectAccountStatus,startConnectOnboarding} from '../src/billing/cashtext';

/* Phase 2 pins (integration spec §3.5, §6 proof 2): the Connect account
 * status derivation, the R4 gate on opening (CLOSED — the merchant-of-
 * record sentence was not on the served mehyar.us Terms page when
 * probed 2026-10-23, Phase 2 report §4), the Connect webhook's event
 * surface, and the R5/R6 disclosure lines on the Connect card. The
 * money-path battery lives in tests/integration/billing-cashtext-connect.test.ts. */

it('connect gate: onboarding is CLOSED until the R4 Terms sentence is served',()=>{
 expect(CASHTEXT_CONNECT_TERMS_GATE_OPEN).toBe(false);
});

it('connect gate: startConnectOnboarding refuses 503 while the gate is closed, before any Stripe or DB work',async()=>{
 const env={AGENT_DB:{prepare:()=>{throw new Error('db must not be touched while the gate is closed');}}} as any;
 await expect(startConnectOnboarding(env,{tenantId:'a'.repeat(32),userId:'user_fixture'},crypto.randomUUID())).rejects.toMatchObject({status:503,code:'cashtext_connect_not_ready'});
});

it('account status derivation: charges+details ⇒ active, disabled_reason ⇒ restricted, otherwise pending',()=>{
 expect(deriveConnectAccountStatus({charges_enabled:true,details_submitted:true,requirements:{}})).toBe('active');
 expect(deriveConnectAccountStatus({charges_enabled:true,details_submitted:true,requirements:{disabled_reason:'requirements.past_due'}})).toBe('restricted');
 expect(deriveConnectAccountStatus({charges_enabled:false,details_submitted:false,requirements:{}})).toBe('pending');
 expect(deriveConnectAccountStatus({charges_enabled:true,details_submitted:false,requirements:{}})).toBe('pending');
 expect(deriveConnectAccountStatus({charges_enabled:false,details_submitted:true,requirements:{}})).toBe('pending');
});

it('connect webhook event surface: the four handled events + refund/dispute note events, nothing else',()=>{
 for(const type of ['invoice.paid','invoice.payment_failed','invoice.sent','account.updated'])expect(CONNECT_WEBHOOK_EVENTS).toContain(type);
 for(const type of ['charge.refunded','charge.dispute.created','refund.created'])expect(CONNECT_WEBHOOK_EVENTS).toContain(type);
 expect(CONNECT_WEBHOOK_EVENTS).not.toContain('checkout.session.completed');
 expect(CONNECT_WEBHOOK_EVENTS).not.toContain('customer.subscription.created');
});

it('connect card carries the R6 consent line and the R5 fees line (billing panel + review dialog)',()=>{
 const panel=readFileSync(new URL('../web/billing.tsx',import.meta.url),'utf8');
 expect(panel).toContain('Stripe collects your business');
 expect(panel).toContain('KYC, tax, and bank details on Stripe');
 expect(panel).toContain('The Mayor never sees or stores them');
 expect(panel).toContain('standard fees apply to payments you receive — charged by Stripe, not by us');
 // The honest gate state is rendered, not hidden, while onboarding is closed.
 expect(panel).toContain('merchant of record for your invoices');
 expect(panel).toContain('connecting is not open yet');
 const workday=readFileSync(new URL('../web/workday.ts',import.meta.url),'utf8');
 expect(workday).toContain('never sees or stores them');
 expect(workday).toContain('charged by Stripe, not by us');
 // Account links land on the one Stripe host the redirect guard allows for them.
 expect(workday).toContain('connect.stripe.com');
});
