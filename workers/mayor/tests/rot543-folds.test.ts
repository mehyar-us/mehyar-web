/**
 * rot543-folds.test.ts — Product Chief extension folds (🔵, 2026-10-22)
 * into the undeployed reinvention tree, extending the rot535 pass:
 *
 * 1. The HOME ask joins the final-sale scope: the same one-line form
 *    (FINAL_SALE_LINE, Terms linked) rides the Pro row of the home
 *    offer block — on BOTH render paths (worker SSR +
 *    web/offer-block.tsx, the React mirror) — superseding rot535's
 *    home-absence pin (flipped in tests/rot535-folds.test.ts with the
 *    supersession recorded).
 * 2. The founding offer in llms.txt: $79.20/month, locked for life
 *    while the subscription stays active, the first-25-businesses
 *    mechanism (static file — no live seat count), and how it is
 *    reached (/pricing → /billing?plan=founding). The JSON-LD half was
 *    completed by rot535 fold 2 — re-verified here, not redone.
 * 3. PACK CARDS GET THE LINE (🔵 additional ruling): every Small /
 *    Medium / Large pack card on /pricing (SSR + the inline fallback
 *    renderer) and the /sales top-up card carry FINAL_SALE_LINE
 *    exactly once, immediately after the purchase CTA, alongside —
 *    never replacing — the expiry truth.
 */
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {offerBlockSsrHtml,pricingCardsSsrHtml,salesPlansSsrHtml,structuredDataSsrHtml,FINAL_SALE_LINE,type FoundingSsrBlock} from '../src/offer-block-ssr';
import {offerBlockHtml} from '../web/offer-block';
import {CREDIT_PACKS,FOUNDING_PRICE_CENTS} from '../src/billing/plans';

const here=dirname(fileURLToPath(import.meta.url));
const readWeb=(f:string)=>readFileSync(join(here,'..','web',f),'utf8');
const count=(hay:string,needle:string)=>hay.split(needle).length-1;
const LINE='Payments are final and non-refundable';
const LIVE_FOUNDING:FoundingSsrBlock={available:true,seats_total:25,seats_taken:3,seats_remaining:22};
const FULL_FOUNDING:FoundingSsrBlock={available:true,seats_total:25,seats_taken:25,seats_remaining:0};
const catalog=()=>({currency:'USD',plans:[
  {id:'free',name:'Free',priceCents:0,interval:'calendar_month',replyLimit:100,voiceMinuteLimit:10},
  {id:'pro',name:'Pro',priceCents:9900,interval:'month',replyLimit:1000,voiceMinuteLimit:120},
]});

/* ---- Fold 1: the home ask joins the final-sale scope --------------- */

it('rot543 fold 1: home offer block SSR carries the line once, inside the Pro row',()=>{
  const html=offerBlockSsrHtml(LIVE_FOUNDING)!;
  expect(count(html,LINE)).toBe(1);
  expect(html).toContain(FINAL_SALE_LINE);
  // Inside the Pro row (the second .offer-plan), after the founding
  // anchor the row carries — the row's purchase link.
  const proRow=html.slice(html.indexOf('offer-plan',html.indexOf('offer-plan')+1));
  expect(proRow).toContain(FINAL_SALE_LINE);
  expect(proRow.indexOf(FINAL_SALE_LINE)).toBeGreaterThan(proRow.indexOf('/billing?plan=founding'));
  // The Free row carries no line.
  const freeRow=html.slice(html.indexOf('offer-plan'),html.indexOf('offer-plan',html.indexOf('offer-plan')+1));
  expect(freeRow).not.toContain(LINE);
});

it('rot543 fold 1: the home line is unconditional — present with no founding state and with a full cohort',()=>{
  expect(count(offerBlockSsrHtml(null)!,LINE)).toBe(1);
  expect(count(offerBlockSsrHtml(FULL_FOUNDING)!,LINE)).toBe(1);
});

it('rot543 fold 1: the React mirror (degraded home path) carries the identical line once',()=>{
  const html=offerBlockHtml(catalog())!;
  expect(count(html,LINE)).toBe(1);
  expect(html).toContain('<p class="plan-final-sale">Payments are final and non-refundable — see <a href="/terms">Terms</a>.</p>');
});

it('rot543 fold 1: the home stylesheet carries the .plan-final-sale rule',()=>{
  expect(readWeb('workspace.css')).toContain('.plan-final-sale');
});

/* ---- Fold 3: pack cards get the line ------------------------------- */

it('rot543 fold 3: every /pricing SSR pack card carries the line exactly once, after its Buy CTA, expiry truth intact',()=>{
  const packs=pricingCardsSsrHtml(LIVE_FOUNDING)!.packs;
  expect(count(packs,LINE)).toBe(CREDIT_PACKS.length);
  expect(count(packs,'Credits expire at the end of the purchased period — they do not roll over.')).toBe(CREDIT_PACKS.length);
  for(const pack of CREDIT_PACKS){
    const cardStart=packs.indexOf(`>Buy ${pack.name}<`);
    expect(cardStart).toBeGreaterThan(-1);
    const cardEnd=packs.indexOf('</article>',cardStart);
    const card=packs.slice(packs.lastIndexOf('<article',cardStart),cardEnd);
    expect(count(card,LINE)).toBe(1);
    // Immediately after the purchase CTA, before the expiry truth.
    expect(card.indexOf(LINE)).toBeGreaterThan(card.indexOf(`>Buy ${pack.name}<`));
    expect(card.indexOf(LINE)).toBeLessThan(card.indexOf('Credits expire'));
  }
});

it('rot543 fold 3: the /sales top-up card carries the line once, expiry truth intact',()=>{
  const html=salesPlansSsrHtml(LIVE_FOUNDING)!;
  const topup=html.slice(html.indexOf('<h3>Top up</h3>'));
  expect(count(topup,LINE)).toBe(1);
  expect(topup).toContain(FINAL_SALE_LINE);
  expect(topup).toContain('Credits expire at the end of the purchased period — they do not roll over.');
  // /sales total: Pro card (rot535) + top-up card (rot543) = 2.
  expect(count(html,LINE)).toBe(2);
});

it('rot543 fold 3: the /pricing inline-fallback pack renderer carries the line too',()=>{
  const src=readWeb('pricing.html');
  const topupFn=src.slice(src.indexOf('function topupCard'),src.indexOf('function fail'));
  expect(count(topupFn,'plan-final-sale')).toBe(1);
  expect(topupFn).toContain('<p class="plan-final-sale">Payments are final and non-refundable — see <a href="/terms">Terms</a>.</p>');
  // After the Buy anchor, before the expiry truth — same placement.
  expect(topupFn.indexOf('plan-final-sale')).toBeGreaterThan(topupFn.indexOf('Buy '));
  expect(topupFn.indexOf('plan-final-sale')).toBeLessThan(topupFn.indexOf('pack-note'));
});

/* ---- Fold 2: the founding offer in llms.txt (JSON-LD re-verified) -- */

it('rot543 fold 2: llms.txt carries the founding offer in its full truthful form',()=>{
  const llms=readFileSync(join(here,'..','web','public','llms.txt'),'utf8');
  const line=llms.split('\n').find(l=>l.includes('Founding cohort'))!;
  expect(line).toBeDefined();
  expect(line).toContain('$79.20/month');
  expect(line).toContain('first 25 businesses');
  expect(line).toContain('locked for life while the subscription stays active');
  // How it is reached: the Pricing page → the founding billing door.
  expect(line).toContain('https://mayor.mehyar.us/pricing');
  expect(line).toContain('https://mayor.mehyar.us/billing?plan=founding');
  // Static file: the MECHANISM, never a live seat count.
  expect(llms).not.toContain('seats left');
  expect(llms).not.toContain('of 25 seats');
  // Consistent with the file's other price statements.
  expect(llms).toContain('Pro: $99/month');
});

it('rot543 fold 2: JSON-LD founding offer — re-verified (rot535 fold 2, not redone)',()=>{
  const m=structuredDataSsrHtml(true,LIVE_FOUNDING).match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  const offers=JSON.parse(m![1]).offers as {name:string;price:number}[];
  expect(offers.find(o=>o.name==='Founding cohort')!.price).toBe(FOUNDING_PRICE_CENTS/100);
});
