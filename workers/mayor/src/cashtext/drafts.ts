/**
 * cashtext/drafts.ts — the CashText draft state machine (integration
 * spec §3.3), shared verbatim by the talk surface and the Desk/web
 * surfaces: the same functions create, edit, dismiss, expire, and
 * re-approve drafts whichever door the owner came through.
 *
 * Lifecycle: draft → approved → sent → paid, with `overdue` derived
 * from sent past due_date (never a stored transition here), and the
 * terminal side-exits void (owner dismisses) / failed (executor
 * error, surfaced — never silent; the executor writes it).
 *
 * NOTHING about a draft touches Stripe: creation writes only the
 * mayor_cashtext_invoices row (status draft) and a mayor_prepared_
 * actions row (kind ask, class send_invoice / send_invoice_chase).
 * Stripe is the executor's job, on approval only (executor.ts).
 *
 * §10 draft-error instrument: an Edit that changes customer, amount,
 * or description — on the card verb or here — sets the invoice row's
 * draft_error flag. The edit diff itself is recorded on the prepared
 * action's payload (edit_history), field by field.
 */
import type {PreparedAction} from '../engine/types';
import {insertPreparedAction, listPreparedActions, updatePreparedActionPayload} from '../engine/store';
import {getCustomerById, money, type CashTextCustomer} from './talk';

export interface CashTextInvoice {
 id: string; tenantId: string; customerId: string;
 stripeCustomerId: string | null; stripeInvoiceId: string | null;
 description: string; amountCents: number; currency: string;
 status: 'draft' | 'approved' | 'sent' | 'paid' | 'overdue' | 'void' | 'failed';
 dueDate: string | null; preparedActionId: string | null; idempotencyKey: string;
 hostedInvoiceUrl: string | null; sentAt: string | null; paidAt: string | null;
 chaseCount: number; lastChaseAt: string | null; draftError: boolean;
 createdAt: string; updatedAt: string;
}

type InvoiceRow = Record<string, unknown>;
const rowToInvoice = (r: InvoiceRow): CashTextInvoice => ({
 id: r.id as string, tenantId: r.tenant_id as string, customerId: r.customer_id as string,
 stripeCustomerId: (r.stripe_customer_id as string) ?? null, stripeInvoiceId: (r.stripe_invoice_id as string) ?? null,
 description: r.description as string, amountCents: r.amount_cents as number, currency: r.currency as string,
 status: r.status as CashTextInvoice['status'], dueDate: (r.due_date as string) ?? null,
 preparedActionId: (r.prepared_action_id as string) ?? null, idempotencyKey: r.idempotency_key as string,
 hostedInvoiceUrl: (r.hosted_invoice_url as string) ?? null, sentAt: (r.sent_at as string) ?? null,
 paidAt: (r.paid_at as string) ?? null, chaseCount: r.chase_count as number,
 lastChaseAt: (r.last_chase_at as string) ?? null, draftError: (r.draft_error as number) === 1,
 createdAt: r.created_at as string, updatedAt: r.updated_at as string,
});

export async function getInvoice(db: D1Database, tenantId: string, invoiceId: string): Promise<CashTextInvoice | null> {
 const row = await db.prepare('SELECT * FROM mayor_cashtext_invoices WHERE tenant_id=? AND id=?').bind(tenantId, invoiceId).first<InvoiceRow>();
 return row ? rowToInvoice(row) : null;
}

export async function listInvoices(db: D1Database, tenantId: string, statuses?: CashTextInvoice['status'][]): Promise<CashTextInvoice[]> {
 const rows = statuses?.length
  ? await db.prepare(`SELECT * FROM mayor_cashtext_invoices WHERE tenant_id=? AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY created_at ASC`).bind(tenantId, ...statuses).all<InvoiceRow>()
  : await db.prepare('SELECT * FROM mayor_cashtext_invoices WHERE tenant_id=? ORDER BY created_at ASC').bind(tenantId).all<InvoiceRow>();
 return rows.results.map(rowToInvoice);
}

/** The derived status the owner sees: a stored `sent` past its due
 * date READS as overdue; the stored row is untouched (§3.3). */
export function displayStatus(invoice: CashTextInvoice, now = new Date()): CashTextInvoice['status'] {
 if (invoice.status === 'sent' && invoice.dueDate && invoice.dueDate < now.toISOString().slice(0, 10)) return 'overdue';
 return invoice.status;
}

export const DEFAULT_DAYS_UNTIL_DUE = 7;

export function invoiceSummary(customerName: string, amountCents: number, description: string): string {
 return `Invoice ${customerName} — ${money(amountCents)}${description ? ` for ${description}` : ''}. Nothing sent yet.`;
}

export function chaseSummary(customerName: string, invoice: CashTextInvoice): string {
 return `Chase ${customerName} — ${money(invoice.amountCents)}${invoice.description ? ` for ${invoice.description}` : ''} still open. Nothing sent yet.`;
}

/** The default polite chase text (Phase 4's cadence prepares the same
 * shape). It is a DRAFT the owner approves — and, per the Phase 2
 * footer verdict, on approval it is shown back to the owner as a
 * copy-paste draft while Stripe re-sends the original invoice (the
 * fallback is disclosed in the executor's reply, never silent). */
export function defaultChaseText(customer: CashTextCustomer, invoice: CashTextInvoice): string {
 return `Hi ${customer.name.split(' ')[0]}, a friendly reminder that your invoice of ${money(invoice.amountCents)}${invoice.description ? ` for ${invoice.description}` : ''} is still open${invoice.dueDate ? ` (due ${invoice.dueDate})` : ''}. ${invoice.hostedInvoiceUrl ? `You can pay it here: ${invoice.hostedInvoiceUrl} ` : ''}Thanks so much!`;
}

/** Create a draft invoice + its ask card. Writes NO Stripe object.
 * The invoice's idempotency_key is its own id (UNIQUE per tenant), so
 * a replayed creation can never mint a second row for the same draft. */
export async function prepareInvoiceDraft(db: D1Database, input: {
 tenantId: string; customer: CashTextCustomer; amountCents: number; description?: string;
 daysUntilDue?: number; now?: Date;
}): Promise<{ invoice: CashTextInvoice; action: PreparedAction }> {
 const now = input.now ?? new Date();
 const nowIso = now.toISOString();
 const days = input.daysUntilDue ?? DEFAULT_DAYS_UNTIL_DUE;
 const dueDate = new Date(now.getTime() + days * 86400_000).toISOString().slice(0, 10);
 const description = (input.description ?? '').trim();
 const id = crypto.randomUUID();
 await db.prepare(`INSERT INTO mayor_cashtext_invoices(id,tenant_id,customer_id,description,amount_cents,currency,status,due_date,idempotency_key,created_at,updated_at)
  VALUES(?,?,?,?,?,'usd','draft',?,?,?,?)`)
  .bind(id, input.tenantId, input.customer.id, description, input.amountCents, dueDate, id, nowIso, nowIso).run();
 const action = await insertPreparedAction(db, {
  tenantId: input.tenantId, kind: 'ask', actionClass: 'send_invoice',
  targetPerson: input.customer.name, channel: 'email',
  payload: { invoice_id: id, customer_id: input.customer.id, customer_name: input.customer.name, amount_cents: input.amountCents, description, days_until_due: days, due_date: dueDate, text: `Invoice for ${input.customer.name} — ${money(input.amountCents)}${description ? ` for ${description}` : ''}. Due ${dueDate}.`, edit_hint: 'Change a field — e.g. "amount: 450", "description: Water heater install", or "days_until_due: 14".' },
  payloadSummary: invoiceSummary(input.customer.name, input.amountCents, description),
  grantId: null, grantVersion: null, predicateFired: null, decisionId: null, nearBoundary: false,
  reversibility: null, expiresAt: new Date(now.getTime() + 24 * 3600_000).toISOString(),
 });
 await db.prepare('UPDATE mayor_cashtext_invoices SET prepared_action_id=?,updated_at=? WHERE tenant_id=? AND id=?').bind(action.id, nowIso, input.tenantId, id).run();
 const invoice = await getInvoice(db, input.tenantId, id);
 return { invoice: invoice!, action };
}

/** Prepare a chase for an open invoice (Phase 4's cadence calls this;
 * Phase 3's talk surface calls it for "chase Maria"). One unapproved
 * chase per invoice at a time — a second preparation while one waits
 * returns the waiting one, never a duplicate card. */
export async function prepareChaseDraft(db: D1Database, input: {
 tenantId: string; customer: CashTextCustomer; invoice: CashTextInvoice; chaseText?: string; now?: Date;
}): Promise<{ action: PreparedAction; existing: boolean }> {
 const pending = await listPreparedActions(db, input.tenantId, ['prepared']);
 const existing = pending.find(a => a.actionClass === 'send_invoice_chase' && a.payload.invoice_id === input.invoice.id);
 if (existing) return { action: existing, existing: true };
 const now = input.now ?? new Date();
 const action = await insertPreparedAction(db, {
  tenantId: input.tenantId, kind: 'ask', actionClass: 'send_invoice_chase',
  targetPerson: input.customer.name, channel: 'email',
  payload: { invoice_id: input.invoice.id, customer_id: input.customer.id, customer_name: input.customer.name, amount_cents: input.invoice.amountCents, chase_text: input.chaseText ?? defaultChaseText(input.customer, input.invoice), text: input.chaseText ?? defaultChaseText(input.customer, input.invoice), edit_hint: 'Rewrite the reminder in your own words.' },
  payloadSummary: chaseSummary(input.customer.name, input.invoice),
  grantId: null, grantVersion: null, predicateFired: null, decisionId: null, nearBoundary: false,
  reversibility: null, expiresAt: new Date(now.getTime() + 24 * 3600_000).toISOString(),
 });
 return { action, existing: false };
}

/** Dismiss voids a draft invoice (spec §3.3). A dismissed CHASE voids
 * nothing — the invoice stays open and chase-eligible later. */
export async function voidInvoiceForAction(db: D1Database, tenantId: string, action: PreparedAction): Promise<void> {
 if (action.actionClass !== 'send_invoice') return;
 const invoiceId = action.payload.invoice_id as string | undefined;
 if (!invoiceId) return;
 await db.prepare("UPDATE mayor_cashtext_invoices SET status='void',updated_at=? WHERE tenant_id=? AND id=? AND status IN ('draft','approved')")
  .bind(new Date().toISOString(), tenantId, invoiceId).run();
}

/** Re-approval after expiry (or after a failed send): the invoice —
 * status draft, or approved-but-unsent — gets a FRESH prepared action.
 * A retry is always a new card, never a silent re-send (§3.3). If a
 * card is already waiting, it is returned instead of duplicated. */
export async function reapproveInvoice(db: D1Database, tenantId: string, invoiceId: string, now = new Date()): Promise<{ invoice: CashTextInvoice; action: PreparedAction } | null> {
 const invoice = await getInvoice(db, tenantId, invoiceId);
 if (!invoice || !['draft', 'approved'].includes(invoice.status)) return null;
 const pending = await listPreparedActions(db, tenantId, ['prepared']);
 const existing = pending.find(a => a.actionClass === 'send_invoice' && a.payload.invoice_id === invoiceId);
 if (existing) return { invoice, action: existing };
 const customer = await getCustomerById(db, tenantId, invoice.customerId);
 if (!customer) return null;
 const days = invoice.dueDate ? Math.max(0, Math.round((Date.parse(invoice.dueDate) - now.getTime()) / 86400_000)) : DEFAULT_DAYS_UNTIL_DUE;
 const action = await insertPreparedAction(db, {
  tenantId, kind: 'ask', actionClass: 'send_invoice',
  targetPerson: customer.name, channel: 'email',
  payload: { invoice_id: invoice.id, customer_id: customer.id, customer_name: customer.name, amount_cents: invoice.amountCents, description: invoice.description, days_until_due: days, due_date: invoice.dueDate, text: `Invoice for ${customer.name} — ${money(invoice.amountCents)}${invoice.description ? ` for ${invoice.description}` : ''}. Due ${invoice.dueDate ?? ''}.`, edit_hint: 'Change a field — e.g. "amount: 450", "description: Water heater install", or "days_until_due: 14".' },
  payloadSummary: invoiceSummary(customer.name, invoice.amountCents, invoice.description),
  grantId: null, grantVersion: null, predicateFired: null, decisionId: null, nearBoundary: false,
  reversibility: null, expiresAt: new Date(now.getTime() + 24 * 3600_000).toISOString(),
 });
 await db.prepare('UPDATE mayor_cashtext_invoices SET prepared_action_id=?,updated_at=? WHERE tenant_id=? AND id=?').bind(action.id, now.toISOString(), tenantId, invoiceId).run();
 return { invoice: (await getInvoice(db, tenantId, invoiceId))!, action };
}

/* ---------------- Edit (the §10 instrument) ---------------- */

export interface CashTextEditResult {
 changedFields: string[];
 /** True when customer, amount, or description changed — the §10
  * definition of a draft error; the invoice flag is set here. */
 draftError: boolean;
 summary: string;
}

/** Parse an edit body: a JSON object, or `field: value` lines.
 * Fields: amount (dollars) / amount_cents, description, customer_id,
 * days_until_due, due_date — and for chase cards, chase_text (a
 * plain non-JSON body on a chase card IS the new chase text). */
export function parseCashTextEdit(action: PreparedAction, editText: string): Record<string, unknown> | null {
 const text = editText.trim();
 if (!text) return null;
 try {
  const parsed = JSON.parse(text) as unknown;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
 } catch { /* fall through to line form */ }
 if (action.actionClass === 'send_invoice_chase' && !/^[a-z_]+:/i.test(text)) return { chase_text: text };
 const out: Record<string, unknown> = {};
 for (const line of text.split(/[;\n]/)) {
  const m = line.match(/^\s*([a-z_ ]+)\s*:\s*(.+)$/i);
  if (m) out[m[1].trim().toLowerCase().replace(/\s+/g, '_')] = m[2].trim();
 }
 return Object.keys(out).length ? out : null;
}

/** Apply an edit to a cashtext prepared action: update the payload,
 * mirror the invoice row, record the field-level diff on the payload
 * (edit_history), and set draft_error per §10 when a drafting field
 * (customer / amount / description) changed. */
export async function applyCashTextEdit(db: D1Database, tenantId: string, action: PreparedAction, editText: string): Promise<CashTextEditResult | null> {
 const edit = parseCashTextEdit(action, editText);
 if (!edit) return null;
 const payload: Record<string, unknown> = { ...action.payload };
 const changed: string[] = [];
 const setField = (field: string, value: unknown) => {
  if (payload[field] !== value) { payload[field] = value; changed.push(field); }
 };

 if (action.actionClass === 'send_invoice_chase') {
  if (typeof edit.chase_text === 'string' && edit.chase_text.trim()) setField('chase_text', edit.chase_text.trim());
  if (!changed.length) return { changedFields: [], draftError: false, summary: action.payloadSummary };
  payload.edit_history = [...((payload.edit_history as unknown[]) ?? []), { at: new Date().toISOString(), changedFields: changed, edit }];
  await updatePreparedActionPayload(db, tenantId, action.id, payload);
  return { changedFields: changed, draftError: false, summary: action.payloadSummary };
 }

 // send_invoice: resolve the field-level changes.
 let newCustomer: CashTextCustomer | null = null;
 const customerId = (edit.customer_id ?? edit.customerId) as string | undefined;
 if (customerId && customerId !== payload.customer_id) {
  newCustomer = await getCustomerById(db, tenantId, customerId);
  if (!newCustomer) return null;
 }
 let amountCents = payload.amount_cents as number;
 if (edit.amount_cents !== undefined || edit.amountCents !== undefined) {
  const v = Number(edit.amount_cents ?? edit.amountCents);
  if (Number.isSafeInteger(v) && v > 0) amountCents = v;
 } else if (edit.amount !== undefined) {
  const v = Math.round(Number(String(edit.amount).replace(/[$,]/g, '')) * 100);
  if (Number.isSafeInteger(v) && v > 0) amountCents = v;
 }
 if (amountCents !== payload.amount_cents) setField('amount_cents', amountCents);
 if (typeof edit.description === 'string' && edit.description.trim() !== payload.description) setField('description', edit.description.trim());
 if (newCustomer) { setField('customer_id', newCustomer.id); payload.customer_name = newCustomer.name; }
 if (edit.days_until_due !== undefined) { const v = Number(edit.days_until_due); if (Number.isSafeInteger(v) && v >= 0) setField('days_until_due', v); }
 if (typeof edit.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(edit.due_date)) setField('due_date', edit.due_date);

 const draftErrorFields = changed.filter(f => ['customer_id', 'amount_cents', 'description'].includes(f));
 const summary = invoiceSummary((payload.customer_name as string) ?? action.targetPerson ?? 'customer', payload.amount_cents as number, (payload.description as string) ?? '');
 payload.edit_history = [...((payload.edit_history as unknown[]) ?? []), { at: new Date().toISOString(), changedFields: changed, edit }];
 await updatePreparedActionPayload(db, tenantId, action.id, payload);
 // The card's headline is the row's payload_summary — keep it honest
 // after an edit, or the Desk would render the pre-edit draft.
 if (changed.length) await db.prepare('UPDATE mayor_prepared_actions SET payload_summary=?,updated_at=? WHERE tenant_id=? AND id=?').bind(summary, new Date().toISOString(), tenantId, action.id).run();
 // Mirror the invoice row (the executor reads the row, not the card).
 const invoiceId = payload.invoice_id as string | undefined;
 if (invoiceId && changed.length) {
  await db.prepare(`UPDATE mayor_cashtext_invoices SET customer_id=?,amount_cents=?,description=?,due_date=?,
   draft_error=CASE WHEN ? THEN 1 ELSE draft_error END,updated_at=? WHERE tenant_id=? AND id=?`)
   .bind(payload.customer_id, payload.amount_cents, payload.description ?? '', payload.due_date ?? null,
    draftErrorFields.length ? 1 : 0, new Date().toISOString(), tenantId, invoiceId).run();
 }
 return { changedFields: changed, draftError: draftErrorFields.length > 0, summary };
}

/* ---------------- talk reads: who-owes + cash summary (§3.1/§3.6) -------- */

export interface CashSummary {
 collectedThisWeekCents: number; collectedThisWeekCount: number;
 stillOutCents: number; stillOutCount: number;
 draftsWaiting: number; chasesWaiting: number;
}

export async function cashSummary(db: D1Database, tenantId: string, now = new Date()): Promise<CashSummary> {
 const invoices = await listInvoices(db, tenantId);
 const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
 const paidThisWeek = invoices.filter(i => i.status === 'paid' && i.paidAt && Date.parse(i.paidAt) >= monday.getTime());
 const open = invoices.filter(i => ['sent', 'overdue'].includes(displayStatus(i, now)));
 const pending = await listPreparedActions(db, tenantId, ['prepared']);
 return {
  collectedThisWeekCents: paidThisWeek.reduce((s, i) => s + i.amountCents, 0),
  collectedThisWeekCount: paidThisWeek.length,
  stillOutCents: open.reduce((s, i) => s + i.amountCents, 0),
  stillOutCount: open.length,
  draftsWaiting: invoices.filter(i => i.status === 'draft').length,
  chasesWaiting: pending.filter(a => a.actionClass === 'send_invoice_chase').length,
 };
}
