/**
 * rot551-folds.test.ts — Product Chief QA folds (🔵, 2026-10-22; DECIDE
 * fold .8149 AUTO) into the undeployed reinvention tree:
 *
 * C4 — the seven vertical pages (/sales/<slug>, closed set) gain the
 *    subscription offer path in the stack's established pattern: the
 *    same sales cards /sales serves, rendered at serve time from the
 *    live catalog (injectVerticalPlans → salesPlansSsrHtml), with the
 *    founding anchor's fail-quiet seat semantics and FINAL_SALE_LINE
 *    at the new asks. The checklist carve-out that kept the verticals
 *    ask-free is retired by name (checklist addendum, this pass).
 * C5 — the plan summary stands BEFORE the OAuth wall for every
 *    carried intent: Slice 1 built it for founding only; the Pro and
 *    top-up pack intents now get the same Desk Ribbon + sign-in-block
 *    line, catalog-fed and fail-quiet, on the unchanged carrier.
 *
 * Anti-rot discipline (🔵 refinement): every rendered price/lock/seat
 * value below is composed from the catalog constants in the test and
 * compared against the render — no expected value is a bare literal
 * the pins don't tie back to src/billing/plans.ts.
 */
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {injectVerticalPlans,salesPlansSsrHtml,FINAL_SALE_LINE,type FoundingSsrBlock} from '../src/offer-block-ssr';
import {PLANS,CREDIT_PACKS,PRO_PRICE_CENTS,FOUNDING_PRICE_CENTS,FOUNDING_SEATS_TOTAL} from '../src/billing/plans';
import {SALES_VERTICAL_SLUGS} from '../src/public-routes';

const here=dirname(fileURLToPath(import.meta.url));
const readSrc=(f:string)=>readFileSync(join(here,'..','src',f),'utf8');
const readWeb=(f:string)=>readFileSync(join(here,'..','web',f),'utf8');
const readScript=(f:string)=>readFileSync(join(here,'..','scripts',f),'utf8');
const readGolden=(f:string)=>readFileSync(join(here,'golden',f),'utf8');
const count=(hay:string,needle:string)=>hay.split(needle).length-1;
const LINE='Payments are final and non-refundable';
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(cents/100);
const moneyExact=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100);

const LIVE_FOUNDING:FoundingSsrBlock={available:true,seats_total:FOUNDING_SEATS_TOTAL,seats_taken:3,seats_remaining:FOUNDING_SEATS_TOTAL-3};
const UNAVAILABLE_FOUNDING:FoundingSsrBlock={available:false,seats_total:FOUNDING_SEATS_TOTAL,seats_taken:null,seats_remaining:null};
const FULL_FOUNDING:FoundingSsrBlock={available:true,seats_total:FOUNDING_SEATS_TOTAL,seats_taken:FOUNDING_SEATS_TOTAL,seats_remaining:0};

const verticalPage=(slug:string)=>readWeb(`sales/${slug}.html`);

/* ---- C4: every vertical page carries the offer path ---------------- */

it('rot551 C4: the vertical set is the closed seven, and every generated page carries the plans container',()=>{
  expect(SALES_VERTICAL_SLUGS).toHaveLength(7);
  for(const slug of SALES_VERTICAL_SLUGS){
    const page=verticalPage(slug);
    expect(page).toContain('<div id="vertical-plan-cards" class="plan-grid">');
    expect(page).toContain('id="plans"');
  }
});

it('rot551 C4: the generated page sources stay price-free — prices exist only at serve time',()=>{
  for(const slug of SALES_VERTICAL_SLUGS){
    expect(verticalPage(slug)).not.toMatch(/\$\d/);
    expect(verticalPage(slug)).not.toContain(LINE);
  }
  // The generator is the source of the pages: the container is born
  // there, not hand-edited into the outputs.
  expect(readScript('gen-sales-verticals.mjs')).toContain('id="vertical-plan-cards"');
  expect(readScript('gen-sales-verticals.mjs')).not.toMatch(/\$\d/);
});

it('rot551 C4: serve-time injection gives every vertical page the Pro ask, the founding anchor, and the line at each ask',()=>{
  const proPrice=money(PRO_PRICE_CENTS),foundingPrice=moneyExact(FOUNDING_PRICE_CENTS);
  for(const slug of SALES_VERTICAL_SLUGS){
    const html=injectVerticalPlans(verticalPage(slug),LIVE_FOUNDING);
    // Pro ask: destination + catalog price on the CTA.
    expect(html).toContain(`href="/billing?plan=pro"`);
    expect(html).toContain(`Go Pro — ${proPrice}/mo`);
    // Free ask: the only free-start verb.
    expect(html).toContain('href="/?start=1"');
    // Founding anchor: destination + exact catalog price + lock wording
    // + the MEASURED seat count from the founding block.
    expect(html).toContain('href="/billing?plan=founding"');
    expect(html).toContain(`Founding cohort: <strong>${foundingPrice}/mo locked for life</strong> — ${LIVE_FOUNDING.seats_remaining} of ${FOUNDING_SEATS_TOTAL} seats left.`);
    // The final-sale line rides exactly the two purchase asks the cards
    // carry (Pro card + top-up card) — the same placement as /sales.
    expect(count(html,LINE)).toBe(2);
    expect(count(html,FINAL_SALE_LINE)).toBe(2);
    const proCard=html.slice(html.indexOf('>Pro</h3>'),html.indexOf('>Top up</h3>'));
    expect(count(proCard,LINE)).toBe(1);
    expect(proCard.indexOf(LINE)).toBeGreaterThan(proCard.indexOf('/billing?plan=pro'));
    const topupCard=html.slice(html.indexOf('>Top up</h3>'));
    expect(count(topupCard,LINE)).toBe(1);
    // Pack prices on the top-up card are the catalog's, exactly.
    for(const pack of CREDIT_PACKS)expect(html).toContain(`${pack.name} — ${money(pack.priceCents)}`);
    // The container is marked server-rendered, like every other surface.
    expect(html).toContain('<div id="vertical-plan-cards" data-ssr="catalog"');
  }
});

it('rot551 C4: the seat count is the founding block\u2019s number, not a page constant',()=>{
  const seven:FoundingSsrBlock={available:true,seats_total:FOUNDING_SEATS_TOTAL,seats_taken:FOUNDING_SEATS_TOTAL-7,seats_remaining:7};
  const html=injectVerticalPlans(verticalPage('salon'),seven);
  expect(html).toContain(`— 7 of ${FOUNDING_SEATS_TOTAL} seats left.`);
  expect(html).not.toContain(`— ${LIVE_FOUNDING.seats_remaining} of ${FOUNDING_SEATS_TOTAL} seats left.`);
});

it('rot551 C4: fail-quiet founding — unverifiable count renders the static line with NO number; a full cohort renders no anchor',()=>{
  const quiet=injectVerticalPlans(verticalPage('dental'),UNAVAILABLE_FOUNDING);
  expect(quiet).toContain('href="/billing?plan=founding"');
  expect(quiet).toContain(`for the first ${FOUNDING_SEATS_TOTAL} businesses.`);
  expect(quiet).not.toContain('seats left');
  expect(quiet).toContain(`Go Pro — ${money(PRO_PRICE_CENTS)}/mo`);
  const full=injectVerticalPlans(verticalPage('dental'),FULL_FOUNDING);
  expect(full).not.toContain('/billing?plan=founding');
  expect(full).not.toContain('Founding cohort');
  expect(full).toContain(`Go Pro — ${money(PRO_PRICE_CENTS)}/mo`);
  expect(count(full,LINE)).toBe(2);
  const none=injectVerticalPlans(verticalPage('dental'),null);
  expect(none).not.toContain('Founding cohort');
  expect(none).toContain(`Go Pro — ${money(PRO_PRICE_CENTS)}/mo`);
});

it('rot551 C4: the vertical cards are the /sales cards — same renderer output, byte for byte',()=>{
  const cards=salesPlansSsrHtml(LIVE_FOUNDING)!;
  const html=injectVerticalPlans(verticalPage('restaurant'),LIVE_FOUNDING);
  expect(html).toContain(cards);
});

it('rot551 C4: injection is a no-op without the container (the /sales page itself is untouched by this injector)',()=>{
  const sales=readWeb('sales.html');
  expect(injectVerticalPlans(sales,LIVE_FOUNDING)).toBe(sales);
});

it('rot551 C4: the serve route renders the vertical pages through the catalog seam',()=>{
  const index=readSrc('index.ts');
  const route=index.slice(index.indexOf('isSalesVerticalPath(url.pathname)'),index.indexOf('const telnyxIncoming'));
  expect(route).toContain('injectVerticalPlans(original,await foundingSeats(env))');
});

/* ---- C5: the plan summary before the OAuth wall -------------------- */

it('rot551 C5: the golden renders tie the Pro and pack Ribbons to the catalog constants',()=>{
  const pro=PLANS.find(p=>p.id==='pro')!;
  expect(pro.priceCents).toBe(PRO_PRICE_CENTS);
  const proGolden=readGolden('ribbon-pro-carried.html');
  expect(proGolden).toContain(`${money(pro.priceCents)}/mo`);
  expect(proGolden).toContain('Pro — you&#x27;re headed here.');
  expect(proGolden).not.toContain('seats left');
  const small=CREDIT_PACKS.find(p=>p.id==='small')!;
  const packGolden=readGolden('ribbon-pack-carried.html');
  expect(packGolden).toContain(`${money(small.priceCents)} one-time`);
  expect(packGolden).toContain('Small top-up');
  expect(packGolden).not.toContain('seats left');
});

it('rot551 C5: fail-quiet — the Pro Ribbon with no catalog label renders the summary with NO price and NO count',()=>{
  const quiet=readGolden('ribbon-pro-failquiet.html');
  expect(quiet).toContain('Pro — you&#x27;re headed here.');
  expect(quiet).not.toContain('$');
  expect(quiet).not.toContain('seats left');
});

it('rot551 C5: the Desk builder carries every intent kind — pro and pack Ribbons beside founding',()=>{
  const main=readWeb('main.ts');
  const builder=main.slice(main.indexOf('function deskRibbonIntent()'),main.indexOf('function deskIntents()'));
  expect(builder).toContain("intent.kind==='plan'&&intent.id==='founding'");
  expect(builder).toContain("intent.kind==='plan'&&intent.id==='pro'");
  expect(builder).toContain("intent.kind==='pack'");
  expect(builder).toContain("planRef:'pro'");
  expect(builder).toContain("planRef:'pack',packId:intent.id");
  // The builder only PEEKS the carrier — rendering never consumes.
  expect(builder).toContain('peekBillingIntent()');
  expect(builder).not.toContain('takeBillingIntent');
  // Prices ride catalog-fed labels, composed from the catalog read.
  expect(builder).toContain('deskCatalog.proPriceLabel');
  expect(builder).toContain('deskCatalog.packLabels?.[intent.id]');
  // Seats never ride a non-founding Ribbon: the word appears only in
  // the founding branch (sold-out + carried seats) of the builder.
  const proBranch=builder.slice(builder.indexOf("intent.kind==='plan'&&intent.id==='pro'"));
  expect(proBranch).not.toContain('seats');
});

it('rot551 C5: the sign-in block names the Pro and pack intents too — before the wall, fail-quiet',()=>{
  const main=readWeb('main.ts');
  const block=main.slice(main.indexOf("const line=$('signin-intent-line');"),main.indexOf('function stripIntentParams()'));
  expect(block).toContain("intent.id==='founding'");
  expect(block).toContain("intent.id==='pro'");
  expect(block).toContain("intent.kind==='pack'");
  expect(block).toContain("Sign in and we'll open the Pro plan you chose");
  expect(block).toContain("Sign in and we'll open the top-up you chose");
  expect(block).toContain('deskCatalog.proPriceLabel');
  expect(block).toContain('deskCatalog.packLabels?.[intent.id]');
});

it('rot551 C5: pack labels are built from the catalog read — the same response the founding label comes from',()=>{
  const main=readWeb('main.ts');
  const loader=main.slice(main.indexOf('async function loadDeskCatalog()'),main.indexOf('async function loadDeskData('));
  expect(loader).toContain("fetch('/api/billing/catalog')");
  expect(loader).toContain('catalog?.creditPacks');
  expect(loader).toContain('one-time`');
  expect(loader).toContain('foundingPriceLabel');
});

it('rot551 C5: the carrier law is untouched — same key, same TTL, consume-once, URL wins',()=>{
  const carrier=readWeb('billing-intent.ts');
  expect(carrier).toContain("const STORAGE_KEY = 'mayor_billing_intent';");
  expect(carrier).toContain('export const INTENT_TTL_MS = 60 * 60 * 1000;');
  expect(carrier).toContain("if (query.get('plan') === 'founding') return { kind: 'plan', id: 'founding' };");
  expect(carrier).toContain("if (query.get('plan') === 'pro') return { kind: 'plan', id: 'pro' };");
});

/* ---- Anti-hardcode sweep over the fold surfaces -------------------- */

it('rot551 anti-rot: no price literal appears in the fold\u2019s sources that the pins do not cover',()=>{
  // The SSR renderer and the generator are literal-free (established
  // seam discipline): every figure they emit is computed.
  expect(readSrc('offer-block-ssr.ts')).not.toMatch(/\$\d/);
  expect(readScript('gen-sales-verticals.mjs')).not.toMatch(/\$\d/);
  // main.ts carries exactly the two pre-existing regex-replacement
  // usages (' $1' in label prettifiers) and no price literal — the C5
  // compositions format catalog cents, they never state an amount.
  const main=readWeb('main.ts');
  const hits=main.match(/\$\d/g)??[];
  expect(hits).toHaveLength(2);
  expect(count(main,"replace(/([A-Z])/g,' $1')")).toBe(2);
});
