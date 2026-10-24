/**
 * founding-bridge.test.ts — the founding price bridge (Product Chief
 * order, 2026-10-24). The qualified founding line names the founding
 * rate; the Pro CTA beside it names the standard list rate; the
 * bridge states, at the point of ask, how the founding rate reaches
 * the buyer — while founding seats remain, starting from the
 * founding cohort applies the founding rate at checkout; the list
 * rate on the button is the standard rate once the cohort fills.
 * The bridge is keyed to the SAME founding block as the seats
 * counter: it renders only in the counted-line cell (block available,
 * verified seats remaining) and retires with the cohort. Scope is
 * /pricing and /sales only: the verticals share the sales renderer
 * but must stay byte-identical (no bridge), and no-block calls are
 * unchanged. The mechanism the copy asserts is proven handler-side
 * in tests/integration/founding-checkout.test.ts (the founding
 * bridge leg-2 pin).
 */
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe,expect,it} from 'vitest';
import {foundingBridgeSsrHtml,pricingCardsSsrHtml,salesPlansSsrHtml,injectSalesPlans,injectVerticalPlans,type FoundingSsrBlock} from '../src/offer-block-ssr';
import {FOUNDING_PRICE_CENTS,FOUNDING_SEATS_TOTAL,PRO_PRICE_CENTS} from '../src/billing/plans';

const here=dirname(fileURLToPath(import.meta.url));
const readWeb=(f:string)=>readFileSync(join(here,'..','web',f),'utf8');
const LIVE:FoundingSsrBlock={available:true,seats_total:FOUNDING_SEATS_TOTAL,seats_taken:0,seats_remaining:FOUNDING_SEATS_TOTAL};
const PARTIAL:FoundingSsrBlock={available:true,seats_total:FOUNDING_SEATS_TOTAL,seats_taken:3,seats_remaining:FOUNDING_SEATS_TOTAL-3};
const FULL:FoundingSsrBlock={available:true,seats_total:FOUNDING_SEATS_TOTAL,seats_taken:FOUNDING_SEATS_TOTAL,seats_remaining:0};
const UNAVAILABLE:FoundingSsrBlock={available:false,seats_total:FOUNDING_SEATS_TOTAL,seats_taken:null,seats_remaining:null};
const NULL_COUNT:FoundingSsrBlock={available:true,seats_total:FOUNDING_SEATS_TOTAL,seats_taken:null,seats_remaining:null};

describe('founding bridge — the copy states the mechanism, amounts from the catalog constants',()=>{
 it('renders the bridge while seats remain, priced from the constants',()=>{
  const bridge=foundingBridgeSsrHtml(LIVE,PRO_PRICE_CENTS);
  expect(bridge).toContain('While founding seats remain');
  expect(bridge).toContain('start from the Founding cohort line above');
  expect(bridge).toContain(`$${(FOUNDING_PRICE_CENTS/100).toFixed(2)}/mo founding rate`);
  expect(bridge).toContain(`$${PRO_PRICE_CENTS/100}/mo on this button is the standard rate`);
  expect(bridge).toContain('once the cohort fills');
  // The bridge asserts nothing the qualifier retired and carries no
  // undecided module figure (D5 HOLD).
  expect(bridge).not.toContain('locked for life');
  expect(bridge).not.toContain('$29');
  expect(bridge).not.toContain('$49');
 });
 it('renders at any positive remaining count, not only at zero claimed',()=>{
  expect(foundingBridgeSsrHtml(PARTIAL,PRO_PRICE_CENTS)).toContain('plan-founding-bridge');
 });
});

describe('founding bridge — keyed to the counted-line cell of the same block',()=>{
 it('retires when the cohort fills',()=>{
  expect(foundingBridgeSsrHtml(FULL,PRO_PRICE_CENTS)).toBe('');
 });
 it('never renders on an unverifiable count (fail-closed, the schema rule)',()=>{
  expect(foundingBridgeSsrHtml(UNAVAILABLE,PRO_PRICE_CENTS)).toBe('');
  expect(foundingBridgeSsrHtml(NULL_COUNT,PRO_PRICE_CENTS)).toBe('');
 });
 it('renders nothing without a block or without a trustworthy standard price',()=>{
  expect(foundingBridgeSsrHtml()).toBe('');
  expect(foundingBridgeSsrHtml(null,PRO_PRICE_CENTS)).toBe('');
  expect(foundingBridgeSsrHtml(LIVE)).toBe('');
  expect(foundingBridgeSsrHtml(LIVE,0)).toBe('');
  expect(foundingBridgeSsrHtml(LIVE,Number.NaN)).toBe('');
 });
});

describe('founding bridge — placement at the point of ask',()=>{
 it('/pricing: inside the Pro card, between the founding line and the Go Pro button, exactly once',()=>{
  const plans=pricingCardsSsrHtml(LIVE)!.plans;
  const proAt=plans.indexOf('>Pro<');
  const lineAt=plans.indexOf('class="plan-founding"');
  const bridgeAt=plans.indexOf('class="plan-founding-bridge"');
  const buttonAt=plans.indexOf('>Go Pro');
  expect(proAt).toBeGreaterThanOrEqual(0);
  expect(lineAt).toBeGreaterThan(proAt);
  expect(bridgeAt).toBeGreaterThan(lineAt);
  expect(buttonAt).toBeGreaterThan(bridgeAt);
  expect(plans.split('plan-founding-bridge').length-1).toBe(1);
 });
 it('/sales: the injector opts in — bridge between the founding line and the button, exactly once',()=>{
  const out=injectSalesPlans(readWeb('sales.html'),false,LIVE);
  const lineAt=out.indexOf('class="plan-founding"');
  const bridgeAt=out.indexOf('class="plan-founding-bridge"');
  const buttonAt=out.indexOf('>Go Pro');
  expect(lineAt).toBeGreaterThanOrEqual(0);
  expect(bridgeAt).toBeGreaterThan(lineAt);
  expect(buttonAt).toBeGreaterThan(bridgeAt);
  expect(out.split('plan-founding-bridge').length-1).toBe(1);
 });
 it('the bare sales renderer (the verticals\u2019 call) carries NO bridge — scope is /pricing + /sales only',()=>{
  const rendered=salesPlansSsrHtml(LIVE)!;
  expect(rendered).toContain('class="plan-founding"');
  expect(rendered).not.toContain('plan-founding-bridge');
  const vertical=injectVerticalPlans(readWeb('sales/plumbing-hvac.html'),LIVE);
  expect(vertical).toContain('class="plan-founding"');
  expect(vertical).not.toContain('plan-founding-bridge');
 });
 it('state follows the block through the full injectors: full or unverifiable ⇒ no line, no bridge',()=>{
  const pricingFull=pricingCardsSsrHtml(FULL)!.plans;
  expect(pricingFull).not.toContain('plan-founding');
  const salesFull=injectSalesPlans(readWeb('sales.html'),false,FULL);
  expect(salesFull).not.toContain('plan-founding');
  const pricingQuiet=pricingCardsSsrHtml(UNAVAILABLE)!.plans;
  expect(pricingQuiet).toContain('class="plan-founding"'); // the static line stands
  expect(pricingQuiet).not.toContain('plan-founding-bridge'); // the bridge does not
  const salesQuiet=injectSalesPlans(readWeb('sales.html'),false,UNAVAILABLE);
  expect(salesQuiet).toContain('class="plan-founding"');
  expect(salesQuiet).not.toContain('plan-founding-bridge');
  const pricingNone=pricingCardsSsrHtml()!.plans;
  expect(pricingNone).not.toContain('plan-founding');
 });
});
