/**
 * engine/audience.ts — the audience read (Phase B of the audience →
 * Mayor integration). A typed, READ-ONLY accessor over the fleet's
 * first-party audience store (campaign_intel.web_events), reached
 * through the worker's second D1 binding, AUDIENCE_DB. The store
 * does not move (M1): the mayor-beacon route worker writes it, this
 * accessor and the beacon's Phase A endpoints read it.
 *
 * Contract parity with Phase A (mayor-beacon /api/series +
 * /api/baseline-series) is deliberate and pinned by tests: the week
 * math below is the beacon's own — Mon–Sun ET buckets over the
 * stored `day` string (the collector stamps `day` in
 * America/New_York, so bucketing is pure date arithmetic on that
 * string, no timezone drift), the same window (the last `weeks`
 * Mon–Sun weeks including the current one), the same clamping
 * (1–52, default 8), the same filter truncation (40 chars), and the
 * same four baseline definitions under the same names.
 *
 * Scoping law (ruled, plan §2 M3): this data is the OWNER's
 * portfolio intel across products, keyed by product string — never
 * a tenant's business data. Nothing here takes a tenantId, because
 * nothing here may be tenant-scoped: the only caller is the
 * OPERATORS-gated engine route. SELECTs only, ever — this module
 * contains no write path.
 */

type DB = D1Database;

export interface AudienceWeekBucket { weekStart: string; count: number }
export interface AudienceSeries {
 product: string;
 type: string;
 weeks: AudienceWeekBucket[];
 total: number;
}
export interface AudienceBaselineEntry {
 name: string;
 definition: string;
 weeks: AudienceWeekBucket[];
 total: number;
}
export interface AudienceBaseline { weeks: number; series: AudienceBaselineEntry[] }

/** The beacon's ET day stamp, verbatim: an America/New_York calendar
 * date (YYYY-MM-DD) for a millisecond instant. */
export function etDay(ts: number): string {
 return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}

export function addDays(dayStr: string, n: number): string {
 const [y, m, d] = dayStr.split('-').map(Number);
 return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The Monday (YYYY-MM-DD) of the Mon–Sun week containing dayStr. */
export function mondayOf(dayStr: string): string {
 const [y, m, d] = dayStr.split('-').map(Number);
 const dt = new Date(Date.UTC(y, m - 1, d));
 const diff = (dt.getUTCDay() + 6) % 7; // days since Monday
 dt.setUTCDate(dt.getUTCDate() - diff);
 return dt.toISOString().slice(0, 10);
}

/** Phase A's clamp, verbatim: default 8, NaN → 8, range 1–52. */
export function clampAudienceWeeks(raw: string | null | undefined): number {
 return Math.min(52, Math.max(1, parseInt(raw || '8', 10) || 8));
}

async function weeklySeries(db: DB, whereSql: string, binds: string[], weeks: number, now: number): Promise<{ weeks: AudienceWeekBucket[]; total: number }> {
 const currentMonday = mondayOf(etDay(now));
 const startMonday = addDays(currentMonday, -7 * (weeks - 1));
 const nextMonday = addDays(currentMonday, 7);
 const rows = (await db.prepare(
  `SELECT day, COUNT(*) AS n FROM web_events WHERE day >= ? AND day < ?${whereSql} GROUP BY day`
 ).bind(startMonday, nextMonday, ...binds).all<{ day: string; n: number }>()).results || [];
 const buckets: AudienceWeekBucket[] = [];
 for (let i = 0; i < weeks; i++) buckets.push({ weekStart: addDays(startMonday, 7 * i), count: 0 });
 const idx = Object.fromEntries(buckets.map((b, i) => [b.weekStart, i]));
 let total = 0;
 for (const r of rows) {
  const mon = mondayOf(r.day);
  if (mon in idx) { buckets[idx[mon]].count += r.n; total += r.n; }
 }
 return { weeks: buckets, total };
}

/** Per-product × per-type weekly series. `product`/`type` of '*'
 * (or omitted) mean all — the Phase A wildcard semantics. */
export async function audienceSeries(db: DB, input: { product?: string; type?: string; weeks: number; now?: number }): Promise<AudienceSeries> {
 const product = input.product ?? '*';
 const type = input.type ?? '*';
 let where = '';
 const binds: string[] = [];
 if (product !== '*') { where += ' AND product = ?'; binds.push(product.slice(0, 40)); }
 if (type !== '*') { where += ' AND type = ?'; binds.push(type.slice(0, 40)); }
 const s = await weeklySeries(db, where, binds, input.weeks, input.now ?? Date.now());
 return { product, type, ...s };
}

/** The baseline snapshot's pinned definitions, under Phase A's
 * names, so seam comparisons are mechanical across both reads. */
export async function audienceBaselineSeries(db: DB, input: { weeks: number; now?: number }): Promise<AudienceBaseline> {
 const now = input.now ?? Date.now();
 const named = async (name: string, definition: string, where: string, binds: string[]): Promise<AudienceBaselineEntry> =>
  ({ name, definition, ...(await weeklySeries(db, where, binds, input.weeks, now)) });
 const series = [
  await named('moonroom_checkout',
   "web_events.type = 'checkout' AND product = 'moonroom'",
   ' AND product = ? AND type = ?', ['moonroom', 'checkout']),
  await named('all_products_checkout',
   "web_events.type = 'checkout', all products",
   ' AND type = ?', ['checkout']),
  await named('visakit_any_type',
   "web_events.product = 'visakit', any type",
   ' AND product = ?', ['visakit']),
  await named('precheck_path_any_product',
   "web_events.path LIKE '%precheck%', any product",
   ' AND path LIKE ?', ['%precheck%']),
 ];
 return { weeks: input.weeks, series };
}
