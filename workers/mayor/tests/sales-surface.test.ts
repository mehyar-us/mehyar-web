/**
 * sales-surface.test.ts — the /sales page is a STATIC pitch section around
 * the login form. PRICES ARE SHOWN, never hidden: the product-compliance
 * audit failed an earlier zero-amounts version for price concealment
 * ("No hidden fees" with zero dollar figures), so the plans section must
 * present the CURRENT catalog exactly as src/billing/plans.ts defines it
 * (the billing source of truth). A future price change lands in plans.ts
 * and this page together — never on the page alone. All other copy stays
 * honest: examples labeled illustrative, no invented revenue, no
 * guaranteed results.
 */
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {readdirSync} from 'node:fs';
import {PLANS,CREDIT_PACKS} from '../src/billing/plans';

const here=dirname(fileURLToPath(import.meta.url));
const webDir=join(here,'..','web');
function salesSource(name:string):string{
 return readFileSync(join(webDir,name),'utf8');
}
const SALES_SOURCES=['sales.html','sales.css'].map(salesSource);
const html=salesSource('sales.html');

it('ships with no JavaScript: sales.ts and sales-pricing.ts are gone, no script tag in the page',()=>{
 const webFiles=readdirSync(webDir);
 expect(webFiles).not.toContain('sales.ts');
 expect(webFiles).not.toContain('sales-pricing.ts');
 // The only script allowed is the consent-gated analytics snippet (wired
 // synchronously in <head> per the privacy order) — no product JS.
 const scripts=[...html.matchAll(/<script\b[^>]*>/g)].map(m=>m[0]);
 expect(scripts).toEqual(['<script src="/analytics-consent.js">']);
});

// Expected figures derive from src/billing/plans.ts — the billing source
// of truth — so a catalog change that forgets this page fails here.
const CATALOG_DOLLARS=[...new Set([...PLANS,...CREDIT_PACKS].map(p=>p.priceCents/100))].sort((a,b)=>a-b);
function dollarAmounts(source:string):number[]{
 return [...new Set([...source.matchAll(/\$(\d+)/g)].map(m=>Number(m[1])))].sort((a,b)=>a-b);
}

it('presents the current catalog prices from plans.ts — prices are shown, not hidden',()=>{
 const free=PLANS.find(p=>p.id==='free')!;
 const pro=PLANS.find(p=>p.id==='pro')!;
 expect(html).toContain(`$${free.priceCents/100} — free to start`);
 expect(html).toContain(`$${pro.priceCents/100}/month`);
 for(const pack of CREDIT_PACKS)expect(html).toContain(`${pack.name} $${pack.priceCents/100}`);
 // The ONLY dollar amounts anywhere on the sales surface are the catalog
 // amounts: nothing missing (concealment) and nothing extra (no invented
 // or future prices — e.g. no $39 until new Stripe Price IDs land).
 expect(dollarAmounts(SALES_SOURCES.join('\n'))).toEqual(CATALOG_DOLLARS);
 // Provider-billing disclosure sits with the pricing, not buried.
 expect(html).toContain('Text-back runs on your own Twilio/Telnyx number — provider charges are billed by them, not us.');
});

it('states pricing terms openly, fetches no catalog, and leaks no future price',()=>{
 const combined=SALES_SOURCES.join('\n');
 const pro=PLANS.find(p=>p.id==='pro')!;
 // The Pro period is stated in plain words right next to its price.
 expect(html).toContain(`$${pro.priceCents/100}/month`);
 expect(html).toContain('No hidden fees');
 // $39 is the planned Phase-3 Pro price: it must not appear until the
 // owner supplies new Stripe Price IDs and plans.ts changes with it.
 expect(combined).not.toContain('$39');
 // Static page: prices are written into the HTML, never fetched live.
 expect(combined).not.toContain('/api/billing/catalog');
 expect(combined).not.toMatch(/pricing-section|price-card|price-amount/);
 expect(html).not.toContain('id="pricing"');
});

it('shows all 7 vertical money-loop examples, each labeled illustrative',()=>{
 const cards=html.match(/class="loop-card"/g)??[];
 expect(cards).toHaveLength(7);
 const labels=html.match(/Illustrative — results vary/g)??[];
 expect(labels).toHaveLength(7);
 for(const trade of ['Hair salon / Barbershop','Restaurant','Plumbing / HVAC','Dental office','Auto repair','Pet grooming salon','Med spa']){
  expect(html).toContain(trade);
 }
 // No invented revenue and no guaranteed results: the EXAMPLES carry no
 // amounts — prices live only in the plans section below them.
 const moneyLoop=html.slice(html.indexOf('id="money-loop"'),html.indexOf('id="plans"'));
 expect(moneyLoop).not.toMatch(/\$\d/);
 expect(html).toContain('not a customer story');
 expect(html).toContain('Results vary');
 expect(html).toContain('nothing here promises revenue');
});

it('carries the vision pitch and never names the product Jarvis',()=>{
 expect(html).toContain('The Mayor talks to you, the business owner.');
 expect(html).toContain('Your AI chief of staff, in your language, running the place with you.');
 const standalone=html.match(/Jarvis(?!-like)/g)??[];
 expect(standalone).toEqual([]);
});

it('carries the legal footer with purchases-final and no street address',()=>{
 expect(html).toContain('MehyarSoft LLC');
 expect(html).toContain('href="/terms"');
 expect(html).toContain('https://mehyar.us/privacy-policy/');
 expect(html).toContain('https://mehyar.us/terms/');
 expect(html).toContain('https://mehyar.us/data-deletion/');
 expect(html).toContain('Purchases are final');
 expect(html).toContain('mailto:info@mehyar.us');
 expect(html).not.toContain('96th St');
 expect(html).not.toContain('11209');
});

it('links the Sign in / Start free CTAs to the login surface',()=>{
 expect(html).toContain('>Sign in</a>');
 expect(html).toContain('>Start free</a>');
 const ctaHrefs=[...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>(?:Sign in|Start free)<\/a>/g)].map(m=>m[1]);
 expect(ctaHrefs.length).toBeGreaterThanOrEqual(4);
 for(const href of ctaHrefs)expect(href).toBe('/');
});
