/**
 * sales-v2.test.ts — the public sales surface v2.
 *
 * 1. /sales pricing section: talks about pricing with ZERO amounts
 *    (no $14, no $39, no "per month", no dollar digits anywhere).
 * 2. Seven vertical routes generated from verticals.ts (single source of
 *    truth): each page carries the vertical's label, vocabulary, and KPIs,
 *    an illustrative money-loop example, and a sign-in CTA. No price claims.
 * 3. robots.txt + sitemap.xml + favicon.ico + clean 404 page.
 * 4. isPublicAssetPath / isSalesVerticalPath unit tests (worker 404 logic).
 */
import {expect,it,beforeAll} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {VERTICAL_PROFILES} from '../src/verticals';
import {generateVerticalPages,VERTICAL_SLUGS} from '../scripts/gen-sales-verticals.mjs';
import {isPublicAssetPath,isSalesVerticalPath,SALES_VERTICAL_SLUGS} from '../src/public-routes';
import {NOT_FOUND_HTML} from '../src/not-found-page';

const here=dirname(fileURLToPath(import.meta.url));
const webDir=join(here,'..','web');
const publicDir=join(webDir,'public');
const salesDir=join(webDir,'sales');
const readWeb=(...parts:string[])=>readFileSync(join(webDir,...parts),'utf8');
const readPublic=(...parts:string[])=>readFileSync(join(publicDir,...parts),'utf8');

beforeAll(()=>{
  // The generator is the build step; running it here keeps the test honest
  // about the single-source-of-truth contract even without a full build.
  generateVerticalPages();
});

const html=()=>readWeb('sales.html');
const css=()=>readWeb('sales.css');

it('pricing section exists on /sales with zero amounts',()=>{
  const page=html(),style=css();
  expect(page).toContain('id="plans"');
  expect(page).toContain('Start free. Grow when you');
  for(const tier of ['Start','Grow','Top up'])expect(page).toContain(`<h3>${tier}</h3>`);
  expect(page).toContain('No credit card to start');
  expect(page).toContain('No hidden fees');
  expect(page).toContain('Cancel anytime');
  for(const source of [page,style]){
    expect(source).not.toMatch(/\$\d/);
    expect(source).not.toContain('per month');
    expect(source).not.toContain('$14');
    expect(source).not.toContain('$39');
  }
  // Forbidden pricing-widget naming from the strip-down contract.
  expect(page).not.toMatch(/pricing-section|price-card|price-amount/);
  expect(page).not.toContain('id="pricing"');
  expect(page).not.toMatch(/credit pack/i);
});

it('generates one page per vertical from verticals.ts (single source of truth)',()=>{
  const slugs=Object.values(VERTICAL_SLUGS);
  expect(slugs).toHaveLength(7);
  expect([...SALES_VERTICAL_SLUGS].sort()).toEqual([...slugs].sort());
  for(const [vertical,slug] of Object.entries(VERTICAL_SLUGS)){
    const profile=(VERTICAL_PROFILES as Record<string,typeof VERTICAL_PROFILES.salon>)[vertical];
    expect(profile,`profile for ${vertical}`).toBeTruthy();
    const path=join(salesDir,`${slug}.html`);
    expect(existsSync(path),`${slug}.html generated`).toBe(true);
    const page=readFileSync(path,'utf8');
    // Label, vocabulary, and every KPI come from the profile — not copied.
    expect(page).toContain(profile.label);
    for(const word of Object.values(profile.vocabulary))expect(page).toContain(word);
    for(const kpi of profile.kpis??[]){
      expect(page).toContain(kpi.label);
      expect(page).toContain(kpi.hint);
    }
    // Honest framing: illustrative example, no revenue promises, no amounts.
    expect(page).toContain('Illustrative — results vary');
    expect(page).toContain('not a customer story');
    expect(page).toContain('nothing here promises revenue');
    expect(page).not.toMatch(/\$\d/);
    expect(page).not.toContain('<script');
    // SEO + CTA plumbing.
    expect(page).toContain(`<link rel="canonical" href="https://mayor.mehyar.us/sales/${slug}">`);
    expect(page).toContain('href="/sales#plans"');
    const ctas=[...page.matchAll(/<a[^>]*href="([^"]*)"[^>]*>(?:Sign in|Start free)<\/a>/g)].map(m=>m[1]);
    expect(ctas.length).toBeGreaterThanOrEqual(4);
    for(const href of ctas)expect(href).toBe('/');
    // Shared legal footer, no street address.
    expect(page).toContain('MehyarSoft LLC');
    expect(page).toContain('https://mehyar.us/privacy-policy/');
    expect(page).toContain('Purchases are final');
    expect(page).not.toContain('96th St');
  }
});

it('vertical slugs match the worker route contract',()=>{
  for(const slug of SALES_VERTICAL_SLUGS){
    expect(isSalesVerticalPath(`/sales/${slug}`)).toBe(true);
    expect(isSalesVerticalPath(`/sales/${slug}/`)).toBe(true);
  }
  expect(isSalesVerticalPath('/sales/saloon')).toBe(false);
  expect(isSalesVerticalPath('/sales')).toBe(false);
});

it('ships robots.txt and sitemap.xml covering the public surface',()=>{
  const robots=readPublic('robots.txt');
  expect(robots).toContain('Sitemap: https://mayor.mehyar.us/sitemap.xml');
  expect(robots).toContain('Disallow: /api/');
  const sitemap=readPublic('sitemap.xml');
  for(const loc of ['https://mayor.mehyar.us/','https://mayor.mehyar.us/sales','https://mayor.mehyar.us/business-audit']){
    expect(sitemap).toContain(`<loc>${loc}</loc>`);
  }
  for(const slug of Object.values(VERTICAL_SLUGS)){
    expect(sitemap).toContain(`<loc>https://mayor.mehyar.us/sales/${slug}</loc>`);
  }
  expect(sitemap).not.toContain('/business-audit/report');
});

it('ships a real favicon.ico and a clean 404 page',()=>{
  const icoPath=join(publicDir,'favicon.ico');
  expect(existsSync(icoPath)).toBe(true);
  const magic=readFileSync(icoPath).subarray(0,4);
  expect([...magic]).toEqual([0,0,1,0]); // ICO magic bytes
  const notFound=readPublic('404.html');
  expect(notFound).toContain('That page isn\'t on the books.');
  expect(notFound).toContain('href="/sales"');
  expect(notFound).not.toContain('<script');
  expect(notFound).not.toMatch(/\$\d/);
  // The worker serves the 404 inline (asset-server .html redirects empty
  // subrequest bodies) — the inline copy must match the file byte-for-byte.
  expect(NOT_FOUND_HTML).toBe(notFound);
});

it('isPublicAssetPath allows the public surface and nothing else',()=>{
  for(const ok of ['/','/index.html','/terms','/terms.html','/robots.txt','/sitemap.xml','/favicon.ico','/sw.js','/manifest.webmanifest','/microphone-worklet.js','/icon-192.png','/mayor-avatar.png','/device-check','/404.html','/assets/sales-abc123.css']){
    expect(isPublicAssetPath(ok),ok).toBe(true);
  }
  for(const bad of ['/nope','/sales/saloon','/admin','/api/billing/catalog','.env','/sales/../etc']){
    expect(isPublicAssetPath(bad),bad).toBe(false);
  }
});
