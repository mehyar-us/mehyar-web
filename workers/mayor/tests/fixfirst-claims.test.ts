/**
 * fixfirst-claims.test.ts — product-review FIX_FIRST items:
 * 1. SPA deep-link route classification (known app views → shell, unknown → 404).
 * 2. No absolute speed claims ("within a minute") in public copy sources.
 */
import {expect,it} from 'vitest';
import {spaViewForPath} from '../src/public-routes';
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');

it('spaViewForPath maps known app views and rejects everything else',()=>{
  // Known SPA views → view name (worker serves the app shell, 200).
  expect(spaViewForPath('/connectors')).toBe('connections');
  expect(spaViewForPath('/today')).toBe('today');
  expect(spaViewForPath('/feed')).toBe('feed');
  expect(spaViewForPath('/billing')).toBe('billing');
  expect(spaViewForPath('/settings')).toBe('account');
  expect(spaViewForPath('/account')).toBe('account');
  // Unknown paths → null (worker serves the real 404 page).
  for(const bad of ['/nope','/sales/saloon','/admin','/api/billing/catalog','/connectors/extra','/CONNECTORs']){
    expect(spaViewForPath(bad),bad).toBe(null);
  }
});

it('no absolute speed claims in public copy sources',()=>{
  const files=[
    'web/sales.html',
    'web/sales/salon.html',
    'web/sales/restaurant.html',
    'web/sales/plumbing-hvac.html',
    'web/sales/dental.html',
    'web/sales/auto-repair.html',
    'web/sales/pet-grooming.html',
    'web/sales/med-spa.html',
    'web/pricing.html',
    'scripts/gen-sales-verticals.mjs',
  ];
  for(const file of files){
    const text=readFileSync(join(root,file),'utf8');
    expect(text,file).not.toMatch(/within a minute/i);
  }
});

it('money-loop qualifier sits with the section header, not just below the grid',()=>{
  const html=readFileSync(join(root,'web/sales.html'),'utf8');
  const leadIdx=html.indexOf('id="money-loop-heading"');
  const noteIdx=html.indexOf('loop-note-top');
  const gridIdx=html.indexOf('class="loop-grid"');
  expect(leadIdx).toBeGreaterThan(-1);
  expect(noteIdx).toBeGreaterThan(-1);
  // The qualifier comes right after the section lead, before the loop grid.
  expect(noteIdx).toBeGreaterThan(leadIdx);
  expect(noteIdx).toBeLessThan(gridIdx);
});
