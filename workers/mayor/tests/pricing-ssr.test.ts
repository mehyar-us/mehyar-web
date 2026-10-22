/**
 * pricing-ssr.test.ts — chief order (2026-10-11):
 *
 * 1. /sales hero carries the provider-setup qualifier up top (not just under
 *    the money-loop).
 * 2. /pricing plan cards are server-rendered from the live catalog
 *    (pricingCardsSsrHtml + injectPricingCards), with NO hardcoded amounts —
 *    mirroring the home-page offer-slot pattern.
 * 3. Footer branding is consistent: "The Mayor" + "MehyarSoft LLC" on the
 *    marketing pages.
 */
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {pricingCardsSsrHtml,injectPricingCards} from '../src/offer-block-ssr';
import {PLANS,CREDIT_PACKS} from '../src/billing/plans';

const here=dirname(fileURLToPath(import.meta.url));
const webDir=join(here,'..','web');
const srcDir=join(here,'..','src');
const readWeb=(f:string)=>readFileSync(join(webDir,f),'utf8');

const PRICING_SHELL=`<div id="plan-cards" class="plan-grid" aria-live="polite">`+
  `<p class="plans-note">Loading plans…</p></div>`+
  `<div id="topup-cards" class="plan-grid" aria-live="polite">`+
  `<p class="plans-note">Loading top-ups…</p></div>`;

it('/sales hero carries the provider-setup qualifier',()=>{
  const html=readWeb('sales.html');
  const heroEnd=html.indexOf('id="how"');
  const hero=html.slice(0,heroEnd);
  expect(hero).toContain('Text-back works once you connect your business number');
});

it('pricing SSR renders plan cards from the live catalog (no hardcoded amounts)',()=>{
  const rendered=pricingCardsSsrHtml()!;
  const pro=PLANS.find(p=>p.id==='pro')!;
  const free=PLANS.find(p=>p.id==='free')!;
  expect(rendered.plans).toContain('Pro');
  expect(rendered.plans).toContain('Free');
  expect(rendered.plans).toContain(`$${pro.priceCents/100}`);
  expect(rendered.plans).toContain('1,000 assistant replies');
  expect(rendered.plans).toContain('120 microphone minutes');
  expect(rendered.plans).toContain(`${free.replyLimit} assistant replies`);
  const small=CREDIT_PACKS[0];
  expect(rendered.packs).toContain('Small');
  expect(rendered.packs).toContain(`$${small.priceCents/100}`);
  expect(rendered.packs).toContain('reply attempts');
});

it('injectPricingCards marks containers data-ssr="catalog" and replaces loading notes',()=>{
  const out=injectPricingCards(PRICING_SHELL);
  expect(out).toContain('data-ssr="catalog"');
  expect(out).not.toContain('Loading plans…');
  expect(out).not.toContain('Loading top-ups…');
  expect(out).toContain('plan-card');
});

it('injectPricingCards leaves HTML unchanged when containers are missing',()=>{
  const html='<html><body><p>no cards here</p></body></html>';
  expect(injectPricingCards(html)).toBe(html);
});

it('injectPricingCards is idempotent (never double-injects)',()=>{
  const once=injectPricingCards(PRICING_SHELL);
  expect(injectPricingCards(once)).toBe(once);
});

it('src/offer-block-ssr.ts contains no hardcoded dollar amount',()=>{
  const source=readFileSync(join(srcDir,'offer-block-ssr.ts'),'utf8');
  expect(source).not.toMatch(/\$\d/);
});

it('pricing client skips its fetch when SSR marker is present',()=>{
  const html=readWeb('pricing.html');
  expect(html).toContain(`dataset.ssr==='catalog'`);
});

it('footers share one canonical brand set',()=>{
  for(const f of ['sales.html','pricing.html']){
    const html=readWeb(f);
    expect(html,`${f} brand`).toContain('The Mayor');
    expect(html,`${f} company`).toMatch(/MEHYARSOFT LLC|MehyarSoft LLC/);
    expect(html,`${f} no-refunds`).toContain('Purchases are final');
  }
  const index=readWeb('index.html');
  expect(index).toContain('The Mayor · MehyarSoft LLC');
});
