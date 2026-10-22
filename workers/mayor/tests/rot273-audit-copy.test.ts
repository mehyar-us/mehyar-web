import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* Rot273 paste-ready copy for /business-audit (chief-supplied exact
 * texts): final-sale at the buy step, the bounded-delivery sentence in
 * place of the old deadline disclaimer, and OG tags in the head.
 * Rot523 (2026-10-21, finding N2) supersedes ONLY the og:description
 * value: the OG line now mirrors the offer API's stated delivery
 * terms (AUDIT_OFFER.delivery — payment queues the audit; no delivery
 * window is promised there). The visible bounded-delivery sentence
 * below still stands as rot273 filed it; its disagreement with the
 * API is flagged in the rot523 slice report for a ruling, and this
 * pin keeps the two visibly distinct until then. */

const page = readFileSync(new URL('../web/business-audit.html', import.meta.url), 'utf8');

describe('rot273 audit page copy', () => {
  it('carries the final-sale sentence beside the price', () => {
    expect(page).toContain('All sales are final — the audit is a one-time digital service and purchases are not refundable.');
    const price = page.indexOf('intake-price');
    const sale = page.indexOf('All sales are final');
    expect(sale).toBeGreaterThan(price);
    expect(sale).toBeLessThan(page.indexOf('id="audit-intake-form"'));
  });
  it('states the bounded delivery window; the old disclaimer is gone', () => {
    expect(page).toContain('Your audit is delivered within 3 business days of checkout; if we need more from you, we email you the same day.');
    expect(page).not.toContain('No delivery deadline is automatically promised.');
  });
  it('carries the OG tags with the spec values', () => {
    expect(page).toContain('<meta property="og:title" content="Business Audit — The Mayor">');
    // Rot523/N2: aligned to the offer API's stated terms verbatim.
    expect(page).toContain('<meta property="og:description" content="A $330 one-time audit of your business\'s online presence. An automatically generated and independently reviewed audit report after intake analysis. Payment queues the audit; it does not mean a report is complete.">');
    expect(page).not.toContain('delivered within 3 business days. All sales final.');
  });
});
