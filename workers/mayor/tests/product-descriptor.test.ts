import {describe,expect,it} from 'vitest';
import {readCatalog} from '../src/catalog-service';
import {buildDescriptor,DESCRIPTOR_VERSION,descriptorHash,stampDescriptorHash,stampedDescriptorHash} from '../src/product-descriptor';

function fakeDb(subs:number){
 return {prepare(sql:string){
  return {bind(){return {
   async first(){if(sql.includes('mayor_billing_subscriptions'))return {count:subs};if(sql.includes('mayor_billing_checkouts'))return {n:0};return null;},
   async run(){return {success:true,meta:{}};},
   async all(){return {results:[]};}
  };}};
 }};
}
const env={
 MAYOR_STRIPE_MODE:'test',MAYOR_STRIPE_SECRET_KEY:'sk_test_fixture',MAYOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',
 MAYOR_STRIPE_PRICE_ID:'price_ProTest123',MAYOR_STRIPE_FOUNDING_PRICE_ID:'price_FoundingTest123',
 MAYOR_STRIPE_AUDIT_PRICE_ID:'price_1UMcNH4NaXpNyV6yUOU7pvEH',
 MAYOR_STRIPE_CREDIT_PRICE_SMALL:'price_PackSmall123',MAYOR_STRIPE_CREDIT_PRICE_MEDIUM:'price_PackMedium123',MAYOR_STRIPE_CREDIT_PRICE_LARGE:'price_PackLarge123',
 AGENT_DB:fakeDb(0),
} as never;

describe('ProductDescriptor (Slice 0, §1.7)',()=>{
 it('carries the settled name and slogan verbatim',async()=>{
  const descriptor=buildDescriptor(await readCatalog(env));
  expect(descriptor.descriptorVersion).toBe(DESCRIPTOR_VERSION);
  expect(descriptor.name).toBe('The Mayor');
  expect(descriptor.slogan).toBe('Mayor. Talk to your business.');
  expect(descriptor.capabilities.length).toBeGreaterThan(0);
 });

 it('references prices by catalog ref and amount — never a raw Stripe price ID',async()=>{
  const descriptor=buildDescriptor(await readCatalog(env));
  const serialized=JSON.stringify(descriptor);
  expect(serialized).not.toContain('price_');
  expect(descriptor.prices.find(p=>p.ref==='pro')).toMatchObject({cents:9900,kind:'subscription'});
  expect(descriptor.prices.find(p=>p.ref==='audit:worker')).toMatchObject({cents:33000,kind:'one_time'});
  expect(descriptor.prices.find(p=>p.ref==='audit:hub')).toMatchObject({cents:33000,kind:'one_time'});
  expect(descriptor.audit.priceRefs).toEqual(['audit:worker','audit:hub']);
  expect(descriptor.audit.delivery).toBe('Payment queues the audit; it does not mean a report is complete.');
  const hash=await descriptorHash(descriptor);
  expect(hash).toMatch(/^[a-f0-9]{64}$/);
 });

 it('hash is stable across seat-count changes (seats are state, not identity)',async()=>{
  const catalog=await readCatalog(env);
  const a=await descriptorHash(buildDescriptor(catalog));
  const changed={...catalog,founding:{available:true,seats_total:25,seats_taken:20,seats_remaining:5}};
  const b=await descriptorHash(buildDescriptor(changed as never));
  expect(b).toBe(a);
 });

 it('hash changes when a catalog price changes',async()=>{
  const catalog=await readCatalog(env);
  const a=await descriptorHash(buildDescriptor(catalog));
  const repriced={...catalog,prices:catalog.prices.map(p=>p.ref==='pro'?{...p,cents:10_900}:p)};
  expect(await descriptorHash(buildDescriptor(repriced as never))).not.toBe(a);
 });

 it('stamps the hash into HTML head and reads it back; stamping is idempotent',async()=>{
  const hash=await descriptorHash(buildDescriptor(await readCatalog(env)));
  const html='<html><head><title>The Mayor</title></head><body></body></html>';
  const stamped=stampDescriptorHash(html,hash);
  expect(stampedDescriptorHash(stamped)).toBe(hash);
  expect(stampDescriptorHash(stamped,hash)).toBe(stamped);
 });
});
