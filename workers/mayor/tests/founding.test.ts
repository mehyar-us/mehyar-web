import {describe,expect,it} from 'vitest';
import {foundingGateOpen,foundingSeats,FOUNDING_UNAVAILABLE} from '../src/billing/founding';
import {assertFoundingPrice,assertPrice} from '../src/billing/stripe';
import {FOUNDING_PRICE_CENTS,FOUNDING_SEATS_TOTAL,PRO_PRICE_CENTS} from '../src/billing/plans';
import {foundingLineSsrHtml} from '../src/offer-block-ssr';
import type {Env} from '../src/env';

/* Founding cohort (2026-10-16): the counter reads ONLY the worker's
 * billing state; the gate refuses founding checkout at 25 held seats
 * (counting in-flight founding checkouts); both Stripe Price contracts
 * assert exactly. */
function fakeDb(rows:{held?:number;open?:number;fail?:boolean}){
 const binds:Array<unknown[]>=[];
 return {binds,db:{prepare(sql:string){return {bind:(...args:unknown[])=>{binds.push(args);return {first:async()=>{if(rows.fail)throw new Error('db down');if(sql.includes('mayor_billing_subscriptions'))return {held:rows.held??0};if(sql.includes('mayor_billing_checkouts'))return {open:rows.open??0};throw new Error('unexpected sql');}};}};}} as unknown as Env['AGENT_DB']};
}
function envWith(db:Env['AGENT_DB'],foundingId?:string):Env{
 return {AGENT_DB:db,MAYOR_STRIPE_MODE:'live',MAYOR_STRIPE_FOUNDING_PRICE_ID:foundingId} as Env;
}
const FOUNDING_ID='price_FoundingFixture';

describe('foundingSeats — the locked seam block',()=>{
 it('reports unavailable with null counts when the founding Price is not configured',async()=>{
  const {db}=fakeDb({held:0});
  expect(await foundingSeats(envWith(db))).toEqual(FOUNDING_UNAVAILABLE);
  expect(await foundingSeats(envWith(db,'not-a-price'))).toEqual(FOUNDING_UNAVAILABLE);
 });
 it('reports unavailable when billing mode is not configured',async()=>{
  const {db}=fakeDb({held:0});
  const env={AGENT_DB:db,MAYOR_STRIPE_FOUNDING_PRICE_ID:FOUNDING_ID} as Env;
  expect(await foundingSeats(env)).toEqual(FOUNDING_UNAVAILABLE);
 });
 it('counts zero sold as a true available zero state',async()=>{
  const {db,binds}=fakeDb({held:0});
  expect(await foundingSeats(envWith(db,FOUNDING_ID))).toEqual({available:true,seats_total:FOUNDING_SEATS_TOTAL,seats_taken:0,seats_remaining:FOUNDING_SEATS_TOTAL});
  expect(binds[0]).toEqual(['live',FOUNDING_ID]);
 });
 it('derives remaining from held seats and clamps at the cohort size',async()=>{
  const {db}=fakeDb({held:7});
  expect(await foundingSeats(envWith(db,FOUNDING_ID))).toMatchObject({seats_taken:7,seats_remaining:FOUNDING_SEATS_TOTAL-7});
  const {db:full}=fakeDb({held:FOUNDING_SEATS_TOTAL});
  expect(await foundingSeats(envWith(full,FOUNDING_ID))).toMatchObject({seats_taken:FOUNDING_SEATS_TOTAL,seats_remaining:0});
 });
 it('fails to unavailable (never a guessed number) when the read fails',async()=>{
  const {db}=fakeDb({fail:true});
  expect(await foundingSeats(envWith(db,FOUNDING_ID))).toEqual(FOUNDING_UNAVAILABLE);
 });
});

describe('foundingGateOpen — checkout refusal at 25',()=>{
 it('opens while seats remain and no checkouts are in flight',async()=>{
  const {db}=fakeDb({held:24,open:0});
  expect(await foundingGateOpen(envWith(db,FOUNDING_ID))).toBe(true);
 });
 it('closes at 25 held seats',async()=>{
  const {db}=fakeDb({held:25,open:0});
  expect(await foundingGateOpen(envWith(db,FOUNDING_ID))).toBe(false);
 });
 it('counts in-flight founding checkouts against the last seat',async()=>{
  const {db}=fakeDb({held:24,open:1});
  expect(await foundingGateOpen(envWith(db,FOUNDING_ID))).toBe(false);
 });
 it('closes when the counter is unavailable',async()=>{
  const {db}=fakeDb({held:0});
  expect(await foundingGateOpen(envWith(db))).toBe(false);
 });
});

describe('price contracts after the $99 apply',()=>{
 const base={id:'price_ListFixture',livemode:true,active:true,currency:'usd',type:'recurring',recurring:{interval:'month',interval_count:1},billing_scheme:'per_unit',tax_behavior:'exclusive'};
 const env={MAYOR_STRIPE_MODE:'live',MAYOR_STRIPE_SECRET_KEY:'sk_live_fixture',MAYOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',MAYOR_STRIPE_PRICE_ID:'price_ListFixture',MAYOR_STRIPE_FOUNDING_PRICE_ID:'price_FoundingFixture'} as unknown as Parameters<typeof assertPrice>[1];
 it('asserts the $99 list contract exactly',()=>{
  expect(PRO_PRICE_CENTS).toBe(9900);
  expect(()=>assertPrice({...base,unit_amount:9900},env)).not.toThrow();
  expect(()=>assertPrice({...base,unit_amount:1400},env)).toThrowError(/price could not be verified/);
 });
 it('asserts the $79.20 founding contract exactly',()=>{
  expect(FOUNDING_PRICE_CENTS).toBe(7920);
  expect(FOUNDING_PRICE_CENTS).toBe(Math.round(PRO_PRICE_CENTS*0.8));
  expect(()=>assertFoundingPrice({...base,id:'price_FoundingFixture',unit_amount:7920},env)).not.toThrow();
  expect(()=>assertFoundingPrice({...base,id:'price_FoundingFixture',unit_amount:9900},env)).toThrowError(/founding price could not be verified/);
  expect(()=>assertFoundingPrice({...base,id:'price_ListFixture',unit_amount:7920},env)).toThrowError(/founding price could not be verified/);
 });
});

describe('foundingLineSsrHtml — display seam',()=>{
 // Pin wording moved 2026-10-24 (rotation 633, Product Chief
 // order): the rate claim is qualified at the ask — "locked at that
 // rate for as long as your founding subscription stays active" —
 // the condition the subscription logic itself carries (the rate is
 // a property of the one founding subscription; cancel ends it, a
 // deleted subscription cannot be revived). The unqualified "locked
 // for life" no longer renders on any selling surface.
 it('shows the live remaining count while seats remain',()=>{
  const html=foundingLineSsrHtml({available:true,seats_total:25,seats_taken:3,seats_remaining:22});
  expect(html).toContain('$79.20/mo, locked at that rate for as long as your founding subscription stays active');
  expect(html).not.toContain('locked for life');
  expect(html).toContain('22 of 25 seats left');
 });
 it('rotation 628 (2026-10-24): zero claimed renders the LIVE count — the claim is testable at every count',()=>{
  // Pin moved 2026-10-24 (rotation 628, Product Chief order): under
  // the post-deploy pass item 1 Option A threshold display this
  // fixture rendered the static cohort line with no numeric
  // remainder; the desk superseded Option A — the counted line now
  // renders from zero claimed, from the same foundingSeats block.
  const html=foundingLineSsrHtml({available:true,seats_total:25,seats_taken:0,seats_remaining:25});
  expect(html).toContain('$79.20/mo, locked at that rate for as long as your founding subscription stays active');
  expect(html).toContain('25 of 25 seats left');
  expect(html).toContain('<a href="/billing?plan=founding">');
 });
 it('the counter tracks the count from the first claim on, exactly as before',()=>{
  const html=foundingLineSsrHtml({available:true,seats_total:25,seats_taken:1,seats_remaining:24});
  expect(html).toContain('24 of 25 seats left');
 });
 it('shows the static cohort line with NO live number when the count is unavailable',()=>{
  const html=foundingLineSsrHtml(FOUNDING_UNAVAILABLE);
  expect(html).toContain('$79.20/mo, locked at that rate for as long as your founding subscription stays active');
  expect(html).toContain('first 25 businesses');
  expect(html).not.toContain('seats left');
 });
 it('Slice 1: the line is a real anchor to the founding door on both render paths',()=>{
  const live=foundingLineSsrHtml({available:true,seats_total:25,seats_taken:3,seats_remaining:22});
  expect(live).toContain('<a href="/billing?plan=founding">');
  const quiet=foundingLineSsrHtml(FOUNDING_UNAVAILABLE);
  expect(quiet).toContain('<a href="/billing?plan=founding">');
 });
 it('renders nothing once the cohort is full — the $99 list stands alone',()=>{
  expect(foundingLineSsrHtml({available:true,seats_total:25,seats_taken:25,seats_remaining:0})).toBe('');
 });
 it('renders nothing when no block is supplied (existing injector calls unchanged)',()=>{
  expect(foundingLineSsrHtml()).toBe('');
  expect(foundingLineSsrHtml(null)).toBe('');
 });
});
