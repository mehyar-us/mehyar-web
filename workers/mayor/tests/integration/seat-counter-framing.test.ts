/**
 * seat-counter-framing.test.ts — post-deploy pass (2026-10-22)
 * worker-level proofs for items 1 and 2, through the REAL worker:
 *
 * Item 1 (seat-counter framing, Option A threshold display — the
 * Product Chief's binding conditions):
 *   (a) with ZERO founding subscription rows, GET /pricing renders
 *       the founding offer on its established static cohort line —
 *       no numeric "seats left" remainder anywhere in the body;
 *   (b) with ONE seeded founding subscription row (in-tree only —
 *       never production), GET /pricing renders the counter exactly
 *       as it did before the pass: "24 of 25 seats left".
 *   Both states key off the SAME measurement the counter already
 *   reads (foundingSeats' count of mayor_billing_subscriptions rows
 *   in the selected mode at the founding price).
 *
 * Item 2: GET /audit (and its trailing-slash form, via the fetch
 * entry's normalizePathname) 301s to the hub audit.
 *
 * Fixtures mirror tests/integration/founding-door.test.ts (same
 * price ids, same subscription-row shape) and the ASSETS stub
 * mirrors tests/integration/slice0-truth.test.ts.
 */
import {env as testEnv} from 'cloudflare:test';
import pricingHtml from '../../web/pricing.html?raw';
import worker from '../../src/index';
import {beforeEach,describe,expect,it} from 'vitest';
import type {Env} from '../../src/env';

const dbEnv=testEnv as unknown as Env;
let E:Env;

const assets={fetch:async(_request:Request)=>new Response(pricingHtml,{headers:{'content-type':'text/html; charset=utf-8'}})};

async function seedOneFoundingSubscription(){
 const tenantId=crypto.randomUUID().replaceAll('-','');
 const now=new Date().toISOString(),checkoutId=crypto.randomUUID();
 await E.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(tenantId,'Seat framing fixture',now).run();
 await E.AGENT_DB.prepare("INSERT INTO mayor_billing_checkouts(id,tenant_id,mode,request_id,status,created_at,updated_at,cohort) VALUES(?,?,?,?,'completed',?,?,?)").bind(checkoutId,tenantId,'test',crypto.randomUUID(),now,now,'founding').run();
 await E.AGENT_DB.prepare('INSERT INTO mayor_billing_subscriptions(tenant_id,mode,stripe_subscription_id,stripe_customer_id,checkout_id,status,cancel_at_period_end,last_event_created,updated_at,price_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
 .bind(tenantId,'test','sub_seatframing','cus_seatframing',checkoutId,'active',0,Math.floor(Date.now()/1000),now,'price_MayorFounding').run();
}

beforeEach(async()=>{
 E={...dbEnv,MAYOR_STRIPE_MODE:'test',MAYOR_STRIPE_SECRET_KEY:'sk_test_fixture',MAYOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',MAYOR_STRIPE_PRICE_ID:'price_MayorPro',MAYOR_STRIPE_FOUNDING_PRICE_ID:'price_MayorFounding',MAYOR_STRIPE_PORTAL_CONFIGURATION:'bpc_Mayor'} as Env;
 await E.AGENT_DB.prepare('DELETE FROM mayor_billing_subscriptions').run();
 await E.AGENT_DB.prepare('DELETE FROM mayor_billing_checkouts').run();
});

describe('post-deploy pass item 1 — /pricing founding line, both states',()=>{
 it('(a) zero founding rows: the static cohort line, no numeric remainder',async()=>{
  const surfaceEnv={...E,ASSETS:assets} as unknown as Env;
  const res=await worker.fetch(new Request('https://mayor.example.test/pricing'),surfaceEnv,{} as ExecutionContext);
  expect(res.status).toBe(200);
  const body=await res.text();
  expect(body).toContain('Founding cohort');
  expect(body).toContain('for the first 25 businesses');
  expect(body).not.toContain('seats left');
 });
 it('(b) one seeded founding row: the counter exactly as before — 24 of 25 seats left',async()=>{
  await seedOneFoundingSubscription();
  const surfaceEnv={...E,ASSETS:assets} as unknown as Env;
  const res=await worker.fetch(new Request('https://mayor.example.test/pricing'),surfaceEnv,{} as ExecutionContext);
  expect(res.status).toBe(200);
  const body=await res.text();
  expect(body).toContain('24 of 25 seats left');
 });
});

describe('post-deploy pass item 2 — /audit redirect',()=>{
 it('GET /audit 301s to the hub audit',async()=>{
  const res=await worker.fetch(new Request('https://mayor.example.test/audit'),E,{} as ExecutionContext);
  expect(res.status).toBe(301);
  expect(res.headers.get('location')).toBe('https://mehyar.us/audit/');
 });
 it('GET /audit/ reaches the same redirect through entry normalization',async()=>{
  const res=await worker.fetch(new Request('https://mayor.example.test/audit/'),E,{} as ExecutionContext);
  expect(res.status).toBe(301);
  expect(res.headers.get('location')).toBe('https://mehyar.us/audit/');
 });
});
