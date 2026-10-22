/**
 * engine-audience.test.ts — Phase B of the audience → Mayor
 * integration, end to end against real Miniflare D1s: the operator
 * read over a seeded campaign_intel.web_events, the OPERATORS gate
 * (the /engine/belief bar), and the Desk law — the tenant Desk flow
 * serves NO audience intent, ever. The audience store is a separate
 * database (AUDIENCE_DB) with the beacon's schema, created here;
 * AGENT_DB migrations never touch it, exactly as in production.
 */
import {beforeEach,describe,expect,it} from 'vitest';
import {env} from 'cloudflare:test';
import worker from '../../src/index';
import {createAuth} from '../../src/auth';
import {addDays,etDay,mondayOf} from '../../src/engine/audience';

const E = env as unknown as Record<string, unknown> & {AGENT_DB: D1Database; AUDIENCE_DB: D1Database; BETTER_AUTH_SECRET?: string};

let n = 0;
const tenantId = () => (n++).toString(16).padStart(4, 'a').padEnd(32, 'f').slice(0, 32);

/* Week anchors from the module's own ET math, so the test is right
 * on any run date: current Mon–Sun ET week + the previous one. */
const MON = mondayOf(etDay(Date.now()));
const PREV_MON = addDays(MON, -7);
const PREV_SUN = addDays(MON, -1);
const CUR_SUN = addDays(MON, 6);

async function seedEvents() {
 await E.AUDIENCE_DB.prepare(`CREATE TABLE IF NOT EXISTS web_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, vid TEXT, sid TEXT, ts INTEGER, day TEXT,
  product TEXT, type TEXT, path TEXT, label TEXT, href TEXT, referrer TEXT,
  utm_source TEXT, utm_campaign TEXT, country TEXT, device TEXT, seconds INTEGER)`).run();
 await E.AUDIENCE_DB.prepare('DELETE FROM web_events').run();
 const rows: Array<[string, string, string, string]> = [
  [MON, 'moonroom', 'pageview', '/'], [MON, 'moonroom', 'pageview', '/packs'],
  [CUR_SUN, 'moonroom', 'pageview', '/'],
  [PREV_SUN, 'moonroom', 'pageview', '/'], [PREV_SUN, 'moonroom', 'pageview', '/'], [PREV_SUN, 'moonroom', 'pageview', '/'],
  [PREV_MON, 'moonroom', 'pageview', '/'],
  [MON, 'clipnote', 'checkout', '/billing'],
  [addDays(MON, 1), 'moonroom', 'checkout', '/pay'],
  [etDay(Date.now()), 'mayor', 'pageview', '/precheck/done'],
 ];
 for (const [day, product, type, path] of rows) {
  await E.AUDIENCE_DB.prepare('INSERT INTO web_events(vid,sid,ts,day,product,type,path) VALUES(?,?,?,?,?,?,?)')
   .bind('v-test', 's-test', Date.now(), day, product, type, path).run();
 }
}

async function sessionHeaders(t: string, role: 'owner' | 'staff') {
 const now = new Date().toISOString();
 await E.AGENT_DB.prepare('INSERT OR IGNORE INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(t, 'Audience Test Shop', now).run();
 const ctx = await createAuth(E as never).$context;
 const user = await ctx.internalAdapter.createUser({email: `audience-${role}-${t.slice(0, 6)}-${n}@example.test`, name: 'Audience Tester', emailVerified: true});
 await E.AGENT_DB.prepare('INSERT OR REPLACE INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,?)').bind(t, user.id, role).run();
 const session = await ctx.internalAdapter.createSession(user.id);
 const row = await E.AGENT_DB.prepare('SELECT token FROM auth_session WHERE id=?').bind(session.id).first<{token: string}>();
 const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(E.BETTER_AUTH_SECRET!), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
 const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(row!.token));
 const cookie = '__Secure-mehyar-agent.session_token=' + row!.token + '.' + btoa(String.fromCharCode(...new Uint8Array(signature)));
 return {cookie, origin: 'https://mayor.example.test', 'content-type': 'application/json'};
}

const get = (t: string, rest: string, headers: Record<string, string>) =>
 worker.fetch(new Request(`https://mayor.example.test/api/businesses/${t}/engine/${rest}`, {headers}), E as never, {} as ExecutionContext);

beforeEach(seedEvents);

describe('GET /engine/audience — the Phase B read', () => {
 it('an operator reads the series with Phase A bucketing', async () => {
  const t = tenantId();
  const headers = await sessionHeaders(t, 'owner');
  const res = await get(t, 'audience?product=moonroom&type=pageview&weeks=2', headers);
  expect(res.status).toBe(200);
  const body = await res.json() as {product: string; type: string; total: number; weeks: Array<{weekStart: string; count: number}>; intents: Array<{type: string; id: string; value: string}>};
  expect(body.product).toBe('moonroom');
  expect(body.weeks).toEqual([
   {weekStart: PREV_MON, count: 4},
   {weekStart: MON, count: 3},
  ]);
  expect(body.total).toBe(7);
  expect(body.intents).toHaveLength(1);
  expect(body.intents[0].type).toBe('stat');
  expect(body.intents[0].id).toBe('audience-moonroom-pageview');
  expect(body.intents[0].value).toBe('7');
 });

 it('baseline=1 returns the four pinned series under their definitions', async () => {
  const t = tenantId();
  const headers = await sessionHeaders(t, 'owner');
  const res = await get(t, 'audience?weeks=2&baseline=1', headers);
  expect(res.status).toBe(200);
  const body = await res.json() as {baseline: {series: Array<{name: string; total: number}>}};
  const byName = Object.fromEntries(body.baseline.series.map(s => [s.name, s.total]));
  expect(byName.moonroom_checkout).toBe(1);
  expect(byName.all_products_checkout).toBe(2);
  expect(byName.visakit_any_type).toBe(0);
  expect(byName.precheck_path_any_product).toBe(1);
 });

 it('a staff member (chat role, not an operator) is refused', async () => {
  const t = tenantId();
  const headers = await sessionHeaders(t, 'staff');
  const res = await get(t, 'audience?product=moonroom&type=pageview&weeks=2', headers);
  expect(res.status).toBe(403);
 });

 it('an anonymous caller is refused', async () => {
  const t = tenantId();
  await sessionHeaders(t, 'owner'); // the tenant exists; the caller has no session
  const res = await get(t, 'audience', {origin: 'https://mayor.example.test'});
  expect([401, 403]).toContain(res.status);
 });

 it('the tenant Desk flow serves no audience intent', async () => {
  const t = tenantId();
  const headers = await sessionHeaders(t, 'owner');
  const desk = await get(t, 'desk', headers);
  expect(desk.status).toBe(200);
  const body = await desk.json() as {intents: Array<{id: string; type: string}>};
  expect(body.intents.some(i => i.id.includes('audience'))).toBe(false);
 });
});
