import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { injectPricingCards, injectSalesPlans, structuredDataSsrHtml } from '../src/offer-block-ssr';

/* Rot277: the $330 audit's structured-data claim must track the real
 * checkout availability (the serve path passes auditOffer(env).available;
 * the injectors default to NOT claiming InStock), and the audit page must
 * state availability before the intake form. */

const auditPage = readFileSync(new URL('../web/business-audit.html', import.meta.url), 'utf8');

function auditOfferAvailability(html: string): string {
  const block = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  const data = JSON.parse(block![1]);
  const offer = data.offers.find((o: { name: string }) => o.name === 'Extensive business audit');
  return offer.availability;
}

describe('audit availability honesty', () => {
  it('structured data claims InStock for the audit only when availability is passed', () => {
    expect(auditOfferAvailability(structuredDataSsrHtml(true))).toBe('https://schema.org/InStock');
    expect(auditOfferAvailability(structuredDataSsrHtml(false))).toBe('https://schema.org/OutOfStock');
  });
  it('injectors default to not claiming the audit is buyable', () => {
    const shell = '<html><head></head><body><div id="pricing-cards"></div><div id="plan-cards"></div></body></html>';
    expect(auditOfferAvailability(injectPricingCards(shell))).toBe('https://schema.org/OutOfStock');
    const salesShell = '<html><head></head><body><div id="sales-plan-cards"></div></body></html>';
    expect(auditOfferAvailability(injectSalesPlans(salesShell))).toBe('https://schema.org/OutOfStock');
    expect(auditOfferAvailability(injectSalesPlans(salesShell, true))).toBe('https://schema.org/InStock');
  });
  it('plans and packs keep their InStock claim (they are buyable)', () => {
    const data = JSON.parse(structuredDataSsrHtml(false).match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
    const planOffers = data.offers.filter((o: { name: string }) => o.name !== 'Extensive business audit');
    expect(planOffers.length).toBeGreaterThan(0);
    expect(planOffers.every((o: { availability: string }) => o.availability === 'https://schema.org/InStock')).toBe(true);
  });
  it('audit page states availability before the intake section and form', () => {
    const availability = auditPage.indexOf('id="audit-availability"');
    expect(availability).toBeGreaterThan(-1);
    expect(availability).toBeLessThan(auditPage.indexOf('id="start-audit"'));
    expect(availability).toBeLessThan(auditPage.indexOf('id="audit-intake-form"'));
  });
});
