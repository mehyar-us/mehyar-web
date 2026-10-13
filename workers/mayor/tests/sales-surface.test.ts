/**
 * sales-surface.test.ts — the /sales page is a STATIC pitch section around
 * the login form. The page SOURCE carries zero hardcoded price claims: no
 * dollar amounts, no pack pricing, no catalog fetch. Since rot107
 * (2026-10-12) the plan-card prices render at SERVE time from the live
 * billing catalog (SSR injection, same pattern as /pricing), so a catalog
 * price change flows through with no page edit — that is why the source
 * must stay price-free. All copy is honest: examples labeled
 * illustrative, no invented revenue, no guaranteed results.
 */
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {readdirSync} from 'node:fs';

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

it('contains zero dollar amounts anywhere in the sales surface',()=>{
 for(const source of SALES_SOURCES){
  expect(source).not.toMatch(/\$\d/);
 }
});

it('contains no pricing language: no per-month, no pack pricing, no catalog fetch',()=>{
 const combined=SALES_SOURCES.join('\n');
 expect(combined).not.toContain('per month');
 expect(combined).not.toContain('$14');
 expect(combined).not.toContain('$39');
 expect(combined).not.toMatch(/credit pack/i);
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
 // No invented revenue and no guaranteed results.
 expect(html).not.toMatch(/\$\d/);
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

it('shows one clearly-labeled sample text-back thread in the real template wording (rot112)',()=>{
 expect(html).toContain('id="sample"');
 expect(html).toContain('Sample only — not a real customer conversation.');
 // The verbatim salon text-back + confirm templates (src/verticals.ts),
 // with the placeholder business name swapped in.
 expect(html).toContain('Hi, this is Glow Studio. Sorry we missed your call! Want to book an appointment? Reply YES and we will find you a time. Reply STOP to opt out.');
 expect(html).toContain('Thanks! We will text you shortly with available times.');
 expect(html).toContain('No booking or result is shown or promised.');
});

it('/terms states plainly how provider charges are billed (rot112)',()=>{
 const terms=readFileSync(join(webDir,'public','terms.html'),'utf8');
 expect(terms).toContain('MehyarSoft does not collect, add to, or mark up provider charges');
 expect(terms).toContain('they never appear on your Mayor bill');
});

it('hero text-back claim carries the connected-number condition (rot122)',()=>{
 expect(html).toContain('Once your business number is connected, it answers the calls you miss and texts back the leads you would lose, automatically through Telnyx');
 expect(html).not.toContain('It answers the calls you miss, texts back the leads you would lose');
});

it('carries the email capture form with its disclosure (rot136)',()=>{
 expect(html).toContain('<form class="lead-form" action="/api/leads" method="post">');
 expect(html).toContain('name="email" type="email" required');
 expect(html).toContain('We store your email only to send these updates, and we never sell it.');
});
