import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {validateIcpParams} from '../src/leadproof/packs';
import {draftCitesEvidence, evidenceGate, sourceResolvesToBusiness} from '../src/leadproof/pipeline';
import {moduleCardsSsrHtml} from '../src/offer-block-ssr';
import {LEADPROOF_PACK_PRICE_CENTS} from '../src/billing/plans';

/* Phase 5 unit pins (integration spec §5.2/§5.5, §4.1/D7): the pack
 * domain's invariants that are cheaper to pin statically than to
 * re-prove per run — export-only by construction (no send verb
 * anywhere in the LeadProof code), the businesses-only refusal, the
 * routes, the purchase-directive branch, and the corrected no-price
 * presentation on every LeadProof/CashText module surface. */

it('export-only invariant: no LeadProof code path sends, prepares an action, or writes an outbox', () => {
 for (const file of ['src/billing/leadproof.ts', 'src/leadproof/packs.ts', 'src/leadproof/pipeline.ts', 'src/leadproof/routes.ts', 'src/leadproof/export.ts']) {
  const src = readFileSync(file, 'utf8');
  expect(src).not.toContain('PreparedAction');
  expect(src).not.toContain('mayor_email_outbox');
  expect(src).not.toContain('MAYOR_EMAIL');
  expect(src).not.toContain('/send');
  expect(src).not.toContain('insertPreparedAction');
 }
});

it('businesses-only (D7): consumer scope refuses in the open; business scope normalizes', () => {
 expect(() => validateIcpParams({ category: 'homeowners', geography: 'Brooklyn', scope: 'consumers' })).toThrowError(/businesses/i);
 expect(validateIcpParams({ category: ' property managers ', geography: ' Brooklyn, NY ', qualifiers: [' busy ', ''] }))
  .toEqual({ category: 'property managers', geography: 'Brooklyn, NY', qualifiers: ['busy'], scope: 'businesses' });
 expect(() => validateIcpParams({ category: '', geography: 'Brooklyn' })).toThrowError(/kind of business/i);
 expect(() => validateIcpParams({ category: 'dentists', geography: '' })).toThrowError(/place/i);
});

it('evidence gate (Phase 6): observation-less and source-unresolved leads drop; OSM-sourced and own-site leads pass; citation check bites', () => {
 const base = { name: 'A', website: 'https://a.example.com', sourceUrl: 'https://a.example.com', observations: [{ text: 'A manages buildings in Brooklyn' }] };
 expect(sourceResolvesToBusiness(base)).toBe(true);
 expect(sourceResolvesToBusiness({ ...base, sourceUrl: 'https://www.openstreetmap.org/node/123' })).toBe(true);
 expect(sourceResolvesToBusiness({ ...base, sourceUrl: 'https://lists.example.net/x' })).toBe(false);
 const gated = evidenceGate([base, { ...base, name: 'B', observations: [] }, { ...base, name: 'C', sourceUrl: 'https://lists.example.net/x' }]);
 expect(gated.admitted).toHaveLength(1);
 expect(gated.dropped.map(item => item.reason)).toEqual(['no_observation', 'source_unresolved']);
 const evidence = [{ id: 'obs-1', text: 'Lists twelve Brooklyn buildings and a repairs promise' }];
 expect(draftCitesEvidence({ whyNow: 'They list Brooklyn buildings', firstLine: 'Saw the buildings', observationId: 'obs-1' }, evidence)).toBe(true);
 expect(draftCitesEvidence({ whyNow: 'Won a national award', firstLine: 'Congrats', observationId: 'obs-1' }, evidence)).toBe(false);
 expect(draftCitesEvidence({ whyNow: 'Brooklyn buildings', firstLine: null, observationId: 'obs-9' }, evidence)).toBe(false);
 const routes = readFileSync('src/leadproof/routes.ts', 'utf8');
 expect(routes).toContain('LEADPROOF_RUNNER_TOKEN');
 expect(routes).toContain('/api/leadproof/jobs');
 const pipeline = readFileSync('src/leadproof/pipeline.ts', 'utf8');
 expect(pipeline).toContain('LEADPROOF_PACK_MIN_LEADS');
 expect(pipeline).toContain('timeout_24h');
});

it('routes + status + purchase directive are wired', () => {
 const routes = readFileSync('src/billing/index.ts', 'utf8');
 expect(routes).toContain('leadproof-checkout');
 expect(routes).toContain('createLeadProofCheckout');
 expect(routes).toContain('leadproof-request');
 expect(routes).toContain('requestLeadProofPack');
 const service = readFileSync('src/billing/service.ts', 'utf8');
 expect(service).toContain('leadproofStatus');
 const events = readFileSync('src/engine-events.ts', 'utf8');
 expect(events).toContain('mayor_leadproof_checkouts');
 expect(events).toContain("item_id:'leadproof_pack'");
});

it('no-price presentation: the SSR module cards carry neither module figure; the billing cards carry launch language instead', () => {
 const cards = moduleCardsSsrHtml();
 expect(cards).toContain('LeadProof');
 expect(cards).toContain('Evidence-backed business leads');
 expect(cards).not.toContain(`$${LEADPROOF_PACK_PRICE_CENTS / 100}`);
 expect(cards).not.toContain('$29');
 expect(cards.toLowerCase()).not.toContain('get paid faster');
 expect(cards.toLowerCase()).not.toContain('guarantee');
 const panel = readFileSync('web/billing.tsx', 'utf8');
 // The /billing Modules-card display conversion: no price figure is
 // rendered for either module; launch language stands in its place.
 expect(panel).not.toContain('money(cashtext.priceCents');
 expect(panel).toContain('Arrives with the module launch — pricing is announced at launch, and checkout opens then.');
 expect(panel).toContain('pack credit comes back automatically');
 const workday = readFileSync('web/workday.ts', 'utf8');
 expect(workday).toContain('leadproofCheckout');
 expect(workday).not.toContain('CashText is ${price} per month');
});
