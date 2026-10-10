/**
 * routes-manifest.test.ts — public routes + PWA manifest.
 *
 * 1. /pricing: static page, plan NAMES and structure render from
 *    GET /api/billing/catalog at render time, ZERO amounts anywhere
 *    (no $14, no $39, no "per month" with an amount, no dollar digits).
 *    A clearly-marked #offer-slot stays empty until the owner prices the offer.
 *    No-refunds line + shared mehyar.us legal links required.
 * 2. /login and /signup: 301 redirect to / (auth lives there), never a 404.
 * 3. /privacy: 301 redirect to https://mehyar.us/privacy-policy/ (scope rule).
 * 4. /manifest.json: valid JSON, name "The Mayor", short_name "Mayor",
 *    start_url "/", display "standalone", navy theme colors, real 192/512 icons.
 */
import {expect,it} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {isPublicAssetPath} from '../src/public-routes';

const here=dirname(fileURLToPath(import.meta.url));
const webDir=join(here,'..','web');
const publicDir=join(webDir,'public');
const readWeb=(...parts:string[])=>readFileSync(join(webDir,...parts),'utf8');
const readPublic=(...parts:string[])=>readFileSync(join(publicDir,...parts),'utf8');

const pricing=()=>readWeb('pricing.html');
const manifest=()=>JSON.parse(readPublic('manifest.json'));

it('pricing page exists with zero price amounts',()=>{
  const page=pricing();
  expect(page).toContain('Start free. Grow when you');
  // No dollar amounts anywhere: no $14, no $39, no $NNN.
  expect(page).not.toMatch(/\$\d/);
  // No "per month" attached to an amount.
  expect(page).not.toMatch(/\$\d[\s\S]{0,40}per month/i);
});

it('pricing page reads plan names/structure from the catalog at render time',()=>{
  const page=pricing();
  expect(page).toContain('/api/billing/catalog');
  expect(page).toContain('id="plan-cards"');
  expect(page).toContain('id="topup-cards"');
  // priceCents is deliberately never rendered.
  expect(page).not.toContain('priceCents');
});

it('pricing page carries the clearly-marked offer slot (empty until priced)',()=>{
  const page=pricing();
  expect(page).toContain('id="offer-slot"');
  expect(page).toContain('OFFER SLOT');
});

it('pricing page states no refunds and links the shared legal pages',()=>{
  const page=pricing();
  expect(page).toMatch(/Purchases are final.{1,3}no refunds/i);
  expect(page).toContain('https://mehyar.us/privacy-policy/');
  expect(page).toContain('https://mehyar.us/terms/');
  expect(page).toContain('https://mehyar.us/data-deletion/');
  expect(page).toContain('mailto:info@mehyar.us');
});

it('pricing page has honest fallback when the catalog is unreachable',()=>{
  const page=pricing();
  expect(page).toMatch(/could not be loaded/i);
  expect(page).toMatch(/Try again/i);
});

it('manifest.json is valid and matches the required PWA fields',()=>{
  const m=manifest();
  expect(m.name).toBe('The Mayor');
  expect(m.short_name).toBe('Mayor');
  expect(m.start_url).toBe('/');
  expect(m.display).toBe('standalone');
  expect(m.theme_color).toBe('#102b47');
  expect(m.background_color).toBe('#f4f7fb');
  const sizes=(m.icons??[]).map((i:{sizes:string})=>i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  for(const icon of m.icons??[]){
    expect(String(icon.src)).toMatch(/^\/(icon-192|icon-512)\.png$/);
    expect(icon.type).toBe('image/png');
  }
});

it('manifest.webmanifest stays in sync with manifest.json',()=>{
  const legacy=JSON.parse(readPublic('manifest.webmanifest'));
  expect(legacy.name).toBe('The Mayor');
  expect(legacy.short_name).toBe('Mayor');
});

it('app shell points at /manifest.json',()=>{
  expect(readWeb('index.html')).toContain('rel="manifest" href="/manifest.json"');
});

it('public asset paths cover the new routes',()=>{
  expect(isPublicAssetPath('/pricing')).toBe(true);
  expect(isPublicAssetPath('/pricing.html')).toBe(true);
  expect(isPublicAssetPath('/manifest.json')).toBe(true);
  // Redirects are handled by the worker, not served as assets.
  expect(isPublicAssetPath('/login')).toBe(false);
  expect(isPublicAssetPath('/signup')).toBe(false);
  expect(isPublicAssetPath('/privacy')).toBe(false);
});

it('icon assets referenced by the manifest exist',()=>{
  expect(existsSync(join(publicDir,'icon-192.png'))).toBe(true);
  expect(existsSync(join(publicDir,'icon-512.png'))).toBe(true);
});
