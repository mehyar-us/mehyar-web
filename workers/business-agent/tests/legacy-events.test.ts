import {describe,it,expect} from 'vitest';
// Execute the real, unchanged handlers against a database trap; never a production binding.
// @ts-expect-error Legacy JavaScript has no TypeScript declarations.
import {onRequestPost as generalWebhook} from '../../../functions/api/pay/webhook.js';
// @ts-expect-error Legacy JavaScript has no TypeScript declarations.
import {onRequestPost as auditWebhook} from '../../../functions/api/audit/full-report/webhook.js';

const secret='whsec_test_fixture_no_provider_account';
async function signed(event:unknown) {
  const body=JSON.stringify(event);const timestamp=Math.floor(Date.now()/1000);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${body}`));
  const signature=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  return new Request('https://mehyar.us/api/pay/webhook',{method:'POST',headers:{'stripe-signature':`t=${timestamp},v1=${signature}`},body});
}
describe('new agent events cannot enter unchanged legacy fulfillment',()=>{
  for(const type of ['checkout.session.completed','invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted','charge.refunded']) {
    it(`${type} has zero legacy database or fulfillment effects`,async()=>{
      let databaseCalls=0;let backgroundCalls=0;
      const context={env:{LEADS_DB:{prepare(){databaseCalls++;throw new Error('Legacy DB must not be touched');}},STRIPE_WEBHOOK_SECRET:secret},waitUntil(){backgroundCalls++;}};
      const event={id:`evt_agent_${type}`,type,data:{object:{id:'new_platform_object',mode:'subscription',metadata:{mehyar_billing_domain:'business_agent',mehyar_agent_order_id:'agent-order',mehyar_agent_tenant_id:'biz-test'}}}};
      const general=await generalWebhook({...context,request:await signed(event)});
      const audit=await auditWebhook({...context,request:await signed(event)});
      expect(general.status).toBe(200);expect(audit.status).toBe(200);
      expect(databaseCalls).toBe(0);expect(backgroundCalls).toBe(0);
    });
  }
});
