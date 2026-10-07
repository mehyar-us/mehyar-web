import {expect,it,vi} from 'vitest';
import {StripeClient,verifySignature,parseEvent,stripeUrl,parameters,STRIPE_API_VERSION} from '../src/billing/stripe';
async function signed(raw:Uint8Array,timestamp:number,secret='whsec_fixture'){
 const prefix=new TextEncoder().encode(`${timestamp}.`),bytes=new Uint8Array(prefix.length+raw.length);bytes.set(prefix);bytes.set(raw,prefix.length);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
}
it('verifies exact bytes, multiple rotation signatures, and bounded timestamps',async()=>{
 const raw=new TextEncoder().encode('{"fixture":"é"}'),now=1700000000,valid=await signed(raw,now);await expect(verifySignature(raw,`t=${now},v1=${'0'.repeat(64)},v1=${valid}`,'whsec_fixture',now)).resolves.toBeUndefined();
 await expect(verifySignature(new TextEncoder().encode('{ "fixture":"é"}'),`t=${now},v1=${valid}`,'whsec_fixture',now)).rejects.toMatchObject({code:'invalid_signature'});await expect(verifySignature(raw,`t=${now},v1=${valid}`,'whsec_fixture',now+301)).rejects.toMatchObject({code:'invalid_signature'});await expect(verifySignature(raw,`t=${now},t=${now},v1=${valid}`,'whsec_fixture',now)).rejects.toMatchObject({code:'invalid_signature'});
});
it('uses only Stripe HTTPS REST with pinned version, no redirects, timeout and stable namespaced keys',async()=>{
 const transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({id:'fixture'})),client=new StripeClient('sk_test_private',transport);await client.request('/v1/checkout/sessions','POST',{line_items:[{price:'price_Mayor',quantity:1}],metadata:{mayor_billing_domain:'mayor_pwa'}},'mayor-pwa:fixture');const [url,options]=transport.mock.calls[0];expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');expect(options?.redirect).toBe('manual');expect(options?.signal).toBeInstanceOf(AbortSignal);expect(options?.headers).toMatchObject({'stripe-version':STRIPE_API_VERSION,'idempotency-key':'mayor-pwa:fixture'});expect(new URLSearchParams(options?.body as string).get('line_items[0][quantity]')).toBe('1');await expect(client.request('https://foreign.example/v1/checkout')).rejects.toThrow('invalid_stripe_path');await expect(client.request('/v1/customers','POST',{})).rejects.toThrow('billing_idempotency_required');expect(transport).toHaveBeenCalledOnce();
});
it('sanitizes provider errors without returning credentials or Stripe payloads',async()=>{
 const transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({error:{message:'sensitive payload'}},{status:402}));await expect(new StripeClient('sk_test_private',transport).request('/v1/account')).rejects.toMatchObject({code:'stripe_request_failed',message:'Stripe could not complete this request. Retry the same request.'});
});
it('allowlists hosted destinations and rejects malformed events',()=>{
 expect(stripeUrl('https://checkout.stripe.com/c/pay/fixture','checkout.stripe.com')).toContain('checkout.stripe.com');for(const value of ['https://checkout.stripe.com.evil.example/pay','http://checkout.stripe.com/pay','https://user@checkout.stripe.com/pay','https://billing.stripe.com/pay'])expect(()=>stripeUrl(value,'checkout.stripe.com')).toThrow();expect(()=>parseEvent(new TextEncoder().encode('{"id":"forged"}'))).toThrow();expect(parameters({empty:null,items:[{quantity:1}]}).toString()).toBe('items%5B0%5D%5Bquantity%5D=1');
});
