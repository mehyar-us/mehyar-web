import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditOffer, auditGenerationPaused, createAuditCheckout, AUDIT_PAUSED_MESSAGE } from '../src/billing/audit';
import type { BillingEnv } from '../src/billing/stripe';
import { auditCardSsrHtml, injectPricingCards, injectSalesPlans } from '../src/offer-block-ssr';
import { HttpError } from '../src/http';

/** Generation-state pause (2026-10-23): the worker's own $330 audit offer
 * joins the fleet claim-posture pause after a production-rails generation
 * exercise ended needs_review with no deliverable report. These pins hold:
 * the offer answers paused, checkout creation refuses SERVER-SIDE (before
 * any Stripe call or DB write), and every point of ask on /pricing + /sales
 * (SSR card AND static fallback) presents the pause with the purchase
 * action retired. The unpaused forms stay byte-identical. */

const pausedEnv = { MAYOR_AUDIT_GENERATION_PAUSED: 'true' } as unknown as BillingEnv;
const unpausedEnv = {} as unknown as BillingEnv;

const INTAKE = {
  contactName: 'Pause Pin', email: 'info@mehyar.us', businessName: 'Pause Pin Business',
  website: 'https://lib.mehyar.us/', goals: 'Verify the paused checkout refusal path.',
  acceptedTerms: true as const,
};

describe('audit generation pause — offer + checkout refusal', () => {
  it('the predicate reads only the exact flag value', () => {
    expect(auditGenerationPaused(pausedEnv)).toBe(true);
    expect(auditGenerationPaused(unpausedEnv)).toBe(false);
    expect(auditGenerationPaused({ MAYOR_AUDIT_GENERATION_PAUSED: 'false' } as unknown as BillingEnv)).toBe(false);
  });

  it('the offer answers paused: unavailable, paused flag set, paused message, no live sale', () => {
    const offer = auditOffer(pausedEnv);
    expect(offer.available).toBe(false);
    expect(offer.mode).toBeNull();
    expect(offer.audit_paused).toBe(true);
    expect(offer.message).toBe(AUDIT_PAUSED_MESSAGE);
    expect(offer.message).toContain('paused while report generation is restored');
    expect(offer.offer.priceCents).toBe(33000);
  });

  it('the unpaused offer shape is untouched apart from the audit_paused field reading false', () => {
    const offer = auditOffer(unpausedEnv);
    expect(offer.audit_paused).toBe(false);
    expect(offer.message).toBe('The audit checkout is being prepared. No payment is available yet.');
  });

  it('checkout creation refuses server-side while paused (503 audit_generation_paused, before Stripe/DB)', async () => {
    await expect(createAuditCheckout(pausedEnv, INTAKE as never, '123e4567-e89b-12d3-a456-426614174000'))
      .rejects.toMatchObject({ status: 503, code: 'audit_generation_paused' });
    await expect(createAuditCheckout(pausedEnv, INTAKE as never, '123e4567-e89b-12d3-a456-426614174000'))
      .rejects.toBeInstanceOf(HttpError);
  });
});

describe('audit generation pause — points of ask', () => {
  it('the paused SSR card states the pause and retires the purchase action', () => {
    const card = auditCardSsrHtml(true);
    expect(card).toContain('Audit checkout is paused while report generation is restored.');
    expect(card).not.toContain('Start your audit');
    expect(card).not.toContain('Payment queues your audit');
    expect(card).toContain('See the business audit');
    expect(card).toContain('href="/business-audit"');
  });

  it('the unpaused SSR card is the pre-pause form', () => {
    const card = auditCardSsrHtml();
    expect(card).toContain('Start your audit');
    expect(card).toContain('Payment queues your audit');
    expect(card).not.toContain('audit-paused-note');
    expect(auditCardSsrHtml(false)).toBe(card);
  });

  it('pricing and sales injections carry the paused card when threaded', () => {
    const pricingShell = '<div id="plan-cards"></div><div id="topup-cards"></div><div id="audit-card"></div>';
    const pricing = injectPricingCards(pricingShell, false, null, true);
    expect(pricing).toContain('Audit checkout is paused while report generation is restored.');
    expect(pricing).not.toContain('Start your audit');
    const salesShell = '<div id="sales-plan-cards"></div><div id="sales-audit"></div>';
    const sales = injectSalesPlans(salesShell, false, null, true);
    expect(sales).toContain('Audit checkout is paused while report generation is restored.');
    expect(sales).not.toContain('Start your audit');
  });

  it('the static fallback cards on /pricing and /sales present the same pause', () => {
    const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
    for (const page of ['pricing.html', 'sales.html']) {
      const html = readFileSync(join(webDir, page), 'utf8');
      expect(html).toContain('Audit checkout is paused while report generation is restored.');
      expect(html).not.toContain('Start your audit');
      expect(html).toContain('See the business audit');
    }
  });
});
