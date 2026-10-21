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
import {pricingCardsSsrHtml,injectPricingCards,salesPlansSsrHtml,injectSalesPlans,auditCardSsrHtml,offerBlockSsrHtml,injectHeroPrice,heroPriceSsrText} from '../src/offer-block-ssr';
import {heroPriceText} from '../web/offer-block';
import {PLANS,CREDIT_PACKS,approxConversations,REPLIES_PER_CONVERSATION} from '../src/billing/plans';
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
  // rot127: review wording matches the Terms phrase ("separate AI review").
  expect(card).toContain('separate AI review');
  expect(card).not.toContain('independently reviewed');
  // Scope ruling (2026-10-17): the cross-sell card carries no final-sale
  // line; the line lives on the /business-audit checkout itself.
  expect(card).not.toContain('Purchases are final');
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

it('Pro takes the direct billing path on both pricing surfaces (rot139)',()=>{
  expect(pricingCardsSsrHtml()!.plans).toContain('href="/billing?plan=pro">Go Pro');
  expect(injectSalesPlans(readWeb('sales.html'))).toContain('href="/billing?plan=pro">Go Pro');
  // Free still starts at the app root.
  expect(pricingCardsSsrHtml()!.plans).toContain('href="/?start=1">Start free');
});

it('/sales surfaces the email capture right after pricing (rot139)',()=>{
  const page=readWeb('sales.html');
  const plansAt=page.indexOf('id="plans"'),updatesAt=page.indexOf('id="updates"'),loopAt=page.indexOf('id="money-loop"');
  expect(updatesAt).toBeGreaterThan(plansAt);
  expect(loopAt).toBeGreaterThan(updatesAt);
});

it('rot146 garnish: card SMS split, surfaced counting rule, pack expiry, cancel qualifier, second capture',()=>{
  const sales=readWeb('sales.html'),pricing=readWeb('pricing.html');
  // Plan cards state the Telnyx-only send split.
  expect(sales).toContain('missed-call text-backs once your number is connected (automatic text-backs send through Telnyx)');
  expect(injectSalesPlans(sales)).toContain('(automatic text-backs send through Telnyx)');
  // Counting rule promoted out of small print on both pages, once each.
  expect(sales).toContain('<p class="decision-note">Usage counts reply attempts');
  expect(pricing).toContain('<p class="decision-note">Usage counts reply attempts');
  expect(sales.split('Usage counts reply attempts').length-1).toBe(1);
  // Expiry caution at the top-up buy buttons.
  const rendered=pricingCardsSsrHtml();
  expect(rendered!.packs.split('Credits expire at the end of the purchased period').length-1).toBe(CREDIT_PACKS.length);
  // Cancel qualifier aligned on both pages.
  expect(sales).toContain('Cancel anytime — cancelling stops renewal, and your plan runs to the end of the paid period.');
  expect(pricing).toContain('Cancel anytime — cancelling stops renewal, and your plan runs to the end of the paid period.');
  // Strengthened exchange + a second capture after the money loop.
  expect(sales).toContain('one practical email a month');
  expect(sales.split('action="/api/leads"').length-1).toBe(2);
  expect(sales).toContain('value="sales-loop"');
  expect(sales.indexOf('id="updates-loop"')).toBeGreaterThan(sales.indexOf('id="money-loop"'));
});

it('structured data: Product JSON-LD injected from the catalog; Organization on home (rot130)',()=>{
  for(const page of ['sales.html','pricing.html']){
    const out=page==='sales.html'?injectSalesPlans(readWeb(page)):injectPricingCards(readWeb(page));
    const m=out.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const data=JSON.parse(m![1]);
    expect(data['@type']).toBe('Product');
    const prices=(data.offers as {price:number}[]).map(o=>o.price);
    for(const p of [...PLANS,...CREDIT_PACKS])expect(prices).toContain(p.priceCents/100);
    expect(prices).toContain(AUDIT_OFFER.priceCents/100);
  }
  const home=readWeb('index.html');
  expect(home).toContain('"@type":"Organization"');
  expect(home).toContain('MehyarSoft LLC');
});

it('/terms carries viewport-fit like the other pages (rot130)',()=>{
  expect(readWeb('public/terms.html')).toContain('viewport-fit=cover');
});

it('one audit name everywhere it is named (rot133)',()=>{
  // Canonical: AUDIT_OFFER.name — the cards, the audit page title, and the
  // Terms heading all carry the same proper name.
  expect(readWeb('business-audit.html')).toContain(`<title>${AUDIT_OFFER.name} · $330 once · Mehyar US</title>`);
  expect(readWeb('public/terms.html')).toContain('<h2>The extensive business audit</h2>');
  expect(readWeb('public/terms.html')).not.toContain('<h2>The $330 business audit</h2>');
});

it('/sales claim and provider qualification read as one note (rot130)',()=>{
  const page=readWeb('sales.html');
  expect(page).toContain('No hidden fees. The price of your Mayor plan is what you pay us');
  const claimAt=page.indexOf('No hidden fees. The price of your Mayor plan');
  const qualAt=page.indexOf(PROVIDER_LINE);
  expect(claimAt).toBeGreaterThanOrEqual(0);
  expect(qualAt).toBeGreaterThan(claimAt);
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
    expect(html,`${f} no-refunds`).not.toContain('Purchases are final'); // scope ruling 2026-10-17
  }
  const index=readWeb('index.html');
  expect(index).toContain('The Mayor · MehyarSoft LLC');
});

it('rot149: Telnyx line on the Pro card itself + attempts translated to conversations everywhere',()=>{
 const sales=readWeb('sales.html'),pricing=readWeb('pricing.html'),terms=readWeb('public/terms.html');
 const rendered=pricingCardsSsrHtml(),salesServed=injectSalesPlans(sales);
 // 1. The Pro card carries the Telnyx-only line on both selling pages.
 expect(salesServed).toContain('Automatic text-backs are sent through Telnyx once your number is connected. Twilio numbers connect for voice calls. No hidden fees');
 expect(sales).toContain('Automatic text-backs are sent through Telnyx once your number is connected. Twilio numbers connect for voice calls. No hidden fees');
 expect(rendered!.plans).toContain('watching your book. Automatic text-backs are sent through Telnyx once your number is connected. Twilio numbers connect for voice calls.');
 expect(pricing).toContain('watching your book. Automatic text-backs are sent through Telnyx once your number is connected. Twilio numbers connect for voice calls.');
 // 2. Conversation equivalents derive from the catalog numbers themselves.
 expect(REPLIES_PER_CONVERSATION).toBe(10);
 for(const p of PLANS){expect(salesServed).toContain(`(\u2248${approxConversations(p.replyLimit)} real conversations a month)`);expect(rendered!.plans).toContain(`(\u2248${approxConversations(p.replyLimit)} real conversations a month)`);}
 for(const pk of CREDIT_PACKS){expect(rendered!.packs).toContain(`(\u2248${approxConversations(pk.replyAttempts)} real conversations)`);expect(salesServed).toContain(`(\u2248${approxConversations(pk.replyAttempts)} real conversations)`);}
 // Basis printed where buyers decide, and the equivalence reaches /terms.
 expect(sales).toContain('Conversation estimates figure roughly 10 replies per conversation.');
 expect(pricing).toContain('Conversation estimates figure roughly 10 replies per conversation.');
 expect(terms).toContain('100 assistant reply attempts (about 10 conversations, figuring roughly 10 replies per conversation)');
 expect(terms).toContain('1,000 reply attempts (about 100 conversations)');
 expect(terms).toContain('Pro costs $99 USD per month');
 expect(terms).toContain('lock $79.20 USD per month for life');
 expect(terms).not.toContain('$14');
 expect(terms).toContain('800 reply attempts (about 80 conversations)');
});

it('rot152: counting notes reach the homepage offer block + mic-minutes counting beside the figures',()=>{
 const mic='Microphone minutes count from the moment the mic opens \u2014 startup and silence included.';
 expect(offerBlockSsrHtml()).toContain('Usage counts reply attempts \u2014 every try counts toward your allowance, not only delivered replies.');
 expect(offerBlockSsrHtml()).toContain(mic);
 expect(readWeb('sales.html')).toContain(mic);
 expect(readWeb('pricing.html')).toContain(mic);
});

it('rot156: slogan on all three heroes + homepage hero price anchor from the catalog',()=>{
 const pro=PLANS.find(p=>p.id==='pro')!;
 for(const f of ['sales.html','pricing.html'])expect(readWeb(f)).toContain('<p class="hero-slogan">Mayor. Talk to your business.</p>');
 const home=readWeb('index.html');
 expect(home).toContain('<p class="hero-price" id="hero-price"></p>'); // ships empty; SSR fills it
 // rot173: the anchor is a direct #chat-view child, NOT inside .page-heading
 // (heading-scoped CSS in the chat layout can clip it there).
 // Chat reenvision Slice 1 (2026-10-21): .page-heading and .voice-stage are
 // deleted from the chat view — the presence bar replaces them and the
 // slogan leaves the in-product surface (it stays on the /sales + /pricing
 // heroes and in the homepage <title>). The anchor now sits directly
 // before the ChatApp mount.
 expect(home).toContain('<p class="hero-price" id="hero-price"></p><div id="chat-app">');
 const filled=injectHeroPrice(home);
 expect(filled).toContain(`<p class="hero-price" id="hero-price"><a href="/?start=1">Start free</a> \u00b7 Pro $${pro.priceCents/100}/mo</p>`);
 // Client fallback derives the identical string from a fetched catalog.
 const catalog={currency:'USD',plans:PLANS.map(p=>({id:p.id,name:p.name,priceCents:p.priceCents,interval:'month',replyLimit:p.replyLimit,voiceMinuteLimit:p.voiceMinuteLimit}))};
 expect(heroPriceText(catalog)).toBe(heroPriceSsrText());
 expect(heroPriceText(null)).toBeNull();
});

it('rot157: /sales hero carries the same catalog-rendered price anchor',()=>{
 const pro=PLANS.find(p=>p.id==='pro')!;
 const sales=readWeb('sales.html');
 expect(sales).toContain('<p class="hero-price" id="hero-price"></p>');
 const served=injectHeroPrice(injectSalesPlans(sales));
 const heroAt=served.indexOf('class="hero page-width"'),priceAt=served.indexOf('id="hero-price"'),loopAt=served.indexOf('id="how"');
 expect(served).toContain(`<p class="hero-price" id="hero-price"><a href="/?start=1">Start free</a> \u00b7 Pro $${pro.priceCents/100}/mo</p>`);
 expect(priceAt).toBeGreaterThan(heroAt);
 expect(loopAt).toBeGreaterThan(priceAt); // inside the hero block, above the fold sections
});

it('rot174: /pricing carries the full social meta set, front-desk aligned',()=>{
 const pricing=readWeb('pricing.html');
 expect(pricing).toContain('<meta property="og:title" content="The Mayor · Your AI Front Desk for Local Business">');
 expect(pricing).toContain('<meta property="og:description" content="The Mayor pricing: start free');
 expect(pricing).toContain('<meta property="og:url" content="https://mayor.mehyar.us/pricing">');
 expect(pricing).toContain('<meta name="twitter:title" content="The Mayor · Your AI Front Desk for Local Business">');
 expect(pricing).toContain('<meta name="twitter:card" content="summary_large_image">');
});

it('rot165: /pricing hero carries the same catalog-rendered price anchor',()=>{
 const pro=PLANS.find(p=>p.id==='pro')!;
 const pricing=readWeb('pricing.html');
 expect(pricing).toContain('<p class="hero-price" id="hero-price"></p>');
 const served=injectHeroPrice(injectPricingCards(pricing));
 expect(served).toContain(`<p class="hero-price" id="hero-price"><a href="/?start=1">Start free</a> \u00b7 Pro $${pro.priceCents/100}/mo</p>`);
 const heroAt=served.indexOf('id="pricing-heading"'),priceAt=served.indexOf('id="hero-price"'),plansAt=served.indexOf('id="plan-cards"');
 expect(priceAt).toBeGreaterThan(heroAt);
 expect(plansAt).toBeGreaterThan(priceAt); // inside the hero, before the plan cards
});
