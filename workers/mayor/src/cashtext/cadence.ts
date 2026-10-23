/**
 * cashtext/cadence.ts — CashText's periodic work (integration spec
 * §3.4 + §3.6, Phase 4). Two legs ride the existing 5-minute cron
 * (src/index.ts scheduled()), each internally gated:
 *
 * CHASES (§3.4, as amended by the Phase 2 footer verdict): the scan
 * prepares a chase card at due+2 (step 1), due+7 (step 2), due+14
 * (step 3, final) — PREPARES, never sends. Every send still waits for
 * its own per-chase approval, and the executor's chase path is
 * re-send-only with the approved text returned as a disclosed
 * copy-paste draft. Excluded by construction: paid/void invoices
 * (the scan reads status='sent' only), chase_opt_out contacts
 * (mayor_cashtext_contacts, §3.2/R3), invoices that already
 * received that many chases (chase_count), and — §9.1 — a step the
 * owner DISMISSED is never re-prepared for that invoice; later steps
 * still arrive on their own thresholds. One unapproved chase per
 * invoice at a time (prepareChaseDraft's dedupe). The engine has no
 * global prepared-action sweeper, so the scan first flips its own
 * stale chase cards (prepared past expires_at) to 'expired' — a
 * lapsed card can never wedge the cadence.
 *
 * FRIDAY SUMMARY (§3.6): Friday 17:00 in the tenant's own
 * scheduling-policy timezone (default America/New_York, D8),
 * once per tenant per week — mayor_cashtext_summaries'
 * UNIQUE(tenant_id, week_key) is the fence, and the Friday-evening
 * → Sunday window catches up a missed Friday instead of skipping
 * the week. Contents compile ONLY from mayor_cashtext_invoices:
 * collected this week (count + total + who paid), still out with
 * ages, chases waiting on the owner, drafts waiting. A zero week is
 * a one-line quiet summary, never silence-spam and never invented
 * numbers. Channels: the Desk stat intent (surface.ts reads the
 * stored row) and — ONLY when the owner's existing email preference
 * is on — a mayor_notifications row (kind cashtext_friday_summary)
 * that the established preference/outbox machinery
 * (notification-email.ts) turns into the owner alert email. The
 * summary is owner mail about the owner's own book; nothing here
 * ever writes to a customer.
 */
import type {Env} from '../env';
import {listPreparedActions} from '../engine/store';
import {displayStatus, listInvoices, prepareChaseDraft} from './drafts';
import {getCustomerById, money} from './talk';

type DB = D1Database;

/* ---------------- timezone helpers (pure, unit-pinned) ---------------- */

export function zonedParts(now: Date, timeZone: string): { date: string; weekday: string; hour: number; minute: number } {
 const fmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
 const parts: Record<string, string> = {};
 for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
 return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday, hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}

export function dateAddDays(dateStr: string, days: number): string {
 const d = new Date(`${dateStr}T00:00:00Z`);
 d.setUTCDate(d.getUTCDate() + days);
 return d.toISOString().slice(0, 10);
}

export function daysBetween(fromDate: string, toDate: string): number {
 return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);
}

/** The Friday (YYYY-MM-DD) of the Monday-start week containing
 * dateStr. A Saturday/Sunday date belongs to the week that just
 * ended, so its Friday is 1–2 days back — the summary catch-up
 * window depends on exactly this. */
export function fridayOfWeek(dateStr: string): string {
 const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
 const iso = dow === 0 ? 7 : dow; // Mon 1 … Sun 7
 return dateAddDays(dateStr, 5 - iso);
}

/** The Monday (YYYY-MM-DD) of dateStr's Monday-start week. */
export function mondayOfWeek(dateStr: string): string {
 return dateAddDays(fridayOfWeek(dateStr), -4);
}

/** The UTC instant of local midnight on dateStr in timeZone,
 * computed from the zone's own offset at that instant (Intl is the
 * source of truth; no offset table is guessed). */
export function zonedMidnightUtcMs(dateStr: string, timeZone: string): number {
 const guess = Date.parse(`${dateStr}T00:00:00Z`);
 const local = zonedParts(new Date(guess), timeZone);
 const localAsUtc = Date.parse(`${local.date}T${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}:00Z`);
 return guess - (localAsUtc - guess);
}

export async function tenantTimezone(db: DB, tenantId: string): Promise<string> {
 try {
  const row = await db.prepare("SELECT value_json FROM mayor_memory WHERE tenant_id=? AND field='scheduling_policy'").bind(tenantId).first<{ value_json: string }>();
  const tz = row ? (JSON.parse(row.value_json) as { timeZone?: unknown }).timeZone : null;
  if (typeof tz === 'string' && tz) { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; }
 } catch { /* fall through to the D8 default */ }
 return 'America/New_York';
}

/* ---------------- the chase scan (§3.4) ---------------- */

/** Chase cadence thresholds, in days past due (spec §3.4). */
export const CHASE_STEP_DAYS = [2, 7, 14] as const;

export function chaseStepForDaysOverdue(daysOverdue: number): 0 | 1 | 2 | 3 {
 if (daysOverdue >= CHASE_STEP_DAYS[2]) return 3;
 if (daysOverdue >= CHASE_STEP_DAYS[1]) return 2;
 if (daysOverdue >= CHASE_STEP_DAYS[0]) return 1;
 return 0;
}

export async function runCashTextChaseScan(db: DB, now = new Date()): Promise<{ considered: number; prepared: number; skipped: number }> {
 const nowIso = now.toISOString();
 // Sweep this module's own stale chase cards first: expiry is lazy
 // everywhere else in the engine, and a prepared-but-lapsed card
 // would otherwise read as "one already waiting" forever.
 await db.prepare("UPDATE mayor_prepared_actions SET status='expired',updated_at=? WHERE action_class='send_invoice_chase' AND status='prepared' AND expires_at IS NOT NULL AND expires_at<?")
  .bind(nowIso, nowIso).run();
 const rows = await db.prepare("SELECT tenant_id,id FROM mayor_cashtext_invoices WHERE status='sent' AND due_date IS NOT NULL ORDER BY created_at ASC")
  .all<{ tenant_id: string; id: string }>();
 let prepared = 0, skipped = 0;
 const todayUtc = nowIso.slice(0, 10);
 const byTenant = new Map<string, Awaited<ReturnType<typeof listInvoices>>>();
 for (const row of rows.results) {
  if (!byTenant.has(row.tenant_id)) byTenant.set(row.tenant_id, await listInvoices(db, row.tenant_id));
  const invoice = byTenant.get(row.tenant_id)!.find(i => i.id === row.id);
  if (!invoice?.dueDate) { skipped++; continue; }
  const step = chaseStepForDaysOverdue(daysBetween(invoice.dueDate, todayUtc));
  // Not due a chase yet, or this many chases already went out
  // (cadence steps are sent in order; chase_count is that count).
  if (step === 0 || step <= invoice.chaseCount) { skipped++; continue; }
  const contact = await db.prepare('SELECT chase_opt_out FROM mayor_cashtext_contacts WHERE tenant_id=? AND customer_id=?')
   .bind(row.tenant_id, invoice.customerId).first<{ chase_opt_out: number }>();
  if (contact?.chase_opt_out === 1) { skipped++; continue; } // R3: opt-out stops chases absolutely
  const history = await listPreparedActions(db, row.tenant_id, ['dismissed']);
  const stepDismissed = history.some(a => a.actionClass === 'send_invoice_chase' && a.payload.invoice_id === invoice.id && a.payload.chase_step === step);
  if (stepDismissed) { skipped++; continue; } // §9.1: a dismissed chase is never re-prepared for that step
  const customer = await getCustomerById(db, row.tenant_id, invoice.customerId);
  if (!customer) { skipped++; continue; }
  const result = await prepareChaseDraft(db, { tenantId: row.tenant_id, customer, invoice, chaseStep: step, now });
  if (result.existing) skipped++; else prepared++;
 }
 return { considered: rows.results.length, prepared, skipped };
}

/* ---------------- the Friday summary (§3.6) ---------------- */

export interface FridaySummaryData {
 collectedThisWeekCents: number; collectedThisWeekCount: number; paidBy: string[];
 stillOutCents: number; stillOutCount: number; oldestOutDays: number;
 chasesWaiting: number; draftsWaiting: number;
}

export function fridaySummaryText(data: FridaySummaryData): string {
 const quiet = data.collectedThisWeekCount === 0 && data.stillOutCount === 0 && data.chasesWaiting === 0 && data.draftsWaiting === 0;
 if (quiet) return 'Friday cash summary — quiet week: nothing collected, nothing outstanding, nothing waiting on you.';
 const lines = ['Friday cash summary'];
 lines.push(data.collectedThisWeekCount
  ? `Collected this week: ${money(data.collectedThisWeekCents)} (${data.collectedThisWeekCount} payment${data.collectedThisWeekCount === 1 ? '' : 's'}${data.paidBy.length ? ` — ${data.paidBy.join(', ')}` : ''}).`
  : 'Collected this week: nothing yet.');
 if (data.stillOutCount) lines.push(`Still out: ${money(data.stillOutCents)} across ${data.stillOutCount} invoice${data.stillOutCount === 1 ? '' : 's'} (oldest ${data.oldestOutDays} day${data.oldestOutDays === 1 ? '' : 's'}).`);
 if (data.chasesWaiting || data.draftsWaiting) {
  const bits: string[] = [];
  if (data.chasesWaiting) bits.push(`${data.chasesWaiting} chase${data.chasesWaiting === 1 ? '' : 's'} to approve`);
  if (data.draftsWaiting) bits.push(`${data.draftsWaiting} draft invoice${data.draftsWaiting === 1 ? '' : 's'}`);
  lines.push(`Waiting on you: ${bits.join(', ')}.`);
 }
 return lines.join('\n');
}

export async function runCashTextFridaySummary(env: Env, now = new Date()): Promise<{ tenants: number; written: number; notified: number }> {
 const db = env.AGENT_DB;
 const tenantRows = await db.prepare('SELECT tenant_id FROM mayor_cashtext_settings UNION SELECT DISTINCT tenant_id FROM mayor_cashtext_invoices')
  .all<{ tenant_id: string }>();
 let written = 0, notified = 0;
 for (const { tenant_id: tenantId } of tenantRows.results) {
  const settings = await db.prepare('SELECT summary_enabled FROM mayor_cashtext_settings WHERE tenant_id=?').bind(tenantId).first<{ summary_enabled: number }>();
  if (settings && settings.summary_enabled === 0) continue; // the tenant turned the summary off
  const timeZone = await tenantTimezone(db, tenantId);
  const local = zonedParts(now, timeZone);
  const friday = fridayOfWeek(local.date);
  const fireAtMs = zonedMidnightUtcMs(friday, timeZone) + 17 * 3_600_000; // Friday 17:00, tenant-local
  const windowEndsMs = zonedMidnightUtcMs(dateAddDays(friday, 3), timeZone); // Monday 00:00, tenant-local
  if (now.getTime() < fireAtMs || now.getTime() >= windowEndsMs) continue;
  const existing = await db.prepare('SELECT id FROM mayor_cashtext_summaries WHERE tenant_id=? AND week_key=?').bind(tenantId, friday).first();
  if (existing) continue; // once per tenant per week — the row IS the record
  // Compile from the invoice rows only (§3.6) — never invented.
  const weekStartMs = zonedMidnightUtcMs(mondayOfWeek(local.date), timeZone);
  const invoices = await listInvoices(db, tenantId);
  const collected = invoices.filter(i => i.status === 'paid' && i.paidAt && Date.parse(i.paidAt) >= weekStartMs && Date.parse(i.paidAt) <= now.getTime());
  const paidBy: string[] = [];
  for (const inv of collected) { const c = await getCustomerById(db, tenantId, inv.customerId); if (c) paidBy.push(c.name); }
  const open = invoices.filter(i => ['sent', 'overdue'].includes(displayStatus(i, now)));
  const oldestOutDays = open.reduce((max, i) => {
   const since = i.dueDate && i.dueDate < local.date ? daysBetween(i.dueDate, local.date) : i.sentAt ? Math.floor((now.getTime() - Date.parse(i.sentAt)) / 86_400_000) : 0;
   return Math.max(max, since);
  }, 0);
  const pending = await listPreparedActions(db, tenantId, ['prepared']);
  const data: FridaySummaryData = {
   collectedThisWeekCents: collected.reduce((s, i) => s + i.amountCents, 0),
   collectedThisWeekCount: collected.length, paidBy,
   stillOutCents: open.reduce((s, i) => s + i.amountCents, 0), stillOutCount: open.length, oldestOutDays,
   chasesWaiting: pending.filter(a => a.actionClass === 'send_invoice_chase').length,
   draftsWaiting: invoices.filter(i => i.status === 'draft').length,
  };
  const text = fridaySummaryText(data);
  const inserted = await db.prepare('INSERT OR IGNORE INTO mayor_cashtext_summaries(id,tenant_id,week_key,timezone,text,summary_json,created_at) VALUES(?,?,?,?,?,?,?)')
   .bind(crypto.randomUUID(), tenantId, friday, timeZone, text, JSON.stringify(data), now.toISOString()).run();
  if (!inserted.meta.changes) continue;
  written++;
  // Email mirror — ONLY through the existing owner-email preference:
  // a notification row per eligible member, which the attention
  // cycle's queue/deliver legs turn into the preference-gated alert.
  const members = await db.prepare("SELECT user_id FROM agent_memberships WHERE tenant_id=? AND status='active' AND role IN ('owner','manager')").bind(tenantId).all<{ user_id: string }>();
  for (const m of members.results) {
   const pref = await db.prepare('SELECT enabled FROM mayor_email_preferences WHERE tenant_id=? AND user_id=?').bind(tenantId, m.user_id).first<{ enabled: number }>();
   if (pref?.enabled !== 1) continue;
   const note = await db.prepare("INSERT OR IGNORE INTO mayor_notifications(id,tenant_id,user_id,dedupe_key,kind,state,created_at,updated_at) VALUES(?,?,?,?,'cashtext_friday_summary','open',?,?)")
    .bind(crypto.randomUUID(), tenantId, m.user_id, `cashtext-friday:${friday}`, now.toISOString(), now.toISOString()).run();
   notified += note.meta.changes;
  }
 }
 return { tenants: tenantRows.results.length, written, notified };
}

/** The scheduled() entry: both legs, each isolated — a failure in
 * one never starves the other, and neither can throw into the cron. */
export async function runCashTextCadence(env: Env, now = new Date()): Promise<{ chases: unknown; summaries: unknown }> {
 const chases = await runCashTextChaseScan(env.AGENT_DB, now).catch(() => null);
 const summaries = await runCashTextFridaySummary(env, now).catch(() => null);
 return { chases, summaries };
}
