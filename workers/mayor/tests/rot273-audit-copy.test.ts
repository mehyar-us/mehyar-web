import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* Rot273 paste-ready copy for /business-audit (chief-supplied exact
 * texts): final-sale at the buy step, the bounded-delivery sentence in
 * place of the old deadline disclaimer, and OG tags in the head. */

const page = readFileSync(new URL('../web/business-audit.html', import.meta.url), 'utf8');

describe('rot273 audit page copy', () => {
  it('carries the final-sale sentence beside the price', () => {
    expect(page).toContain('All sales are final — the audit is a one-time digital service and purchases are not refundable.');
    const price = page.indexOf('intake-price');
    const sale = page.indexOf('All sales are final');
    expect(sale).toBeGreaterThan(price);
    expect(sale).toBeLessThan(page.indexOf('id="audit-intake-form"'));
  });
  it('states NO delivery timeframe in the FAQ; the queue-not-complete truth stands', () => {
    // SUPERSESSION (rot535 fold, Product Chief, 2026-10-22): the rot273
    // "bounded delivery window" sentence in the visible FAQ carried the
    // same "3 business days" deadline §8.2 removed from og:description —
    // GET /api/business-audit/offer's delivery statement makes no such
    // promise, so the deadline comes out of the FAQ too (ratified as
    // inside §8.2, not an extension). The FAQ now carries the offer's
    // own delivery truth, and no replacement timeframe is promised
    // (the "same day" email timeframe is gone with it).
    expect(page).not.toContain('delivered within 3 business days');
    expect(page).not.toContain('we email you the same day');
    expect(page).toContain('Payment queues your audit — it does not mean a report is complete. If we need more from you, we email you.');
    expect(page).not.toContain('No delivery deadline is automatically promised.');
  });
  it('carries the OG tags with the spec values', () => {
    expect(page).toContain('<meta property="og:title" content="Business Audit — The Mayor">');
    // §8.2 RULING (Reinvention blueprint, Product Chief, binding; Slice 0):
    // the OG aligns TO the offer — the "delivered within 3 business days"
    // deadline was removed from og:description because GET
    // /api/business-audit/offer's delivery statement makes no such
    // promise. The final-sale line in the OG stands (the Mayor's granted
    // exception). This expectation supersedes the rot273 spec value.
    expect(page).toContain('<meta property="og:description" content="A $330 one-time audit of your business\'s online presence. Payment queues your audit — it does not mean a report is complete. All sales final.">');
    expect(page).not.toContain('og:description" content="A $330 one-time audit of your business\'s online presence, delivered within 3 business days.');
  });
});
