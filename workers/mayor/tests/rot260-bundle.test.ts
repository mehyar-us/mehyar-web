import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { faqPageSsrHtml, injectSalesPlans, offerBlockSsrHtml, salesPlansSsrHtml } from '../src/offer-block-ssr';

/* Rot260 money bundle: the disclosure + discovery fixes.
 * - home offer block carries the BYO second-bill disclosure
 * - /sales top-up card carries the expiring-credits terms
 * - /sales serves a FAQPage JSON-LD whose Q&As match the visible FAQ
 * - home shell carries the labeled sample block above the sign-in ask
 *   and the business-day reply line (the /faq 301 is acceptance-checked
 *   live; its rule sits beside the /login redirect in src/index.ts) */

const salesHtml = readFileSync(new URL('../web/sales.html', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const indexSrc = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

describe('rot260 money bundle', () => {
  it('home offer block discloses the separate provider bill', () => {
    const html = offerBlockSsrHtml();
    expect(html).toContain('your own provider account (Telnyx or Twilio)');
    expect(html).toContain('never on your Mayor bill');
  });
  it('sales top-up card states the expiring-credits terms', () => {
    expect(salesPlansSsrHtml()).toContain('Credits expire at the end of the purchased period — they do not roll over.');
  });
  it('FAQPage JSON-LD matches the visible /sales FAQ exactly', () => {
    const visible = [...salesHtml.matchAll(/<summary>([^<]+)<\/summary>\s*<p>([^<]+)<\/p>/g)].map((m) => ({ q: m[1].trim(), a: m[2].trim() }));
    expect(visible.length).toBe(3);
    const block = faqPageSsrHtml();
    const data = JSON.parse(block.replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, ''));
    expect(data['@type']).toBe('FAQPage');
    expect(data.mainEntity.map((e: { name: string }) => e.name)).toEqual(visible.map((v) => v.q));
    expect(data.mainEntity.map((e: { acceptedAnswer: { text: string } }) => e.acceptedAnswer.text)).toEqual(visible.map((v) => v.a));
  });
  it('injected /sales carries BOTH the Product and FAQPage structured data', () => {
    const out = injectSalesPlans(salesHtml);
    expect(out).toContain('"@type":"Product"');
    expect(out).toContain('"@type":"FAQPage"');
  });
  it('home shell: labeled sample block above the sign-in ask + business-day line', () => {
    expect(indexHtml).toContain('sample-thread');
    expect(indexHtml).toContain('Sample only — not a real customer conversation.');
    expect(indexHtml).toContain('We reply within one business day.');
    expect(indexHtml.indexOf('sample-thread')).toBeLessThan(indexHtml.indexOf('chat-google-sign-in'));
  });
  it('/faq redirect rule sits in the fetch entry beside /login', () => {
    expect(indexSrc).toContain("url.pathname==='/faq'&&request.method==='GET'");
    expect(indexSrc).toContain("new URL('/sales#faq',request.url)");
  });
});
