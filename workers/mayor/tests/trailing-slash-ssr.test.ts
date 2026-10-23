/**
 * trailing-slash-ssr.test.ts — chief follow-up (2026-10-10):
 *
 * 1. Trailing-slash normalization: /terms/, /pricing/, /api/billing/catalog/
 *    etc. route exactly like their bare forms (normalizePathname, applied once
 *    at the worker's fetch entry).
 * 2. /data-deletion redirect is wired (route constant asserted here; the live
 *    301 is verified post-deploy).
 * 3. Server-rendered pricing on /: offerBlockSsrHtml() renders the live PLANS
 *    catalog with NO hardcoded amounts, and injectOfferBlock() swaps it into
 *    #offer-block marked data-ssr="catalog" (which the client hydration
 *    skips — see web/offer-block.ts).
 */
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {normalizePathname,isPublicAssetPath,isSalesVerticalPath} from '../src/public-routes';
import {offerBlockSsrHtml,injectOfferBlock} from '../src/offer-block-ssr';
import {PLANS} from '../src/billing/plans';

const here=dirname(fileURLToPath(import.meta.url));
const srcDir=join(here,'..','src');

it('normalizePathname strips one trailing slash, keeps root and bare paths',()=>{
  expect(normalizePathname('/terms/')).toBe('/terms');
  expect(normalizePathname('/pricing/')).toBe('/pricing');
  expect(normalizePathname('/api/billing/catalog/')).toBe('/api/billing/catalog');
  expect(normalizePathname('/sales/salon/')).toBe('/sales/salon');
  expect(normalizePathname('/')).toBe('/');
  expect(normalizePathname('/terms')).toBe('/terms');
  expect(normalizePathname('/api/health')).toBe('/api/health');
  expect(normalizePathname('')).toBe('');
});

it('every public route resolves after normalization (no trailing-slash 404s)',()=>{
  for(const raw of ['/terms/','/pricing/','/sales/','/sales/salon/','/privacy/','/login/','/signup/','/data-deletion/','/robots.txt']){
    const clean=normalizePathname(raw);
    const known=isPublicAssetPath(clean)||isSalesVerticalPath(clean)
      ||['/business-audit','/business-audit/report','/sales','/pricing','/login','/signup','/privacy','/data-deletion','/'].includes(clean);
    expect(known,`normalized ${raw} -> ${clean} must be a known route`).toBe(true);
  }
});

it('unknown paths still 404 after normalization (never the app shell)',()=>{
  expect(normalizePathname('/nope-404-test/')).toBe('/nope-404-test');
  expect(isPublicAssetPath('/nope-404-test')).toBe(false);
  expect(isSalesVerticalPath('/nope-404-test')).toBe(false);
});

it('SSR pricing renders the live PLANS catalog (no hardcoded amounts)',()=>{
  const html=offerBlockSsrHtml()!;
  const pro=PLANS.find(p=>p.id==='pro')!;
  expect(html).toContain('Pro');
  expect(html).toContain('Free');
  // Whatever the catalog serves today must appear — currently $14.
  expect(html).toContain(`$${pro.priceCents/100}`);
  expect(html).not.toContain('Purchases are final'); // scope ruling 2026-10-17
  expect(html).toContain('offer-plans');
});

it('src/offer-block-ssr.ts contains no hardcoded dollar amount',()=>{
  const source=readFileSync(join(srcDir,'offer-block-ssr.ts'),'utf8');
  expect(source).not.toMatch(/\$\d/);
  expect(source).not.toContain('1400');
  expect(source).not.toContain('3900');
});

it('injectOfferBlock swaps the fallback for catalog pricing and marks data-ssr',()=>{
  const page=`<html><body><div id="offer-block" class="offer-block" aria-label="Plans"><p class="offer-fallback">Start free — sign in.</p></div></body></html>`;
  const out=injectOfferBlock(page);
  expect(out).toContain('data-ssr="catalog"');
  expect(out).toContain('offer-plans');
  expect(out).not.toContain('offer-fallback');
  // Idempotent: a second pass changes nothing (client hydration also skips).
  expect(injectOfferBlock(out)).toBe(out);
});

it('injectOfferBlock leaves HTML untouched when it cannot safely inject',()=>{
  const noBlock='<html><body><p>hello</p></body></html>';
  expect(injectOfferBlock(noBlock)).toBe(noBlock);
  const nested='<div id="offer-block"><div class="x">y</div></div>';
  expect(injectOfferBlock(nested)).toBe(nested);
});

it('index.ts wires the /data-deletion redirect to the shared legal page',()=>{
  const source=readFileSync(join(srcDir,'index.ts'),'utf8');
  expect(source).toContain(`url.pathname==='/data-deletion'`);
  expect(source).toContain('https://mehyar.us/data-deletion/');
  expect(source).toContain('301');
});

it('index.ts wires the /audit redirect to the hub audit (post-deploy pass item 2, 2026-10-22)',()=>{
  const source=readFileSync(join(srcDir,'index.ts'),'utf8');
  expect(source).toContain(`url.pathname==='/audit'`);
  expect(source).toContain('https://mehyar.us/audit/');
});

it('index.ts normalizes the trailing slash once at the fetch entry',()=>{
  const source=readFileSync(join(srcDir,'index.ts'),'utf8');
  expect(source).toContain('normalizePathname(');
  // No per-route trailing-slash variants remain in the explicit handlers
  // (the startsWith('/sales/') prefix check for vertical routes is intentional).
  expect(source).not.toMatch(/'\/business-audit\/'/);
  expect(source).not.toMatch(/'\/pricing\/'/);
  expect(source).not.toMatch(/'\/login\/'/);
  expect(source).not.toMatch(/'\/privacy\/'/);
  expect(source).not.toMatch(/\['\/sales',?'\/sales\/'\]/);
});
