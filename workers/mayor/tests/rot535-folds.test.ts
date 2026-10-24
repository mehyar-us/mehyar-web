/**
 * rot535-folds.test.ts — Product Chief fold order (2026-10-22) from
 * qa/qa-mayor-rot535.md (CORRECTED), built into the undeployed tree:
 *
 * 1. Final-sale disclosure at the /pricing + /sales purchase asks
 *    (one line, Terms linked; /sales folded on 🔵's scope extension —
 *    home and verticals stay out).
 * 2. Product JSON-LD truth: per-plan Offers at their real catalog
 *    prices, INCLUDING the Founding price the emitter used to omit —
 *    pinned name→price against plans.ts so it cannot rot back.
 * 3. CTA destinations verified against the tree (the founding mismatch
 *    was already corrected by Slice 1 — pinned here so it stays so).
 *
 * Fold 4 (§8.2 completion on the /business-audit FAQ) is pinned in
 * tests/rot273-audit-copy.test.ts with its supersession recorded.
 *
 * rot543 addendum (🔵, 2026-10-22): the two scope exclusions above —
 * home out of scope, pack cards without the line — are SUPERSEDED.
 * The flips are recorded at the pins themselves; the extension is
 * pinned in tests/rot543-folds.test.ts.
 */
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {pricingCardsSsrHtml,salesPlansSsrHtml,injectPricingCards,injectSalesPlans,structuredDataSsrHtml,offerBlockSsrHtml,FINAL_SALE_LINE,type FoundingSsrBlock} from '../src/offer-block-ssr';
import {PLANS,CREDIT_PACKS,FOUNDING_PRICE_CENTS} from '../src/billing/plans';
import {AUDIT_OFFER} from '../src/billing/audit';

const here=dirname(fileURLToPath(import.meta.url));
const readWeb=(f:string)=>readFileSync(join(here,'..','web',f),'utf8');
const count=(hay:string,needle:string)=>hay.split(needle).length-1;
const LIVE_FOUNDING:FoundingSsrBlock={available:true,seats_total:25,seats_taken:3,seats_remaining:22};

/* ---- Fold 1: the final-sale line at the asks ----------------------- */

it('rot535 fold 1: /pricing SSR carries the final-sale line once, on the Pro card only',()=>{
  const rendered=pricingCardsSsrHtml(LIVE_FOUNDING)!;
  expect(count(rendered.plans,'Payments are final and non-refundable')).toBe(1);
  expect(rendered.plans).toContain(FINAL_SALE_LINE);
  expect(FINAL_SALE_LINE).toContain('see <a href="/terms">Terms</a>');
  // The line rides the Pro card — after the founding anchor + Pro CTA,
  // inside the same article (both asks covered by the one card).
  const proCard=rendered.plans.slice(rendered.plans.indexOf('>Pro<'));
  expect(proCard).toContain('Payments are final and non-refundable');
  // SUPERSEDED by rot543 (🔵 ruling, 2026-10-22): this pin asserted the
  // pack cards carry NO line (rot535's order named the Pro/Founding
  // asks only). rot543 rules a top-up is a purchase with no carve-out —
  // the packs now carry the line, once per card; the detailed pins live
  // in tests/rot543-folds.test.ts.
  expect(count(rendered.packs,'Payments are final and non-refundable')).toBe(3);
});

it('rot535 fold 1: /sales SSR carries the final-sale line once, on the Pro card',()=>{
  const rendered=salesPlansSsrHtml(LIVE_FOUNDING)!;
  // SUPERSEDED in count by rot543 (🔵 ruling, 2026-10-22): the whole-
  // output count was 1 when the Pro card was the only disclosed ask.
  // rot543 gives the /sales top-up card the line too (packs render
  // there as an offer card) — whole-output count is now 2, pinned in
  // tests/rot543-folds.test.ts. This pin keeps its subject: the Pro
  // card itself carries the line exactly once.
  const proCard=rendered.slice(rendered.indexOf('<h3>Pro</h3>'),rendered.indexOf('<h3>Top up</h3>'));
  expect(count(proCard,'Payments are final and non-refundable')).toBe(1);
  expect(rendered).toContain(FINAL_SALE_LINE);
});

it('rot535 fold 1: home offer block — absence pin SUPERSEDED by rot543',()=>{
  // rot535 scope: home was OUT — this pin asserted the home offer block
  // carries no final-sale line. 🔵 rot543 ruling (2026-10-22): the home
  // ask joins the final-sale scope. The absence pin is superseded; the
  // line now rides the home Pro row exactly once, and the full pins
  // live in tests/rot543-folds.test.ts. This test remains as the
  // supersession record, following the rot273 pattern.
  expect(count(offerBlockSsrHtml(LIVE_FOUNDING)!,'Payments are final and non-refundable')).toBe(1);
});

it('rot535 fold 1: the Cancel-anytime renewal truth stands beside it on both pages',()=>{
  expect(readWeb('pricing.html')).toContain('Cancel anytime — cancelling stops renewal, and your plan runs to the end of the paid period.');
  expect(readWeb('sales.html')).toContain('Cancel anytime — cancelling stops renewal, and your plan runs to the end of the paid period.');
});

it('rot535 fold 1: the /pricing client-fallback Pro card carries the line too',()=>{
  // The fallback only renders when SSR injection did not happen, but
  // when it renders it IS the purchase ask — the disclosure holds.
  expect(readWeb('pricing.html')).toContain('<p class="plan-final-sale">Payments are final and non-refundable — see <a href="/terms">Terms</a>.</p>');
});

/* ---- Fold 2: JSON-LD truth, pinned against the catalog ------------- */

interface LdOffer{name:string;price:number;availability:string}
function ldOffers(html:string):LdOffer[]{
  const m=html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  expect(m).not.toBeNull();
  const data=JSON.parse(m![1]);
  expect(data['@type']).toBe('Product');
  return data.offers as LdOffer[];
}

it('rot535 fold 2: every emitted Offer price equals its catalog price (name→price pin)',()=>{
  const offers=ldOffers(structuredDataSsrHtml(true,LIVE_FOUNDING));
  const byName=new Map(offers.map(o=>[o.name,o.price]));
  for(const p of PLANS)expect(byName.get(p.name)).toBe(p.priceCents/100);
  for(const p of CREDIT_PACKS)expect(byName.get(`${p.name} top-up`)).toBe(p.priceCents/100);
  expect(byName.get(AUDIT_OFFER.name)).toBe(AUDIT_OFFER.priceCents/100);
  // The founding price the emitter used to omit is present, from
  // FOUNDING_PRICE_CENTS — the same constant the pages render.
  expect(byName.get('Founding cohort')).toBe(FOUNDING_PRICE_CENTS/100);
});

it('rot535 fold 2: the anti-rot pin — the Pro Offer is the Pro price, never $0-for-everything',()=>{
  const offers=ldOffers(structuredDataSsrHtml(false));
  const pro=PLANS.find(p=>p.id==='pro')!;
  const proOffer=offers.find(o=>o.name===pro.name)!;
  expect(proOffer.price).toBe(pro.priceCents/100);
  expect(proOffer.price).toBeGreaterThan(0);
  expect(offers.some(o=>o.price>0)).toBe(true);
  // No paid plan may ever be emitted at the Free tier's price.
  for(const o of offers)if(o.name!=='Free')expect(o.price).toBeGreaterThan(0);
});

it('rot535 fold 2: founding availability in JSON-LD mirrors the visible line (full ⇒ OutOfStock)',()=>{
  const full=ldOffers(structuredDataSsrHtml(true,{available:true,seats_total:25,seats_taken:25,seats_remaining:0}));
  expect(full.find(o=>o.name==='Founding cohort')!.availability).toBe('https://schema.org/OutOfStock');
  const live=ldOffers(structuredDataSsrHtml(true,LIVE_FOUNDING));
  expect(live.find(o=>o.name==='Founding cohort')!.availability).toBe('https://schema.org/InStock');
});

it('rotation 628 (2026-10-24): founding JSON-LD availability follows the count — InStock only while seats verifiably remain',()=>{
  // An unverifiable count (block unavailable or absent) no longer
  // asserts InStock on the seat-limited offer; seats remaining at
  // any claimed count — zero included — stays InStock.
  const unavailable=ldOffers(structuredDataSsrHtml(true,{available:false,seats_total:25,seats_taken:null,seats_remaining:null}));
  expect(unavailable.find(o=>o.name==='Founding cohort')!.availability).toBe('https://schema.org/OutOfStock');
  const absent=ldOffers(structuredDataSsrHtml(true));
  expect(absent.find(o=>o.name==='Founding cohort')!.availability).toBe('https://schema.org/OutOfStock');
  const zeroClaimed=ldOffers(structuredDataSsrHtml(true,{available:true,seats_total:25,seats_taken:0,seats_remaining:25}));
  expect(zeroClaimed.find(o=>o.name==='Founding cohort')!.availability).toBe('https://schema.org/InStock');
});

it('rot535 fold 2: both served pages emit the founding price in their JSON-LD',()=>{
  for(const out of [injectPricingCards(readWeb('pricing.html'),true,LIVE_FOUNDING),injectSalesPlans(readWeb('sales.html'),true,LIVE_FOUNDING)]){
    const offers=ldOffers(out);
    expect(offers.find(o=>o.name==='Founding cohort')!.price).toBe(FOUNDING_PRICE_CENTS/100);
  }
});

/* ---- Fold 3: CTA destinations, verified against the tree ----------- */

it('rot535 fold 3: the founding CTA is a real price-carrying anchor on both served pages (Slice 1, pinned)',()=>{
  const pro=PLANS.find(p=>p.id==='pro')!;
  for(const out of [injectPricingCards(readWeb('pricing.html'),true,LIVE_FOUNDING),injectSalesPlans(readWeb('sales.html'),true,LIVE_FOUNDING)]){
    // Founding: anchor + the exact founding price it will charge.
    // (Rate wording qualified 2026-10-24, rotation 633: "locked at
    // that rate for as long as your founding subscription stays
    // active" — the subscription's own condition, per the code.)
    expect(out).toContain('<a href="/billing?plan=founding">');
    expect(out).toContain(`$${(FOUNDING_PRICE_CENTS/100).toFixed(2)}/mo, locked at that rate for as long as your founding subscription stays active`);
    // Pro: label carries the Pro price and lands on the Pro checkout.
    expect(out).toContain(`href="/billing?plan=pro">Go Pro — $${pro.priceCents/100}/mo</a>`);
    // Free: the only free-start verb, at the only start destination.
    expect(out).toContain('href="/?start=1">Start free</a>');
  }
});

it('rot535 fold 3: /pricing top-up CTAs each carry their own pack destination',()=>{
  const rendered=pricingCardsSsrHtml(LIVE_FOUNDING)!;
  for(const pack of CREDIT_PACKS){
    expect(rendered.packs).toContain(`href="/billing?pack=${pack.id}">Buy ${pack.name}</a>`);
    expect(rendered.packs).toContain(`$${pack.priceCents/100}`);
  }
});
