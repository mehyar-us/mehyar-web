/**
 * engine-audience.test.ts — Phase B of the audience → Mayor
 * integration: the in-tree read over campaign_intel.web_events.
 * Pins: (1) the week math is the mayor-beacon Phase A math, exactly
 * (Mon–Sun ET buckets over the stored ET `day` string, boundary
 * days included in the right week); (2) wildcard vs filtered
 * aggregation against the one query shape the accessor issues;
 * (3) the baseline series carry Phase A's names + definitions;
 * (4) the accessor is SELECT-only; (5) the Desk intent constructor
 * is stat-shaped and the tenant Desk flow never builds it;
 * (6) The Mayor's own beacon tag now points at mayor.mehyar.us on
 * every served surface, and the old host is gone from the sources.
 */
import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {addDays,audienceBaselineSeries,audienceSeries,clampAudienceWeeks,etDay,mondayOf} from '../src/engine/audience';
import {audienceStatIntent} from '../src/engine/surface';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

/* A fake D1 that emulates the ONE query shape the accessor issues
 * (SELECT day, COUNT(*) … WHERE day >= ? AND day < ? [AND product = ?]
 * [AND type = ?] [AND path LIKE ?] GROUP BY day) over seeded events.
 * Any non-SELECT prepare throws — the read-only law is enforced by
 * the fixture, not just asserted. */
interface SeedEvent { day: string; product: string; type: string; path?: string }
function fakeAudienceDb(events: SeedEvent[]) {
 return {
  prepare(sql: string) {
   if (!/^\s*SELECT/i.test(sql)) throw new Error(`audience accessor issued a non-SELECT: ${sql}`);
   return {
    bind(...binds: unknown[]) {
     return {
      async all() {
       const [start, next, ...filters] = binds as string[];
       let rows = events.filter(e => e.day >= start && e.day < next);
       let fi = 0;
       if (sql.includes('product = ?')) { const p = filters[fi++]; rows = rows.filter(e => e.product === p); }
       if (sql.includes('type = ?')) { const t = filters[fi++]; rows = rows.filter(e => e.type === t); }
       if (sql.includes('path LIKE ?')) { const pat = (filters[fi++] ?? '').replaceAll('%', ''); rows = rows.filter(e => (e.path ?? '').includes(pat)); }
       const byDay = new Map<string, number>();
       for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + 1);
       return { results: [...byDay.entries()].map(([day, n]) => ({ day, n })) };
      },
      async first() { return null; },
      async run() { throw new Error('audience accessor must never run()'); },
     };
    },
   };
  },
 } as unknown as D1Database;
}

/* Fixed instant: Thu 2026-10-22 11:00 ET — current ET week starts
 * Mon 2026-10-19; a 2-week window is [2026-10-12, 2026-10-26). */
const NOW = Date.UTC(2026, 9, 22, 15, 0, 0);
const ev = (day: string, product: string, type: string, n: number, path?: string): SeedEvent[] =>
 Array.from({ length: n }, () => ({ day, product, type, path }));
const SEED: SeedEvent[] = [
 ...ev('2026-10-19', 'moonroom', 'pageview', 2),  // Monday — current week opens
 ...ev('2026-10-25', 'moonroom', 'pageview', 1),  // Sunday — current week closes
 ...ev('2026-10-18', 'moonroom', 'pageview', 3),  // Sunday — previous week closes
 ...ev('2026-10-12', 'moonroom', 'pageview', 1),  // Monday — previous week opens
 ...ev('2026-10-11', 'moonroom', 'pageview', 4),  // Sunday before the 2-week window
 ...ev('2026-10-20', 'clipnote', 'checkout', 1),
 ...ev('2026-10-21', 'moonroom', 'checkout', 1),
 ...ev('2026-10-22', 'mayor', 'pageview', 1, '/precheck/done'),
];

describe('week math — the beacon Phase A arithmetic, verbatim', () => {
 it('mondayOf pins the boundary days', () => {
  expect(mondayOf('2026-10-19')).toBe('2026-10-19'); // a Monday maps to itself
  expect(mondayOf('2026-10-25')).toBe('2026-10-19'); // a Sunday closes the same week
  expect(mondayOf('2026-10-26')).toBe('2026-10-26'); // the next Monday opens the next week
  expect(mondayOf('2026-11-01')).toBe('2026-10-26'); // Sunday across a month boundary
  expect(mondayOf('2026-01-01')).toBe('2025-12-29'); // Thursday across a year boundary
 });
 it('addDays crosses months and years', () => {
  expect(addDays('2026-10-19', 7)).toBe('2026-10-26');
  expect(addDays('2026-10-19', -7)).toBe('2026-10-12');
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
 });
 it('etDay stamps the America/New_York calendar date', () => {
  expect(etDay(Date.UTC(2026, 0, 1, 4, 30))).toBe('2025-12-31'); // 23:30 EST, Dec 31
  expect(etDay(Date.UTC(2026, 0, 1, 5, 30))).toBe('2026-01-01'); // 00:30 EST, Jan 1
  expect(etDay(NOW)).toBe('2026-10-22');
 });
 it('clampAudienceWeeks matches the Phase A clamp, quirks included', () => {
  expect(clampAudienceWeeks(null)).toBe(8);
  expect(clampAudienceWeeks('abc')).toBe(8);
  expect(clampAudienceWeeks('0')).toBe(8);   // parseInt||8 — the beacon's own behavior
  expect(clampAudienceWeeks('-3')).toBe(1);
  expect(clampAudienceWeeks('3')).toBe(3);
  expect(clampAudienceWeeks('999')).toBe(52);
 });
});

describe('audienceSeries — bucketing + aggregation', () => {
 it('buckets boundary days into the right Mon–Sun weeks', async () => {
  const s = await audienceSeries(fakeAudienceDb(SEED), { product: 'moonroom', type: 'pageview', weeks: 2, now: NOW });
  expect(s.weeks).toEqual([
   { weekStart: '2026-10-12', count: 4 },  // Mon 10-12 ×1 + Sun 10-18 ×3
   { weekStart: '2026-10-19', count: 3 },  // Mon 10-19 ×2 + Sun 10-25 ×1
  ]);
  expect(s.total).toBe(7); // the 2026-10-11 rows sit outside the window
 });
 it('a wider window reaches the older week', async () => {
  const s = await audienceSeries(fakeAudienceDb(SEED), { product: 'moonroom', type: 'pageview', weeks: 3, now: NOW });
  expect(s.weeks[0]).toEqual({ weekStart: '2026-10-05', count: 4 });
  expect(s.total).toBe(11);
 });
 it('wildcards aggregate across products and types', async () => {
  const all = await audienceSeries(fakeAudienceDb(SEED), { product: '*', type: '*', weeks: 2, now: NOW });
  expect(all.total).toBe(10);
  expect(all.weeks).toEqual([
   { weekStart: '2026-10-12', count: 4 },
   { weekStart: '2026-10-19', count: 6 },
  ]);
  const checkouts = await audienceSeries(fakeAudienceDb(SEED), { type: 'checkout', weeks: 2, now: NOW });
  expect(checkouts.total).toBe(2);
  expect(checkouts.weeks[1].count).toBe(2);
  const one = await audienceSeries(fakeAudienceDb(SEED), { product: 'clipnote', type: 'checkout', weeks: 2, now: NOW });
  expect(one.total).toBe(1);
 });
 it('an empty store reads as honest zeros, never an error', async () => {
  const s = await audienceSeries(fakeAudienceDb([]), { product: 'moonroom', type: 'checkout', weeks: 2, now: NOW });
  expect(s.total).toBe(0);
  expect(s.weeks.every(w => w.count === 0)).toBe(true);
 });
});

describe('audienceBaselineSeries — Phase A names + definitions', () => {
 it('returns the four pinned series in the same buckets', async () => {
  const b = await audienceBaselineSeries(fakeAudienceDb(SEED), { weeks: 2, now: NOW });
  expect(b.weeks).toBe(2);
  const byName = Object.fromEntries(b.series.map(s => [s.name, s]));
  expect(Object.keys(byName).sort()).toEqual(['all_products_checkout', 'moonroom_checkout', 'precheck_path_any_product', 'visakit_any_type']);
  expect(byName.moonroom_checkout.total).toBe(1);
  expect(byName.moonroom_checkout.weeks).toEqual([
   { weekStart: '2026-10-12', count: 0 },
   { weekStart: '2026-10-19', count: 1 },
  ]);
  expect(byName.all_products_checkout.total).toBe(2);
  expect(byName.visakit_any_type.total).toBe(0);
  expect(byName.precheck_path_any_product.total).toBe(1);
  expect(byName.moonroom_checkout.definition).toContain("type = 'checkout'");
 });
});

describe('the read-only + scoping laws', () => {
 it('the accessor source issues SELECTs only', () => {
  const src = read('../src/engine/audience.ts');
  expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE)\b/);
 });
 it('the Desk intent constructor is a stat in the client catalog shape', () => {
  const intent = audienceStatIntent({ product: 'moonroom', type: 'checkout', weeks: [{ weekStart: '2026-10-19', count: 2 }], total: 2 });
  expect(intent.type).toBe('stat');
  expect(intent.id).toBe('audience-moonroom-checkout');
  expect(intent.value).toBe('2');
  expect(String(intent.summary)).toContain('moonroom');
 });
 it('the tenant Desk flow never builds an audience intent', () => {
  const src = read('../src/engine/surface.ts');
  const deskFlow = src.slice(src.indexOf('export async function buildEngineDeskIntents'));
  expect(deskFlow).not.toContain('audience');
  const routes = read('../src/engine/routes.ts');
  const audienceRoute = routes.slice(routes.indexOf("rest === 'audience'"), routes.indexOf("rest === 'belief'"));
  expect(audienceRoute).toContain('OPERATORS');
 });
});

describe("The Mayor's own beacon tag — the in-tree fold", () => {
 const TAGGED = [
  'web/index.html', 'web/sales.html', 'web/pricing.html', 'web/business-audit.html',
  'web/missed-call-text-back.html', 'web/how-much-does-a-missed-call-cost.html',
  'web/ai-receptionist-vs-answering-service.html',
  'web/sales/auto-repair.html', 'web/sales/dental.html', 'web/sales/med-spa.html',
  'web/sales/pet-grooming.html', 'web/sales/plumbing-hvac.html', 'web/sales/restaurant.html',
  'web/sales/salon.html',
  'web/public/blog/front-desk-missed-calls.html', 'web/public/blog/small-business-cybersecurity-checklist.html',
  'scripts/gen-sales-verticals.mjs',
 ];
 it('every served surface loads the beacon from mayor.mehyar.us, data-product unchanged', () => {
  for (const f of TAGGED) {
   const src = read(`../${f}`);
   expect(src, f).toContain('src="https://mayor.mehyar.us/b.js" data-product="mayor"');
   expect(src, f).not.toContain('audience.mehyar.us');
  }
 });
});
