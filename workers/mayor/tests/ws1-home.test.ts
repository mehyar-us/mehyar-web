import {describe,it,expect} from 'vitest';
import {offerBlockSsrHtml,homeAuditBandSsrHtml,injectOfferBlock} from '../src/offer-block-ssr';

/* WS1 build 2 (2026-10-16): the signed-out home composition —
 * the audit band at card weight (rot298 input 1) and the founding
 * line under the home Pro row under the SAME fail-quiet rule as
 * /sales and /pricing (rot298 input 2).
 * rot564 sell-first rework (2026-10-22): offerBlockSsrHtml /
 * injectOfferBlock no longer take the audit-availability flag — the
 * band moved out of the offer block into #home-audit-slot above the
 * sign-in (see front-door.test.ts); the founding assertions below
 * are unchanged in substance. */
const founding={available:true,seats_total:25,seats_taken:0,seats_remaining:25};

describe('home founding line',()=>{
 it('renders under the Pro row from real founding state',()=>{
  const html=offerBlockSsrHtml(founding)!;
  expect(html).toContain('Founding cohort');
  expect(html).toContain('$79.20');
  expect(html).toContain('25 of 25 seats left');
 });
 it('is absent when the seam gives no state (fail-quiet)',()=>{
  expect(offerBlockSsrHtml(null)).not.toContain('Founding cohort');
  expect(offerBlockSsrHtml()).not.toContain('Founding cohort');
 });
 it('never shows a number when the cohort state is unavailable',()=>{
  const html=offerBlockSsrHtml({available:false,seats_total:25,seats_taken:null,seats_remaining:null})!;
  expect(html).toContain('for the first 25 businesses');
  expect(html).not.toContain('seats left');
 });
 it('injectOfferBlock threads founding state into the served home',()=>{
  const page='<div id="chat-sign-in"><div id="offer-block" class="offer-block" aria-label="Plans"><p class="offer-fallback">x</p></div></div>';
  expect(injectOfferBlock(page,founding)).toContain('25 of 25 seats left');
  expect(injectOfferBlock(page)).not.toContain('Founding cohort');
 });
});

describe('home audit band card',()=>{
 it('is a card: head row with the catalog price and a CTA link',()=>{
  const band=homeAuditBandSsrHtml();
  expect(band).toContain('home-audit-head');
  expect(band).toContain('home-audit-price');
  expect(band).toContain('$330');
  expect(band).toContain('home-audit-cta');
  expect(band).toContain('href="/business-audit"');
  expect(band).toContain('Extensive business audit');
 });
});
