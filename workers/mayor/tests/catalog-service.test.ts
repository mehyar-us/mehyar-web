import {describe,expect,it} from 'vitest';
import {readCatalog,catalogEntryByPriceId,HUB_AUDIT_PRICE_ID} from '../src/catalog-service';
import {FOUNDING_PRICE_CENTS,PRO_PRICE_CENTS} from '../src/billing/plans';

const FOUNDING_PRICE='price_FoundingTest123';
const PRO_PRICE='price_ProTest123';
const WORKER_AUDIT_PRICE='price_1UMcNH4NaXpNyV6yUOU7pvEH';

function fakeDb(subs:number,open=0,fail=false){
 return {prepare(sql:string){
  return {bind(){return {
   async first(){if(fail)throw new Error('d1 unavailable');
    if(sql.includes('mayor_billing_subscriptions'))return {held:subs};
    if(sql.includes('mayor_billing_checkouts'))return {open};
    return null;},
   async run(){return {success:true,meta:{}};},
   async all(){return {results:[]};}
  };}};
 }};
}

function fixtureEnv(db:unknown){
 return {
  MAYOR_STRIPE_MODE:'test',
  MAYOR_STRIPE_SECRET_KEY:'sk_test_fixture',
  MAYOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',
  MAYOR_STRIPE_PRICE_ID:PRO_PRICE,
  MAYOR_STRIPE_FOUNDING_PRICE_ID:FOUNDING_PRICE,
  MAYOR_STRIPE_AUDIT_PRICE_ID:WORKER_AUDIT_PRICE,
  MAYOR_STRIPE_CREDIT_PRICE_SMALL:'price_PackSmall123',
  MAYOR_STRIPE_CREDIT_PRICE_MEDIUM:'price_PackMedium123',
  MAYOR_STRIPE_CREDIT_PRICE_LARGE:'price_PackLarge123',
  AGENT_DB:db,
 } as never;
}

describe('CatalogService (Slice 0, §1.7/§1.8)',()=>{
 it('projects plans and packs from the one catalog',async()=>{
  const catalog=await readCatalog(fixtureEnv(fakeDb(0)));
  expect(catalog.plans.find(p=>p.id==='pro')?.priceCents).toBe(PRO_PRICE_CENTS);
  expect(catalog.creditPacks.map(p=>p.id)).toEqual(['small','medium','large']);
 });

 it('keys every price by price ID, never by amount — both $330 audits stay distinct',async()=>{
  const catalog=await readCatalog(fixtureEnv(fakeDb(0)));
  const worker=catalog.prices.find(p=>p.ref==='audit:worker');
  const hub=catalog.prices.find(p=>p.ref==='audit:hub');
  expect(worker?.priceId).toBe(WORKER_AUDIT_PRICE);
  expect(hub?.priceId).toBe(HUB_AUDIT_PRICE_ID);
  expect(worker?.priceId).not.toBe(hub?.priceId);
  expect(worker?.cents).toBe(33_000);
  expect(hub?.funnel).toBe('hub');
  expect(worker?.funnel).toBe('worker');
  expect(catalogEntryByPriceId(catalog,WORKER_AUDIT_PRICE)?.ref).toBe('audit:worker');
  expect(catalogEntryByPriceId(catalog,HUB_AUDIT_PRICE_ID)?.ref).toBe('audit:hub');
 });

 it('derives founding seats ONLY from subscription-row counting',async()=>{
  const catalog=await readCatalog(fixtureEnv(fakeDb(3)));
  expect(catalog.founding).toMatchObject({available:true,seats_total:25,seats_taken:3,seats_remaining:22});
  expect(catalog.foundingPriceCents).toBe(FOUNDING_PRICE_CENTS);
 });

 it('preserves the fail-quiet law: uncomputable seats means no number, available:false',async()=>{
  const catalog=await readCatalog(fixtureEnv(fakeDb(0,0,true)));
  expect(catalog.founding.available).toBe(false);
  expect(catalog.founding.seats_taken).toBeNull();
  expect(catalog.founding.seats_remaining).toBeNull();
  // The rest of the catalog still reads.
  expect(catalog.prices.find(p=>p.ref==='pro')?.priceId).toBe(PRO_PRICE);
 });

 it('never guesses a price ID the deployment does not configure',async()=>{
  const catalog=await readCatalog({AGENT_DB:fakeDb(0)} as never);
  const pro=catalog.prices.find(p=>p.ref==='pro');
  expect(pro?.priceId).toBeNull();
  expect(pro?.available).toBe(false);
  // The hub audit entry is a registry fact and always resolves.
  expect(catalogEntryByPriceId(catalog,HUB_AUDIT_PRICE_ID)?.ref).toBe('audit:hub');
 });
});
