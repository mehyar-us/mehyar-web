import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,expect,it} from 'vitest';
import type {Actor,Env} from '../../src/env';
import type {BillingEnv,StripeObject} from '../../src/billing/stripe';
import {StripeClient} from '../../src/billing/stripe';
import {applyActionVerb,applyCashTextReapprove,runOwnerTurn,type EngineDeps} from '../../src/engine/loop';
import {unavailableDecideProvider,type DecideProvider} from '../../src/engine/decide';
import * as store from '../../src/engine/store';
import {buildEngineDeskIntents} from '../../src/engine/surface';
import {executeCashTextSend,CASHTEXT_INVOICE_FOOTER,CASHTEXT_SEND_FAILURE_LINE} from '../../src/cashtext/executor';
import {getInvoice,listInvoices,reapproveInvoice} from '../../src/cashtext/drafts';

/* Phase 3 proof battery (integration spec §6 items 3 + 5, Miniflare/D1):
 * the draft lifecycle (parse/resolve/ambiguity/email-missing/edit-diff/
 * dismiss/expiry), the executor against an injected transport (exactly
 * one /send + one action-log row; the UNIQUE claim fence; transport-500
 * discipline), and the NEVER_LIVE grant fence end-to-end — plus
 * cross-tenant bleed on the new surfaces.
 * Classes, stated exactly: injected transport (FakeStripe) — Connect is
 * not enabled on the platform account (Phase 2 report §3), so no
 * real-Connect class exists for this phase and none is claimed. */
const E = testEnv as unknown as Env;
/* mayor_cashtext_settings.stripe_account_id is UNIQUE across tenants,
 * so each seeded tenant gets its own deterministic connected account. */
const accountFor = (t: string) => `acct_tenant${t.slice(0, 12)}`;
let n = 0;
const tenantId = () => (++n).toString(16).padStart(4, 'a').padEnd(32, 'f').slice(0, 32);
const actorFor = (t: string): Actor => ({ tenantId: t, userId: `user-${t.slice(0, 6)}` });

class FakeStripe extends StripeClient {
 invoices = new Map<string, StripeObject>(); customers = new Map<string, StripeObject>();
 calls: Array<{ path: string; method: string; body?: Record<string, unknown>; key?: string; stripeAccount?: string }> = [];
 failSend = false;
 constructor() { super('sk_test_fixture'); }
 async request(path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: Record<string, unknown>, key?: string, options?: { stripeAccount?: string }) {
  this.calls.push({ path, method, body, key, stripeAccount: options?.stripeAccount });
  const normalized = path.split('?')[0];
  if (method === 'POST' && path === '/v1/customers') { const id = `cus_${crypto.randomUUID().replaceAll('-', '')}`; const o: StripeObject = { id, livemode: false, email: body?.email }; this.customers.set(id, o); return structuredClone(o); }
  if (method === 'POST' && path === '/v1/invoices') { const id = `in_${crypto.randomUUID().replaceAll('-', '')}`; const o: StripeObject = { id, livemode: false, object: 'invoice', customer: body?.customer, status: 'draft', collection_method: body?.collection_method, days_until_due: body?.days_until_due, footer: body?.footer ?? null, description: body?.description ?? null, total: 0 }; this.invoices.set(id, o); return structuredClone(o); }
  if (method === 'POST' && path === '/v1/invoiceitems') { const inv = this.invoices.get(String(body?.invoice)); if (inv) inv.total += Number(body?.amount ?? 0); return { id: `ii_${crypto.randomUUID().replaceAll('-', '')}`, livemode: false }; }
  if (method === 'GET' && normalized.startsWith('/v1/invoices/')) { const inv = this.invoices.get(normalized.slice('/v1/invoices/'.length)); if (!inv) throw new Error(`Fixture missing: ${normalized}`); return structuredClone(inv); }
  if (method === 'POST' && normalized.startsWith('/v1/invoices/')) {
   const inv = this.invoices.get(normalized.slice('/v1/invoices/'.length).split('/')[0]); if (!inv) throw new Error(`Fixture missing: ${normalized}`);
   if (normalized.endsWith('/finalize')) inv.status = 'open';
   else if (normalized.endsWith('/send')) { if (this.failSend) throw new Error('transport 500'); inv.hosted_invoice_url = `https://invoice.stripe.com/i/${inv.id}`; }
   else Object.assign(inv, body);
   return structuredClone(inv);
  }
  throw new Error(`Fixture missing: ${method} ${path}`);
 }
 sendCalls() { return this.calls.filter(c => c.path.endsWith('/send')); }
}

let provider: FakeStripe;
function billingEnv(): BillingEnv {
 return { ...E, MAYOR_STRIPE_MODE: 'test', MAYOR_STRIPE_SECRET_KEY: 'sk_test_fixture', MAYOR_STRIPE_WEBHOOK_SECRET: 'whsec_fixture', MAYOR_STRIPE_ACCOUNT_ID: 'acct_platformfixture' } as BillingEnv;
}
function deps(over: Partial<EngineDeps> = {}): EngineDeps {
 let tick = 0; const base = new Date('2026-10-23T15:00:00.000Z').getTime();
 return { db: E.AGENT_DB, decideProvider: unavailableDecideProvider, calendarProbe: async () => ({ connected: true, detail: 'ok' }), now: () => new Date(base + (tick++) * 61_000), billingEnv: billingEnv(), stripeClient: provider as unknown as StripeClient, ...over };
}
async function seedTenant(t: string, connect = true) {
 const now = new Date().toISOString();
 await E.AGENT_DB.prepare('INSERT OR IGNORE INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(t, 'CashText Shop', now).run();
 await E.AGENT_DB.prepare("INSERT OR IGNORE INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(t, `user-${t.slice(0, 6)}`).run();
 const s = await store.getEngineState(E.AGENT_DB, t, { costCeilingMicrocents: 2_500_000_000 }); s.mode = 'talk'; await store.saveEngineState(E.AGENT_DB, s);
 if (connect) await E.AGENT_DB.prepare("INSERT INTO mayor_cashtext_settings(tenant_id,stripe_account_id,account_status,charges_enabled,payouts_enabled,created_at,updated_at) VALUES(?,?,'active',1,1,?,?)").bind(t, accountFor(t), now, now).run();
}
async function seedCustomer(t: string, name: string, email: string | null) {
 const id = crypto.randomUUID(), now = new Date().toISOString();
 // mayor_customers requires at least one contact method (0019 CHECK):
 // a customer "without an email" is a phone-only customer in real data.
 await E.AGENT_DB.prepare('INSERT INTO mayor_customers(id,tenant_id,name,name_key,email,phone,confirmed_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .bind(id, t, name, name.toLowerCase(), email, email ? null : '+15551234567', actorFor(t).userId, now, now).run();
 return id;
}
async function seedSentInvoice(t: string, customerId: string, over: Partial<{ amount: number; description: string; status: string; due: string }> = {}) {
 const id = crypto.randomUUID(), now = new Date().toISOString();
 await E.AGENT_DB.prepare("INSERT INTO mayor_cashtext_invoices(id,tenant_id,customer_id,stripe_customer_id,stripe_invoice_id,description,amount_cents,status,due_date,idempotency_key,hosted_invoice_url,sent_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
  .bind(id, t, customerId, 'cus_fixture', `in_${id.replaceAll('-', '')}`, over.description ?? 'Water heater install', over.amount ?? 40000, over.status ?? 'sent', over.due ?? '2026-10-30', id, 'https://invoice.stripe.com/i/fixture', now, now, now).run();
 return id;
}
const turn = (d: EngineDeps, a: Actor, text: string) => runOwnerTurn(d, a, { text, idempotencyKey: crypto.randomUUID() });
async function draftViaTalk(d: EngineDeps, a: Actor, text = 'invoice Maria $400') {
 const s = await turn(d, a, text);
 const card = s.intents.find(i => i.type === 'action-card') as { actionId?: string } | undefined;
 expect(card?.actionId).toBeTruthy();
 return { surface: s, actionId: card!.actionId! };
}
beforeEach(() => { provider = new FakeStripe(); });

it('draft lifecycle: "invoice Maria $400" writes the invoice row (draft) + an ask card (send_invoice) — and touches Stripe ZERO times', async () => {
 const t = tenantId(), a = actorFor(t), d = deps(); await seedTenant(t); await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 const { surface, actionId } = await draftViaTalk(d, a);
 expect(surface.intents.find(i => i.type === 'action-card')).toMatchObject({ summary: 'Invoice Maria Lopez — $400. Nothing sent yet.' });
 const invoices = await listInvoices(E.AGENT_DB, t); expect(invoices).toHaveLength(1);
 expect(invoices[0]).toMatchObject({ status: 'draft', amountCents: 40000, preparedActionId: actionId });
 const action = await store.getPreparedAction(E.AGENT_DB, t, actionId);
 expect(action).toMatchObject({ kind: 'ask', actionClass: 'send_invoice', status: 'prepared' });
 expect(provider.calls).toHaveLength(0);
 // The Desk renders the same card (same state machine, web surface).
 const desk = await buildEngineDeskIntents(E.AGENT_DB, t);
 expect(desk.some(i => i.type === 'action-card' && i.actionId === actionId)).toBe(true);
});

it('draft lifecycle: description form, no-match ask, two-match ambiguity, missing amount, and missing email — each asks and drafts NOTHING', async () => {
 const t = tenantId(), a = actorFor(t), d = deps(); await seedTenant(t);
 await seedCustomer(t, 'Maria Lopez', 'maria@example.com'); await seedCustomer(t, 'Maria Chen', 'chen@example.com');
 await seedCustomer(t, 'Noemail Ned', null);
 // Two Marias -> ambiguity names both, no draft.
 let s = await turn(d, a, 'invoice Maria $400');
 expect(s.lines.join(' ')).toContain('Maria Lopez'); expect(s.lines.join(' ')).toContain('Maria Chen');
 expect(await listInvoices(E.AGENT_DB, t)).toHaveLength(0);
 // Full name + description form resolves.
 s = await turn(d, a, 'invoice Maria Lopez 400 for the water heater');
 expect(s.intents.some(i => i.type === 'action-card')).toBe(true);
 const inv = (await listInvoices(E.AGENT_DB, t))[0]; expect(inv.description).toBe('the water heater'); expect(inv.amountCents).toBe(40000);
 // No match -> ask, no draft.
 s = await turn(d, a, 'invoice Pedro $100'); expect(s.lines.join(' ')).toContain("don't have a customer named Pedro");
 // Missing amount -> ask, no draft.
 s = await turn(d, a, 'invoice Maria Chen'); expect(s.lines.join(' ')).toContain('How much should I invoice Maria Chen');
 // Missing email -> draft stops, email asked for, never guessed.
 s = await turn(d, a, 'invoice Noemail Ned $50'); expect(s.lines.join(' ')).toContain("doesn't have an email on file");
 expect(await listInvoices(E.AGENT_DB, t)).toHaveLength(1); // only the Maria Lopez draft exists
 expect(provider.calls).toHaveLength(0);
});

it('talk reads: who-owes lists open invoices with totals; cash summary compiles collected/still-out/drafts from the rows only', async () => {
 const t = tenantId(), a = actorFor(t), d = deps(); await seedTenant(t);
 const maria = await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 await seedSentInvoice(t, maria, {});
 const paidId = crypto.randomUUID(), now = new Date().toISOString();
 await E.AGENT_DB.prepare("INSERT INTO mayor_cashtext_invoices(id,tenant_id,customer_id,description,amount_cents,status,idempotency_key,paid_at,created_at,updated_at) VALUES(?,?,?, 'Sink repair',15000,'paid',?,?,?,?)").bind(paidId, t, maria, paidId, now, now, now).run();
 await draftViaTalk(d, a, 'invoice Maria Lopez $25');
 let s = await turn(d, a, 'who owes me?');
 expect(s.lines.join(' ')).toContain('Maria Lopez owes $400'); expect(s.lines.join(' ')).toContain('Total still out: $400');
 s = await turn(d, a, 'cash summary');
 expect(s.lines.join(' ')).toContain('collected $150 this week (1 paid)');
 expect(s.lines.join(' ')).toContain('Still out: $400 across 1 open invoice');
 expect(s.lines.join(' ')).toContain('1 draft waiting');
});

it('executor (§6.3): approve -> exactly one /send, one action-log row, footer at creation, every call on the connected account', async () => {
 const t = tenantId(), a = actorFor(t), d = deps(); await seedTenant(t); await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 const { actionId } = await draftViaTalk(d, a);
 const s = await applyActionVerb(d, a, actionId, 'approve');
 expect(s.lines.join(' ')).toContain('Sent — Maria Lopez\'s invoice for $400 is on its way from your Stripe account.');
 expect(provider.sendCalls()).toHaveLength(1);
 for (const call of provider.calls) { expect(call.stripeAccount).toBe(accountFor(t)); expect(call.key).toMatch(/^mayor-pwa:cashtext-/); }
 const create = provider.calls.find(c => c.path === '/v1/invoices')!;
 expect(create.body).toMatchObject({ collection_method: 'send_invoice', days_until_due: 7, footer: CASHTEXT_INVOICE_FOOTER });
 const paths = provider.calls.map(c => c.path);
 expect(paths.indexOf('/v1/invoices')).toBeLessThan(paths.findIndex(p => p.endsWith('/finalize')));
 expect(paths.findIndex(p => p.endsWith('/finalize'))).toBeLessThan(paths.findIndex(p => p.endsWith('/send')));
 const invoice = (await listInvoices(E.AGENT_DB, t))[0];
 expect(invoice.status).toBe('sent'); expect(invoice.hostedInvoiceUrl).toContain('invoice.stripe.com'); expect(invoice.sentAt).toBeTruthy(); expect(invoice.stripeCustomerId).toBeTruthy();
 const log = await E.AGENT_DB.prepare("SELECT * FROM mayor_action_log WHERE tenant_id=? AND action_key=?").bind(t, `cashtext-send:${actionId}`).all<any>();
 expect(log.results).toHaveLength(1); expect(log.results[0].verification_result).toMatch(/^sent:/); expect(log.results[0].kind).toBe('executed');
});

it('executor fence: approve twice + replay the executor directly -> the UNIQUE claim makes both no-ops (still one /send, one log row)', async () => {
 const t = tenantId(), a = actorFor(t), d = deps(); await seedTenant(t); await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 const { actionId } = await draftViaTalk(d, a);
 await applyActionVerb(d, a, actionId, 'approve');
 const second = await applyActionVerb(d, a, actionId, 'approve');
 expect(second.lines.join(' ')).toContain('already settled');
 const action = await store.getPreparedAction(E.AGENT_DB, t, actionId);
 const replay = await executeCashTextSend({ db: E.AGENT_DB, env: billingEnv(), tenantId: t, action: action!, injected: provider as unknown as StripeClient });
 expect(replay.outcome).toBe('already_sent');
 expect(provider.sendCalls()).toHaveLength(1);
 const log = await E.AGENT_DB.prepare("SELECT * FROM mayor_action_log WHERE tenant_id=? AND action_key LIKE 'cashtext-send:%'").bind(t).all<any>();
 expect(log.results).toHaveLength(1);
});

it('executor: dismiss -> zero Stripe calls and the draft is void', async () => {
 const t = tenantId(), a = actorFor(t), d = deps(); await seedTenant(t); await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 const { actionId } = await draftViaTalk(d, a);
 const s = await applyActionVerb(d, a, actionId, 'dismiss');
 expect(s.lines.join(' ')).toContain('voided');
 expect(provider.calls).toHaveLength(0);
 expect((await listInvoices(E.AGENT_DB, t))[0].status).toBe('void');
});

it('executor: transport 500 -> invoice stays approved, the plain owner line surfaces, no partial state; retry is a NEW prepared action', async () => {
 const t = tenantId(), a = actorFor(t), d = deps(); await seedTenant(t); await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 const { actionId } = await draftViaTalk(d, a);
 provider.failSend = true;
 const s = await applyActionVerb(d, a, actionId, 'approve');
 expect(s.lines.join(' ')).toContain(CASHTEXT_SEND_FAILURE_LINE);
 let invoice = (await listInvoices(E.AGENT_DB, t))[0];
 expect(invoice.status).toBe('approved'); expect(invoice.sentAt).toBeNull(); expect(invoice.hostedInvoiceUrl).toBeNull();
 const log = await E.AGENT_DB.prepare("SELECT * FROM mayor_action_log WHERE tenant_id=? AND action_key=?").bind(t, `cashtext-send:${actionId}`).first<any>();
 expect(log.verification_result).toBe('failed');
 // Retry: a NEW card (the old action is settled), which then sends.
 provider.failSend = false;
 const re = await reapproveInvoice(E.AGENT_DB, t, invoice.id); expect(re).toBeTruthy(); expect(re!.action.id).not.toBe(actionId);
 const s2 = await applyActionVerb(d, a, re!.action.id, 'approve');
 expect(s2.lines.join(' ')).toContain('Sent —');
 invoice = (await listInvoices(E.AGENT_DB, t))[0]; expect(invoice.status).toBe('sent');
 // The Stripe invoice created by the failed attempt was RESUMED (one
 // invoice POST total) — a retry never mints a duplicate invoice.
 expect(provider.calls.filter(c => c.path === '/v1/invoices' && c.method === 'POST')).toHaveLength(1);
});

it('edit (§10 instrument): field diff recorded, invoice mirrored, draft_error set on drafting fields only', async () => {
 const t = tenantId(), a = actorFor(t), d = deps(); await seedTenant(t); await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 const { actionId } = await draftViaTalk(d, a);
 const s = await applyActionVerb(d, a, actionId, 'edit', '{"amount_cents":45000,"description":"Water heater install"}');
 expect(s.lines.join(' ')).toContain('changed: amount_cents, description');
 const action = await store.getPreparedAction(E.AGENT_DB, t, actionId);
 expect(action!.payload.amount_cents).toBe(45000);
 const history = action!.payload.edit_history as Array<{ changedFields: string[] }>;
 expect(history).toHaveLength(1); expect(history[0].changedFields).toEqual(['amount_cents', 'description']);
 expect(action!.payloadSummary).toBe('Invoice Maria Lopez — $450 for Water heater install. Nothing sent yet.');
 const invoice = (await listInvoices(E.AGENT_DB, t))[0];
 expect(invoice.amountCents).toBe(45000); expect(invoice.description).toBe('Water heater install'); expect(invoice.draftError).toBe(true);
 // A non-drafting edit (due days) on a fresh draft does NOT trip the flag.
 const t2 = tenantId(), a2 = actorFor(t2), d2 = deps(); await seedTenant(t2); await seedCustomer(t2, 'Maria Lopez', 'maria@example.com');
 const draft2 = await draftViaTalk(d2, a2);
 await applyActionVerb(d2, a2, draft2.actionId, 'edit', '{"days_until_due":14}');
 expect((await listInvoices(E.AGENT_DB, t2))[0].draftError).toBe(false);
});

it('expiry: an expired card leaves the invoice draft listed on the Desk (invoice-card) and re-approvable with a fresh card', async () => {
 const t = tenantId(), a = actorFor(t), d = deps(); await seedTenant(t); await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 const { actionId } = await draftViaTalk(d, a);
 await E.AGENT_DB.prepare("UPDATE mayor_prepared_actions SET status='expired' WHERE tenant_id=? AND id=?").bind(t, actionId).run();
 const invoice = (await listInvoices(E.AGENT_DB, t))[0]; expect(invoice.status).toBe('draft'); // expiry never voids the draft
 const desk = await buildEngineDeskIntents(E.AGENT_DB, t);
 const card = desk.find(i => i.type === 'invoice-card') as { invoiceId?: string; reapprovable?: boolean } | undefined;
 expect(card?.invoiceId).toBe(invoice.id); expect(card?.reapprovable).toBe(true);
 const s = await applyCashTextReapprove(d, a, invoice.id);
 const newCard = s.intents.find(i => i.type === 'action-card') as { actionId?: string } | undefined;
 expect(newCard?.actionId).toBeTruthy(); expect(newCard!.actionId).not.toBe(actionId);
 const sent = await applyActionVerb(d, a, newCard!.actionId!, 'approve');
 expect(sent.lines.join(' ')).toContain('Sent —');
});

it('chase talk + executor: "chase Maria" drafts a send_invoice_chase; approval re-sends ONLY, and the approved text returns as a disclosed copy-paste draft (rider 1 fallback)', async () => {
 const t = tenantId(), a = actorFor(t), d = deps(); await seedTenant(t);
 const maria = await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 const invoiceId = await seedSentInvoice(t, maria, {});
 // The seeded row's Stripe invoice must exist in the fake's map, as it
 // would on the connected account after a real Phase 3 send.
 const stripeId = `in_${invoiceId.replaceAll('-', '')}`;
 provider.invoices.set(stripeId, { id: stripeId, livemode: false, object: 'invoice', status: 'open', total: 40000 });
 const s = await turn(d, a, 'chase Maria');
 const card = s.intents.find(i => i.type === 'action-card') as { actionId?: string } | undefined;
 expect(card?.actionId).toBeTruthy();
 const action = await store.getPreparedAction(E.AGENT_DB, t, card!.actionId!);
 expect(action!.actionClass).toBe('send_invoice_chase'); expect(action!.payloadSummary).toContain('Nothing sent yet.');
 const approved = await applyActionVerb(d, a, card!.actionId!, 'approve');
 expect(provider.sendCalls()).toHaveLength(1);
 // Re-send only: no invoice creation, no item, no finalize, and NO
 // footer/description edit attempt on the finalized invoice.
 expect(provider.calls.filter(c => c.path === '/v1/invoices')).toHaveLength(0);
 expect(approved.lines.join(' ')).toContain('copy-paste draft');
 expect(approved.lines.join(' ')).toContain('friendly reminder');
 const invoice = await getInvoice(E.AGENT_DB, t, invoiceId);
 expect(invoice!.status).toBe('sent'); expect(invoice!.chaseCount).toBe(1); expect(invoice!.lastChaseAt).toBeTruthy();
});

it('grant fence (§6.5) end-to-end: 3+ approved invoice sends never count toward a grant suggestion, and no proposal is ever surfaced', async () => {
 const t = tenantId(), a = actorFor(t), d = deps(); await seedTenant(t); await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 for (let i = 0; i < 3; i++) {
  const { actionId } = await draftViaTalk(d, a, `invoice Maria $${100 + i}`);
  const s = await applyActionVerb(d, a, actionId, 'approve');
  expect(s.lines.join(' ')).toContain('Sent —');
  expect(s.lines.join(' ')).not.toContain('Want it as a rule');
 }
 expect(provider.sendCalls()).toHaveLength(3);
 expect(await store.getSuggestion(E.AGENT_DB, t, 'send_invoice')).toBeNull();
 const rows = await E.AGENT_DB.prepare("SELECT * FROM mayor_grant_suggestions WHERE tenant_id=? AND action_class IN ('send_invoice','send_invoice_chase')").bind(t).all<any>();
 expect(rows.results).toHaveLength(0);
 // The store guard itself, called directly, also refuses to count.
 await store.recordSuggestionApproval(E.AGENT_DB, t, 'send_invoice_chase');
 expect(await store.getSuggestion(E.AGENT_DB, t, 'send_invoice_chase')).toBeNull();
});

it('Stage 5 fallthrough: free-form invoice talk classified by decide (mayor_intent profile) lands in the same draft path', async () => {
 const t = tenantId(), a = actorFor(t); await seedTenant(t); await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 const provider5: DecideProvider = { consult: async () => ({ answers: { intent_class: 'cashtext' }, confidences: { intent_class: 0.95 }, model: 'test-auto', costMicrocents: 0 }) };
 const d = deps({ decideProvider: provider5 });
 const s = await turn(d, a, 'Please send Maria Lopez an invoice for $250 for the sink repair');
 expect(s.intents.some(i => i.type === 'action-card')).toBe(true);
 const invoice = (await listInvoices(E.AGENT_DB, t))[0];
 expect(invoice).toMatchObject({ status: 'draft', amountCents: 25000, description: 'the sink repair' });
 expect(provider.calls).toHaveLength(0);
});

it('executor gate: no connected Stripe account -> approval sends nothing and says so (not_ready, claim unburned)', async () => {
 const t = tenantId(), a = actorFor(t), d = deps(); await seedTenant(t, false); await seedCustomer(t, 'Maria Lopez', 'maria@example.com');
 const { actionId } = await draftViaTalk(d, a);
 const s = await applyActionVerb(d, a, actionId, 'approve');
 expect(s.lines.join(' ')).toContain("Stripe isn't connected");
 expect(provider.calls).toHaveLength(0);
 expect((await listInvoices(E.AGENT_DB, t))[0].status).toBe('draft');
 const log = await E.AGENT_DB.prepare("SELECT * FROM mayor_action_log WHERE tenant_id=? AND action_key LIKE 'cashtext-send:%'").bind(t).all<any>();
 expect(log.results).toHaveLength(0);
});

it('cross-tenant bleed: tenant B cannot resolve A\'s customer, approve A\'s card, re-approve A\'s invoice, or see A\'s Desk cards', async () => {
 const ta = tenantId(), tb = tenantId(), aa = actorFor(ta), ab = actorFor(tb), d = deps();
 await seedTenant(ta); await seedTenant(tb); await seedCustomer(ta, 'Maria Lopez', 'maria@example.com');
 const { actionId } = await draftViaTalk(d, aa);
 // B talks: A's Maria is not in B's book.
 const s = await turn(d, ab, 'invoice Maria $400');
 expect(s.lines.join(' ')).toContain("don't have a customer named Maria");
 expect(await listInvoices(E.AGENT_DB, tb)).toHaveLength(0);
 // B tries A's card verb: tenant-bound store finds nothing to settle.
 const verb = await applyActionVerb(d, ab, actionId, 'approve');
 expect(verb.lines.join(' ')).toContain('already settled');
 expect(provider.calls).toHaveLength(0);
 expect((await listInvoices(E.AGENT_DB, ta))[0].status).toBe('draft');
 // B tries to re-approve A's invoice and read A's Desk.
 const invoiceA = (await listInvoices(E.AGENT_DB, ta))[0];
 const re = await applyCashTextReapprove(d, ab, invoiceA.id);
 expect(re.lines.join(' ')).toContain("isn't waiting to be sent");
 const deskB = await buildEngineDeskIntents(E.AGENT_DB, tb);
 expect(deskB.some(i => i.type === 'invoice-card' || i.type === 'action-card')).toBe(false);
});
