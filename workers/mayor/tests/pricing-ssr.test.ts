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
import {pricingCardsSsrHtml,injectPricingCards,salesPlansSsrHtml,injectSalesPlans,auditCardSsrHtml} from '../src/offer-block-ssr';
import {PLANS,CREDIT_PACKS} from '../src/billing/plans';
import {AUDIT_OFFER} from '../src/billing/audit';

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
  expect(rendered.plans).toContain('1,000 reply attempts');
  expect(rendered.plans).toContain('120 microphone minutes');
  expect(rendered.plans).toContain(`${free.replyLimit} reply attempts`);
  const small=CREDIT_PACKS[0];
  expect(rendered.packs).toContain('Small');
  expect(rendered.packs).toContain(`$${small.priceCents/100}`);
  expect(rendered.packs).toContain('reply attempts');
  // rot105: distinct Pro CTA built from the catalog price; Free keeps Start free.
  expect(rendered.plans).toContain(`Go Pro — $${pro.priceCents/100}/mo`);
  expect(rendered.plans).toContain('>Start free</a>');
  // rot105: every top-up card carries a Buy CTA.
  // rot120: each top-up CTA carries its pack — distinct label + destination.
  expect(rendered.packs.split('href="/billing?pack=').length-1).toBe(CREDIT_PACKS.length);
  for(const pack of CREDIT_PACKS){
    expect(rendered.packs).toContain(`href="/billing?pack=${pack.id}">Buy ${pack.name}</a>`);
  }
});

it('pricing page carries the credit expiry sentence and the attempts disclosure (rot105)',()=>{
  const page=readWeb('pricing.html');
  expect(page).toContain('Credits activate after verified payment and expire at the end of the purchased Free UTC calendar month or Pro paid period. They do not roll over or transfer when switching plans.');
  expect(page).toContain('Usage counts reply attempts');
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

it('/sales SSR renders priced plan cards from the live catalog (rot107, tiers rot109)',()=>{
  const rendered=salesPlansSsrHtml()!;
  const pro=PLANS.find(p=>p.id==='pro')!;
  expect(rendered).toContain('<h3>Free</h3>');
  expect(rendered).toContain('<h3>Pro</h3>');
  expect(rendered).toContain('Top up');
  expect(rendered).toContain(`$${pro.priceCents/100}`);
  expect(rendered).toContain(`Go Pro — $${pro.priceCents/100}/mo`);
  // rot109: every top-up price shows, all from the catalog.
  for(const pack of CREDIT_PACKS)expect(rendered).toContain(`$${pack.priceCents/100}`);
  // rot117: the full named mapping — name, price, and allowances per pack.
  for(const pack of CREDIT_PACKS){
    expect(rendered).toContain(`${pack.name} — $${pack.priceCents/100}`);
    expect(rendered).toContain(`+${pack.replyAttempts.toLocaleString('en-US')} reply attempts`);
    expect(rendered).toContain(`+${pack.voiceMinutes} microphone minutes`);
  }
  expect(rendered).toContain('1,000 reply attempts');
  expect(rendered).toContain('href="/pricing"');
  // rot116: chief's order — Free, then Pro directly above the Top-up card.
  const iFree=rendered.indexOf('<h3>Free</h3>'),iTop=rendered.indexOf('<h3>Top up</h3>'),iPro=rendered.indexOf('<h3>Pro</h3>');
  expect(iFree).toBeGreaterThanOrEqual(0);
  expect(iFree).toBeLessThan(iPro);
  expect(iPro).toBeLessThan(iTop);
});

it('injectSalesPlans fills the real /sales shell and is idempotent (rot107)',()=>{
  const shell=readWeb('sales.html');
  expect(shell).not.toMatch(/\$\d/); // source stays price-free
  const out=injectSalesPlans(shell);
  const pro=PLANS.find(p=>p.id==='pro')!;
  expect(out).toContain('data-ssr="catalog"');
  expect(out).toContain(`$${pro.priceCents/100}`);
  expect(out).toContain(`Go Pro — $${pro.priceCents/100}/mo`);
  expect(injectSalesPlans(out)).toBe(out);
  // Static paths to /pricing exist even without injection.
  expect(shell).toContain('href="/pricing"');
  // Providers are named where sending is discussed.
  expect(shell).toContain('Telnyx');
  expect(shell).toContain('Twilio');
});

it('audit offer card renders from AUDIT_OFFER and injects on /sales and /pricing (rot117)',()=>{
  const card=auditCardSsrHtml();
  expect(card).toContain(AUDIT_OFFER.name);
  expect(card).toContain(`$${AUDIT_OFFER.priceCents/100}`);
  expect(card).toContain('one-time');
  expect(card).toContain('30/60/90-day plan');
  expect(card).toContain('Purchases are final — no refunds.');
  expect(card).toContain('href="/business-audit"');
  const sales=injectSalesPlans(readWeb('sales.html'));
  expect(sales).toContain(`$${AUDIT_OFFER.priceCents/100}`);
  expect(sales).toContain(AUDIT_OFFER.name);
  const pricing=injectPricingCards(readWeb('pricing.html'));
  expect(pricing).toContain(`$${AUDIT_OFFER.priceCents/100}`);
  expect(pricing).toContain(AUDIT_OFFER.name);
  expect(pricing).toContain('href="/business-audit"');
});

it('/sales surfaces the pricing section before the money-loop walkthroughs (rot117)',()=>{
  const page=readWeb('sales.html');
  const plansAt=page.indexOf('id="plans"'),loopAt=page.indexOf('id="money-loop"');
  expect(plansAt).toBeGreaterThanOrEqual(0);
  expect(loopAt).toBeGreaterThan(plansAt);
  // The expiry sentence lives on /sales too (rot117, copied from /pricing).
  expect(page).toContain('Credits activate after verified payment and expire at the end of the purchased Free UTC calendar month or Pro paid period. They do not roll over or transfer when switching plans.');
});

const PROVIDER_LINE='your provider bills you directly for number rental, calls, and messages at its own rates';

it('provider charges are qualified at the pricing section on both selling pages (rot120)',()=>{
  expect(readWeb('sales.html')).toContain(PROVIDER_LINE);
  expect(readWeb('pricing.html')).toContain(PROVIDER_LINE);
});

it('/sales discloses the reply-attempt counting rule and the Twilio send path (rot120)',()=>{
  const page=readWeb('sales.html');
  expect(page).toContain('Usage counts reply attempts — every try counts toward your allowance, not only delivered replies.');
  expect(page).toContain('Twilio numbers connect for voice calls; automatic text-backs are sent through Telnyx.');
  // rot125: the Twilio limit also rides the pricing provider sentence, both pages.
  expect(page.split('Twilio numbers connect for voice calls').length-1).toBeGreaterThanOrEqual(2);
  expect(readWeb('pricing.html')).toContain('Twilio numbers connect for voice calls; automatic text-backs are sent through Telnyx.');
});

it('remaining /sales text-back claims carry the connected-number condition (rot125)',()=>{
  const page=readWeb('sales.html');
  expect(page).toContain('Once your business number is connected, every unanswered call gets an instant text-back');
  expect(page).toContain('an instant text-back from your connected business number');
  expect(page).toContain('missed-call text-backs once your number is connected');
  expect(page).not.toContain('Every unanswered call gets an instant text-back in your voice, with');
});

it('homepage footer links to /sales and /pricing (rot120)',()=>{
  const home=readWeb('index.html');
  expect(home).toContain('href="/sales"');
  expect(home).toContain('href="/pricing"');
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
