/**
 * sales-surface.test.ts — the /sales page is a STATIC pitch section around
 * the login form. Until the owner makes the $14-vs-$39 call, the page must
 * carry ZERO price claims anywhere: no dollar amounts, no "per month", no
 * pack pricing, no catalog fetch. All copy is honest: examples labeled
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
 expect(html).not.toContain('<script');
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
