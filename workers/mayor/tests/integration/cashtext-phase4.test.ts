import {env as testEnv} from 'cloudflare:workers';
import {expect,it} from 'vitest';
import type {Env} from '../../src/env';
import * as store from '../../src/engine/store';
import {buildEngineDeskIntents} from '../../src/engine/surface';
import {runCashTextChaseScan, runCashTextFridaySummary} from '../../src/cashtext/cadence';
import {listPreparedActions} from '../../src/engine/store';

/* Phase 4 proof battery (integration spec §3.4 + §3.6 + §9.1,
 * Miniflare/D1): the chase scan prepares per-step approval cards —
 * never sends — and honors opt-out / paid / dismissed-step / pending
 * exclusions; the Friday summary fires Friday 17:00 in the TENANT's
 * timezone, once per week, compiles only from invoice rows, and its
 * email mirror exists only where the owner-email preference is on. */
const E = testEnv as unknown as Env;
let n = 0;
const tenantId = () => (++n).toString(16).padStart(4, 'b').padEnd(32, 'e').slice(0, 32);
const accountFor = (t: string) => `acct_tenant${t.slice(0, 12)}`;

async function seedTenant(t: string, over: { summaryEnabled?: number } = {}) {
 const now = new Date().toISOString();
 await E.AGENT_DB.prepare('INSERT OR IGNORE INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(t, 'Cadence Shop', now).run();
 await E.AGENT_DB.prepare("INSERT OR IGNORE INTO agent_memberships(tenant_id,user_id,role,status) VALUES(?,?,'owner','active')").bind(t, `user-${t.slice(0, 6)}`).run();
 await E.AGENT_DB.prepare('INSERT INTO mayor_cashtext_settings(tenant_id,stripe_account_id,account_status,charges_enabled,payouts_enabled,summary_enabled,created_at,updated_at) VALUES(?,?,?,1,1,?,?,?)')
  .bind(t, accountFor(t), 'active', over.summaryEnabled ?? 1, now, now).run();
}
async function seedCustomer(t: string, name: string, email: string | null) {
 const id = crypto.randomUUID(), now = new Date().toISOString();
 await E.AGENT_DB.prepare('INSERT INTO mayor_customers(id,tenant_id,name,name_key,email,phone,confirmed_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .bind(id, t, name, name.toLowerCase(), email, email ? null : '+15551234567', `user-${t.slice(0, 6)}`, now, now).run();
 return id;
}
async function seedInvoice(t: string, customerId: string, over: Partial<{ amount: number; status: string; due: string; chaseCount: number; paidAt: string; sentAt: string }> = {}) {
 const id = crypto.randomUUID(), now = new Date().toISOString();
 await E.AGENT_DB.prepare(`INSERT INTO mayor_cashtext_invoices(id,tenant_id,customer_id,stripe_customer_id,stripe_invoice_id,description,amount_cents,status,due_date,idempotency_key,hosted_invoice_url,sent_at,paid_at,chase_count,created_at,updated_at)
  VALUES(?,?,?,?,?,'Water heater install',?,?,?,?,?,?,?,?,?,?)`)
  .bind(id, t, customerId, 'cus_fixture', `in_${id.replaceAll('-', '')}`, over.amount ?? 40000, over.status ?? 'sent', over.due ?? null, id,
   'https://invoice.stripe.com/i/fixture', over.sentAt ?? now, over.paidAt ?? null, over.chaseCount ?? 0, now, now).run();
 return id;
}
const chasesFor = async (t: string, invoiceId: string) => (await listPreparedActions(E.AGENT_DB, t, ['prepared', 'dismissed', 'expired', 'approved']))
 .filter(a => a.actionClass === 'send_invoice_chase' && a.payload.invoice_id === invoiceId);

/* Friday 2026-10-23, 12:00Z — a neutral scan instant. */
const SCAN_NOW = new Date('2026-10-23T12:00:00.000Z');

it('chase scan: due+2 prepares a step-1 ask card (nothing sent); a second scan prepares no duplicate', async () => {
 const t = tenantId(); await seedTenant(t);
 const maria = await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 const inv = await seedInvoice(t, maria, { due: '2026-10-21' }); // 2 days past due at SCAN_NOW
 const first = await runCashTextChaseScan(E.AGENT_DB, SCAN_NOW);
 expect(first.prepared).toBe(1);
 const cards = await chasesFor(t, inv);
 expect(cards).toHaveLength(1);
 expect(cards[0]).toMatchObject({ kind: 'ask', actionClass: 'send_invoice_chase', status: 'prepared' });
 expect(cards[0].payload.chase_step).toBe(1);
 // The invoice row itself is untouched — preparation is not a send.
 const row = await E.AGENT_DB.prepare('SELECT chase_count,last_chase_at FROM mayor_cashtext_invoices WHERE id=?').bind(inv).first<{ chase_count: number; last_chase_at: string | null }>();
 expect(row).toMatchObject({ chase_count: 0, last_chase_at: null });
 const second = await runCashTextChaseScan(E.AGENT_DB, SCAN_NOW);
 expect(second.prepared).toBe(0);
 expect(await chasesFor(t, inv)).toHaveLength(1);
});

it('chase scan: thresholds and chase_count — +1 day nothing, +8 days step 2, +15 days step 3, fully-chased nothing', async () => {
 const t = tenantId(); await seedTenant(t);
 const c = await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 const fresh = await seedInvoice(t, c, { due: '2026-10-22' });            // 1 day over
 const step2 = await seedInvoice(t, c, { due: '2026-10-15' });            // 8 days over
 const step3 = await seedInvoice(t, c, { due: '2026-10-08' });            // 15 days over
 const done = await seedInvoice(t, c, { due: '2026-10-01', chaseCount: 3 }); // all chases sent
 const mid = await seedInvoice(t, c, { due: '2026-10-15', chaseCount: 1 });  // step 1 sent; step 2 due
 await runCashTextChaseScan(E.AGENT_DB, SCAN_NOW);
 expect(await chasesFor(t, fresh)).toHaveLength(0);
 expect((await chasesFor(t, step2))[0]?.payload.chase_step).toBe(2);
 expect((await chasesFor(t, step3))[0]?.payload.chase_step).toBe(3);
 expect(await chasesFor(t, done)).toHaveLength(0);
 expect((await chasesFor(t, mid))[0]?.payload.chase_step).toBe(2);
});

it('chase scan: opt-out contacts and paid invoices are excluded absolutely (R3)', async () => {
 const t = tenantId(); await seedTenant(t);
 const optedOut = await seedCustomer(t, 'Opted Out', 'out@example.com');
 const payer = await seedCustomer(t, 'Paid Up', 'paid@example.com');
 const now = new Date().toISOString();
 await E.AGENT_DB.prepare('INSERT INTO mayor_cashtext_contacts(tenant_id,customer_id,chase_opt_out,created_at,updated_at) VALUES(?,?,1,?,?)').bind(t, optedOut, now, now).run();
 const invA = await seedInvoice(t, optedOut, { due: '2026-10-10' });
 const invB = await seedInvoice(t, payer, { due: '2026-10-10', status: 'paid', paidAt: now });
 const result = await runCashTextChaseScan(E.AGENT_DB, SCAN_NOW);
 expect(result.prepared).toBe(0);
 expect(await chasesFor(t, invA)).toHaveLength(0);
 expect(await chasesFor(t, invB)).toHaveLength(0);
});

it('chase scan (§9.1): a dismissed step is never re-prepared; the NEXT step still arrives on its threshold', async () => {
 const t = tenantId(); await seedTenant(t);
 const c = await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 const inv = await seedInvoice(t, c, { due: '2026-10-21' });
 await runCashTextChaseScan(E.AGENT_DB, SCAN_NOW);
 const card = (await chasesFor(t, inv))[0];
 await store.setPreparedStatus(E.AGENT_DB, t, card.id, 'dismissed');
 // Same step window: never again.
 await runCashTextChaseScan(E.AGENT_DB, new Date('2026-10-24T12:00:00.000Z'));
 expect((await chasesFor(t, inv)).filter(a => a.status === 'prepared')).toHaveLength(0);
 // Step 2 threshold (due+7 = Oct 28): a fresh step-2 card arrives.
 await runCashTextChaseScan(E.AGENT_DB, new Date('2026-10-28T12:00:00.000Z'));
 const prepared = (await chasesFor(t, inv)).filter(a => a.status === 'prepared');
 expect(prepared).toHaveLength(1);
 expect(prepared[0].payload.chase_step).toBe(2);
});

it('chase scan: a lapsed (expired) card is swept and the step re-prepares as a fresh card', async () => {
 const t = tenantId(); await seedTenant(t);
 const c = await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 const inv = await seedInvoice(t, c, { due: '2026-10-21' });
 await runCashTextChaseScan(E.AGENT_DB, SCAN_NOW);
 const card = (await chasesFor(t, inv))[0];
 await E.AGENT_DB.prepare("UPDATE mayor_prepared_actions SET expires_at='2026-10-23T00:00:00.000Z' WHERE id=?").bind(card.id).run();
 await runCashTextChaseScan(E.AGENT_DB, new Date('2026-10-23T13:00:00.000Z'));
 const all = await chasesFor(t, inv);
 expect(all.find(a => a.id === card.id)?.status).toBe('expired');
 expect(all.filter(a => a.status === 'prepared')).toHaveLength(1);
});

/* Friday 2026-10-23 17:30 New York = 21:30Z (EDT). */
const FRI_NY = new Date('2026-10-23T21:30:00.000Z');

it('friday summary: fires at 17:30 tenant-local, compiles from the rows, and never twice in a week', async () => {
 const t = tenantId(); await seedTenant(t);
 const maria = await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 await seedInvoice(t, maria, { status: 'paid', amount: 40000, paidAt: '2026-10-21T15:00:00.000Z', due: '2026-10-28' });
 await seedInvoice(t, maria, { status: 'sent', amount: 25000, due: '2026-10-14', sentAt: '2026-10-07T15:00:00.000Z' });
 const first = await runCashTextFridaySummary(E, FRI_NY);
 expect(first.written).toBeGreaterThanOrEqual(1); // the run is global; this tenant's row is asserted below
 const row = await E.AGENT_DB.prepare('SELECT week_key,timezone,text FROM mayor_cashtext_summaries WHERE tenant_id=?').bind(t).first<{ week_key: string; timezone: string; text: string }>();
 expect(row?.week_key).toBe('2026-10-23');
 expect(row?.timezone).toBe('America/New_York');
 expect(row?.text).toContain('Collected this week: $400 (1 payment — Maria Lopez).');
 expect(row?.text).toContain('Still out: $250 across 1 invoice (oldest 9 days).');
 const second = await runCashTextFridaySummary(E, FRI_NY);
 expect(second.written).toBe(0);
 const count = await E.AGENT_DB.prepare('SELECT COUNT(*) AS c FROM mayor_cashtext_summaries WHERE tenant_id=?').bind(t).first<{ c: number }>();
 expect(count?.c).toBe(1);
 // The Desk renders it as a stat intent.
 const desk = await buildEngineDeskIntents(E.AGENT_DB, t);
 expect(desk.some(i => i.type === 'stat' && String(i.id).startsWith('cashtext-summary-'))).toBe(true);
});

it('friday summary: before 17:00 tenant-local nothing fires; the tenant timezone — not UTC — decides', async () => {
 const t = tenantId(); await seedTenant(t);
 await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 // 16:30 New York (20:30Z): too early.
 const early = await runCashTextFridaySummary(E, new Date('2026-10-23T20:30:00.000Z'));
 expect(early.written).toBe(0);
 // A Los Angeles tenant at the New York fire instant (14:30 PDT) waits for its own 17:00.
 const t2 = tenantId(); await seedTenant(t2);
 const now = new Date().toISOString();
 await E.AGENT_DB.prepare("INSERT INTO mayor_memory(tenant_id,field,value_json,source_kind,confirmed_by,confirmed_at,revision,updated_at) VALUES(?,'scheduling_policy',?,'owner_conversation',?,?,1,?)")
  .bind(t2, JSON.stringify({ timeZone: 'America/Los_Angeles' }), `user-${t2.slice(0, 6)}`, now, now).run();
 const la = await runCashTextFridaySummary(E, FRI_NY);
 const laRows = await E.AGENT_DB.prepare('SELECT COUNT(*) AS c FROM mayor_cashtext_summaries WHERE tenant_id=?').bind(t2).first<{ c: number }>();
 expect(laRows?.c).toBe(0);
 expect(la.written).toBeGreaterThanOrEqual(0);
 // At 17:30 Los Angeles (00:30Z Saturday) the LA tenant fires, keyed to ITS Friday.
 await runCashTextFridaySummary(E, new Date('2026-10-24T00:30:00.000Z'));
 const laRow = await E.AGENT_DB.prepare('SELECT week_key,timezone FROM mayor_cashtext_summaries WHERE tenant_id=?').bind(t2).first<{ week_key: string; timezone: string }>();
 expect(laRow).toMatchObject({ week_key: '2026-10-23', timezone: 'America/Los_Angeles' });
});

it('friday summary: summary_enabled=0 suppresses it; a zero week files the one-line quiet summary', async () => {
 const off = tenantId(); await seedTenant(off, { summaryEnabled: 0 });
 await runCashTextFridaySummary(E, FRI_NY);
 expect((await E.AGENT_DB.prepare('SELECT COUNT(*) AS c FROM mayor_cashtext_summaries WHERE tenant_id=?').bind(off).first<{ c: number }>())?.c).toBe(0);
 const quiet = tenantId(); await seedTenant(quiet);
 const result = await runCashTextFridaySummary(E, FRI_NY);
 expect(result.written).toBeGreaterThanOrEqual(1);
 const row = await E.AGENT_DB.prepare('SELECT text FROM mayor_cashtext_summaries WHERE tenant_id=?').bind(quiet).first<{ text: string }>();
 expect(row?.text).toBe('Friday cash summary — quiet week: nothing collected, nothing outstanding, nothing waiting on you.');
});

it('friday summary: the email mirror exists ONLY where the owner-email preference is on', async () => {
 const withPref = tenantId(); await seedTenant(withPref);
 const noPref = tenantId(); await seedTenant(noPref);
 const now = new Date().toISOString();
 await E.AGENT_DB.prepare('INSERT INTO mayor_email_preferences(tenant_id,user_id,enabled,email,revision,updated_at) VALUES(?,?,1,?,1,?)')
  .bind(withPref, `user-${withPref.slice(0, 6)}`, 'owner@example.com', now).run();
 const result = await runCashTextFridaySummary(E, FRI_NY);
 expect(result.notified).toBe(1);
 const notes = await E.AGENT_DB.prepare("SELECT tenant_id,kind,dedupe_key FROM mayor_notifications WHERE kind='cashtext_friday_summary'").all<{ tenant_id: string }>();
 expect(notes.results.map(r => r.tenant_id)).toEqual([withPref]);
 // Re-running inside the window never duplicates the mirror.
 await runCashTextFridaySummary(E, FRI_NY);
 const again = await E.AGENT_DB.prepare("SELECT COUNT(*) AS c FROM mayor_notifications WHERE kind='cashtext_friday_summary'").first<{ c: number }>();
 expect(again?.c).toBe(1);
});
