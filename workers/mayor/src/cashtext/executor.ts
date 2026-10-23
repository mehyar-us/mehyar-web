/**
 * cashtext/executor.ts — the engine's first and only send path
 * (integration spec §3.3). Called from applyActionVerb's ONE fenced
 * hook, exactly once per approval of a send_invoice /
 * send_invoice_chase prepared action:
 *
 *  1. mayor_action_log row FIRST, action_key
 *     'cashtext-send:<prepared_action_id>' — the table's
 *     UNIQUE(tenant_id, action_key) makes a double-approval, a
 *     replayed verb, or a retried execution a no-op, not a
 *     double-send (claimActionLog returns false and we stop).
 *  2. Stripe, on the TENANT's connected account (the Phase 0
 *     {stripeAccount} header; the tenant is the merchant of record):
 *     create/find the Stripe customer, create the invoice
 *     (collection_method send_invoice, days_until_due from the
 *     draft), add the line, finalize, call /send — every POST with
 *     its domain idempotency key (mayor-pwa:cashtext-*).
 *  3. verification_result recorded on the log row; the invoice
 *     advances to sent with hosted_invoice_url + sent_at.
 *
 * FOOTER (Phase 2 rider 1, proven against the real Stripe test API):
 * invoice footer/description are LOCKED once an invoice is finalized,
 * so the footer is set AT CREATION TIME, before finalization — never
 * after. No post-finalize edit path exists in this file, by design.
 *
 * CHASES (Phase 2 rider 1 / spec §3.4 fallback): a chase approval
 * re-calls /send ONLY — Stripe re-delivers the original invoice. The
 * approved chase text cannot be attached to a finalized invoice, so
 * the result carries it back as a disclosed copy-paste draft for the
 * owner. Never a silent behavior change.
 *
 * Failure discipline: any Stripe failure leaves the invoice
 * `approved` (not sent), records verification_result 'failed', and
 * surfaces the plain owner line. A retry is a NEW prepared action
 * (reapproveInvoice) — never a silent re-send.
 */
import type {PreparedAction} from '../engine/types';
import {claimActionLog, updateActionLogVerification} from '../engine/store';
import {baseConfiguration, clientFor, type BillingEnv, type StripeClient, type StripeObject} from '../billing/stripe';
import {getInvoice, type CashTextInvoice} from './drafts';
import {getCustomerById, money} from './talk';

/** The courteous evergreen footer set at invoice CREATION time —
 * the only moment Stripe lets us set it (Phase 2 footer verdict). */
export const CASHTEXT_INVOICE_FOOTER = 'Thank you for your business. Questions about this invoice? Just reply to this email.';
export const CASHTEXT_SEND_FAILURE_LINE = "Stripe couldn't send that — nothing went out; retry from the invoice";

export interface CashTextExecutionResult {
 outcome: 'sent' | 'already_sent' | 'failed' | 'not_ready';
 ownerLine: string;
 hostedInvoiceUrl?: string;
 /** For chases: the approved text, returned as a copy-paste draft
  * (the §3.4 fallback, disclosed in ownerLine). */
 copyPasteDraft?: string;
}

interface CashTextSettingsRow { stripe_account_id: string | null; account_status: string; charges_enabled: number }

export async function executeCashTextSend(input: {
 db: D1Database; env: BillingEnv; tenantId: string; action: PreparedAction; injected?: StripeClient; now?: Date;
}): Promise<CashTextExecutionResult> {
 const { db, tenantId, action } = input;
 const now = input.now ?? new Date();
 const fail = (ownerLine: string): CashTextExecutionResult => ({ outcome: 'failed', ownerLine });
 const invoiceId = action.payload.invoice_id as string | undefined;
 if (!invoiceId) return fail(CASHTEXT_SEND_FAILURE_LINE);
 const invoice = await getInvoice(db, tenantId, invoiceId);
 if (!invoice) return fail(CASHTEXT_SEND_FAILURE_LINE);
 if (invoice.status === 'paid') return { outcome: 'already_sent', ownerLine: 'That invoice is already paid — nothing to send.' };
 if (invoice.status === 'sent' && action.actionClass === 'send_invoice') return { outcome: 'already_sent', ownerLine: 'That invoice already went out — I didn\'t send it twice.' };
 if (invoice.status === 'void') return fail('That invoice was voided — draft a new one if you still want to bill it.');

 /* Preconditions, checked BEFORE the claim so a configuration gap
  * never burns the exactly-once key: the tenant's Connect account
  * must be linked and charge-enabled, and the customer must have an
  * email on file (resolution stopped the draft without one; an edit
  * could have swapped the customer since). */
 const settings = await db.prepare('SELECT stripe_account_id,account_status,charges_enabled FROM mayor_cashtext_settings WHERE tenant_id=?')
  .bind(tenantId).first<CashTextSettingsRow>().catch(() => null);
 if (!settings?.stripe_account_id) return { outcome: 'not_ready', ownerLine: 'Stripe isn\'t connected for your business yet — connect it in Plan & usage, then approve the invoice again from a fresh card.' };
 const customer = await getCustomerById(db, tenantId, invoice.customerId);
 if (!customer) return fail(CASHTEXT_SEND_FAILURE_LINE);
 if (!customer.email) return { outcome: 'not_ready', ownerLine: `${customer.name} doesn't have an email on file — add it and I'll draft the send again. I won't guess an email.` };

 /* (1) The claim — first, and the fence for everything after. */
 const actionKey = `cashtext-send:${action.id}`;
 const claimed = await claimActionLog(db, {
  tenantId, actionKey, kind: 'executed', actionClass: action.actionClass,
  targetPerson: customer.name, channel: 'email',
  payloadSummary: action.payloadSummary, preparedActionId: action.id,
 });
 if (!claimed) return { outcome: 'already_sent', ownerLine: 'That send already went out — I didn\'t send it twice.' };

 try {
  baseConfiguration(input.env); // mode/key guard — an unready billing config fails like a Stripe failure, claim recorded
  const client = clientFor(input.env, input.injected);
  const stripeAccount = settings.stripe_account_id;
  const opts = { stripeAccount };

  if (action.actionClass === 'send_invoice_chase') {
   if (!invoice.stripeInvoiceId) throw new Error('cashtext_chase_without_invoice');
   const sent = await client.request(`/v1/invoices/${invoice.stripeInvoiceId}/send`, 'POST', {}, `mayor-pwa:cashtext-chase:${action.id}`, opts);
   await db.prepare('UPDATE mayor_cashtext_invoices SET chase_count=chase_count+1,last_chase_at=?,updated_at=? WHERE tenant_id=? AND id=?')
    .bind(now.toISOString(), now.toISOString(), tenantId, invoice.id).run();
   await updateActionLogVerification(db, tenantId, actionKey, `chase_resent:${invoice.stripeInvoiceId}`);
   const chaseText = typeof action.payload.chase_text === 'string' ? action.payload.chase_text : '';
   return {
    outcome: 'sent',
    ownerLine: `Re-sent — Stripe delivered ${customer.name}'s invoice again from your account. One honest limit: the note you approved can't be added to a finalized invoice, so here it is as a copy-paste draft if you want to send it yourself:`,
    ...(sent.hosted_invoice_url ? { hostedInvoiceUrl: sent.hosted_invoice_url as string } : {}),
    ...(chaseText ? { copyPasteDraft: chaseText } : {}),
   };
  }

  /* send_invoice — mark approved first (the state the failure path
   * must preserve), then the Stripe sequence. */
  await db.prepare("UPDATE mayor_cashtext_invoices SET status='approved',updated_at=? WHERE tenant_id=? AND id=? AND status IN ('draft','approved')")
   .bind(now.toISOString(), tenantId, invoice.id).run();

  let stripeCustomerId = invoice.stripeCustomerId;
  if (!stripeCustomerId) {
   const created = await client.request('/v1/customers', 'POST',
    { email: customer.email, name: customer.name, metadata: { mayor_tenant_id: tenantId, mayor_customer_id: customer.id } },
    `mayor-pwa:cashtext-customer:${invoice.id}`, opts);
   stripeCustomerId = created.id as string;
   await db.prepare('UPDATE mayor_cashtext_invoices SET stripe_customer_id=?,updated_at=? WHERE tenant_id=? AND id=?')
    .bind(stripeCustomerId, now.toISOString(), tenantId, invoice.id).run();
  }

  let stripeInvoiceId = invoice.stripeInvoiceId;
  if (stripeInvoiceId) {
   /* Resume after a partial attempt: the Stripe invoice's own state
    * says where the sequence stopped. A draft still needs its line +
    * finalize (both replay-safe under their idempotency keys); an
    * open invoice goes straight to /send — re-finalizing an open
    * invoice is a Stripe error, and re-sending is the retry's job. */
   const existing = await client.request(`/v1/invoices/${stripeInvoiceId}`, 'GET', undefined, undefined, opts);
   if (existing.status === 'draft') {
    await client.request('/v1/invoiceitems', 'POST',
     { customer: stripeCustomerId, invoice: stripeInvoiceId, amount: invoice.amountCents, currency: invoice.currency, description: invoice.description || undefined },
     `mayor-pwa:cashtext-item:${invoice.id}`, opts);
    await client.request(`/v1/invoices/${stripeInvoiceId}/finalize`, 'POST', {}, `mayor-pwa:cashtext-finalize:${invoice.id}`, opts);
   }
  }
  if (!stripeInvoiceId) {
   const daysUntilDue = typeof action.payload.days_until_due === 'number' ? action.payload.days_until_due
    : invoice.dueDate ? Math.max(0, Math.round((Date.parse(invoice.dueDate) - now.getTime()) / 86400_000)) : 7;
   const created = await client.request('/v1/invoices', 'POST',
    {
     customer: stripeCustomerId, collection_method: 'send_invoice', days_until_due: daysUntilDue,
     description: invoice.description || undefined,
     /* FOOTER AT CREATION (rider 1): set here, before finalization —
      * a finalized invoice's footer is locked, proven in Phase 2. */
     footer: CASHTEXT_INVOICE_FOOTER,
     metadata: { mayor_tenant_id: tenantId, mayor_invoice_id: invoice.id },
    },
    `mayor-pwa:cashtext-invoice:${invoice.id}`, opts);
   stripeInvoiceId = created.id as string;
   await db.prepare('UPDATE mayor_cashtext_invoices SET stripe_invoice_id=?,updated_at=? WHERE tenant_id=? AND id=?')
    .bind(stripeInvoiceId, now.toISOString(), tenantId, invoice.id).run();
   await client.request('/v1/invoiceitems', 'POST',
    { customer: stripeCustomerId, invoice: stripeInvoiceId, amount: invoice.amountCents, currency: invoice.currency, description: invoice.description || undefined },
    `mayor-pwa:cashtext-item:${invoice.id}`, opts);
   await client.request(`/v1/invoices/${stripeInvoiceId}/finalize`, 'POST', {}, `mayor-pwa:cashtext-finalize:${invoice.id}`, opts);
  }
  const sent: StripeObject = await client.request(`/v1/invoices/${stripeInvoiceId}/send`, 'POST', {}, `mayor-pwa:cashtext-send:${invoice.id}`, opts);
  const hostedUrl = typeof sent.hosted_invoice_url === 'string' ? sent.hosted_invoice_url : null;
  await db.prepare("UPDATE mayor_cashtext_invoices SET status='sent',hosted_invoice_url=COALESCE(?,hosted_invoice_url),sent_at=?,updated_at=? WHERE tenant_id=? AND id=?")
   .bind(hostedUrl, now.toISOString(), now.toISOString(), tenantId, invoice.id).run();
  await updateActionLogVerification(db, tenantId, actionKey, `sent:${stripeInvoiceId}`);
  return {
   outcome: 'sent',
   ownerLine: `Sent — ${customer.name}'s invoice for ${money(invoice.amountCents)} is on its way from your Stripe account.`,
   ...(hostedUrl ? { hostedInvoiceUrl: hostedUrl } : {}),
  };
 } catch {
  /* Failure: the invoice stays approved (not sent), the claim row
   * records the failure, and the owner gets the plain line. The
   * partial Stripe ids (customer/invoice) stay on the row so a NEW
   * prepared action's retry resumes the same Stripe invoice instead
   * of minting a duplicate — the send itself is never silently
   * retried. */
  await updateActionLogVerification(db, tenantId, actionKey, 'failed').catch(() => undefined);
  await db.prepare("UPDATE mayor_cashtext_invoices SET status='approved',updated_at=? WHERE tenant_id=? AND id=? AND status IN ('draft','approved')")
   .bind(new Date().toISOString(), tenantId, invoice.id).run().catch(() => undefined);
  return fail(CASHTEXT_SEND_FAILURE_LINE);
 }
}
