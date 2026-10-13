/**
 * offer-block-ssr.ts — server-side rendering of the public offer block.
 *
 * The unauthenticated home (/) must show the pricing summary in the SERVED
 * HTML (not only after client JS hydration). Amounts come ONLY from PLANS in
 * ./billing/plans — the same single source of truth that
 * /api/billing/catalog serves. There are no hardcoded prices in this file;
 * a unit test asserts it contains no $\d literal.
 *
 * Markup mirrors web/offer-block.ts offerBlockHtml so the styling is
 * identical. The client (web/offer-block.ts loadOfferBlock) skips its fetch
 * when data-ssr="catalog" is present on #offer-block, so there is no
 * double-render or flicker.
 */
import {PLANS,CREDIT_PACKS} from './billing/plans';
import {AUDIT_OFFER} from './billing/audit';

function escapeHtml(value:string):string{
  return value.replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string));
}
function formatPrice(cents:number):string{
  return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(cents/100);
}
interface SsrPlan{id:string;name:string;priceCents:number;replyLimit:number;voiceMinuteLimit:number}
function validPlan(p:unknown):p is SsrPlan{
  const v=p as Record<string,unknown>|null;
  return !!v&&typeof v.id==='string'&&typeof v.name==='string'
    &&typeof v.priceCents==='number'&&Number.isFinite(v.priceCents)&&v.priceCents>=0
    &&typeof v.replyLimit==='number'&&typeof v.voiceMinuteLimit==='number';
}
/**
 * Rendered offer HTML from the live PLANS catalog, or null when the catalog
 * can't be trusted (the caller keeps the price-free fallback instead of
 * showing a stale or invented amount).
 */
export function offerBlockSsrHtml():string|null{
  const free=PLANS.find(p=>p.id==='free'),pro=PLANS.find(p=>p.id==='pro');
  if(!validPlan(free)||!validPlan(pro))return null;
  const row=(p:SsrPlan,blurb:string)=>
    `<div class="offer-plan"><div class="offer-plan-head"><strong>${escapeHtml(p.name)}</strong>`+
    `<span class="offer-price">${escapeHtml(formatPrice(p.priceCents))}${p.priceCents>0?'<span class="offer-per"> / month</span>':''}</span></div>`+
    `<p>${p.replyLimit.toLocaleString('en-US')} reply attempts · ${p.voiceMinuteLimit} microphone minutes a month</p>`+
    `<p class="offer-blurb">${blurb}</p></div>`;
  return `<div class="offer-plans">${row(free,'A good place to start.')}${row(pro,'For a busier business.')}</div>`+
    `<p class="offer-note">Purchases are final — no refunds. Cancel Pro renewal in Manage billing.</p>`;
}

const OFFER_OPEN='<div id="offer-block"';

/* ------------------------------------------------------------------ */
/* /pricing SSR — plan cards + top-up cards from the live catalog.      */
/*                                                                     */
/* The pricing page must show its plans in the SERVED HTML (not only    */
/* after client JS hydration). Amounts come ONLY from PLANS and        */
/* CREDIT_PACKS in ./billing/plans — the same single source of truth   */
/* that /api/billing/catalog serves. There are no hardcoded prices in  */
/* this file; a unit test asserts it contains no $\d literal.          */
/*                                                                     */
/* Markup mirrors the client renderer in web/pricing.html so styling   */
/* is identical. The client skips its fetch when data-ssr="catalog"    */
/* is present on the card containers, so there is no double-render.    */
/* ------------------------------------------------------------------ */
interface SsrPack{id:string;name:string;priceCents:number;replyAttempts:number;voiceMinutes:number}
function validPack(p:unknown):p is SsrPack{
  const v=p as Record<string,unknown>|null;
  return !!v&&typeof v.id==='string'&&typeof v.name==='string'
    &&typeof v.priceCents==='number'&&Number.isFinite(v.priceCents)&&v.priceCents>=0
    &&typeof v.replyAttempts==='number'&&typeof v.voiceMinutes==='number';
}
function priceLine(cents:number,suffix:string):string{
  return `<p class="plan-price"><strong>${escapeHtml(formatPrice(cents))}</strong>`+
    `<span>${escapeHtml(suffix)}</span></p>`;
}
/**
 * Rendered plan + top-up cards from the live catalog, or null when the
 * catalog can't be trusted (the caller keeps the client fallback instead
 * of showing a stale or invented amount).
 */
export function pricingCardsSsrHtml():{plans:string;packs:string}|null{
  const free=PLANS.find(p=>p.id==='free'),pro=PLANS.find(p=>p.id==='pro');
  if(!validPlan(free)||!validPlan(pro))return null;
  const packs=[...CREDIT_PACKS];
  if(packs.length===0||!packs.every(validPack))return null;
  const planCard=(p:SsrPlan,blurb:string)=>
    `<article class="plan-card"><h3>${escapeHtml(p.name)}</h3>`+
    priceLine(p.priceCents,p.priceCents>0?' / month':'')+
    `<p class="plan-tier">${p.replyLimit.toLocaleString('en-US')} reply attempts · `+
    `${p.voiceMinuteLimit} microphone minutes a month</p>`+
    `<p>${blurb}</p><a class="button button-small" href="/">`+
    `${p.id==='pro'?`Go Pro — ${escapeHtml(formatPrice(p.priceCents))}/mo`:'Start free'}</a></article>`;
  const packCard=(p:SsrPack)=>
    `<article class="plan-card"><h3>${escapeHtml(p.name)}</h3>`+
    priceLine(p.priceCents,' one-time')+
    `<p class="plan-tier">+${p.replyAttempts.toLocaleString('en-US')} reply attempts · `+
    `+${p.voiceMinutes} microphone minutes</p>`+
    `<a class="button button-small" href="/">Buy</a></article>`;
  return {
    plans:planCard(free,'A good place to start. Talk to The Mayor and feel the money loop working.')
      +planCard(pro,'For the busier business: the full proactive engine watching your book.'),
    packs:packs.map(packCard).join(''),
  };
}
function injectIntoContainer(html:string,containerId:string,rendered:string):string{
  const openTag=`<div id="${containerId}"`;
  const openAt=html.indexOf(openTag);
  if(openAt<0)return html;
  const tagEnd=html.indexOf('>',openAt);
  if(tagEnd<0)return html;
  const openingTag=html.slice(openAt,tagEnd+1);
  if(openingTag.includes('data-ssr='))return html; // already rendered
  const closeAt=html.indexOf('</div>',tagEnd);
  if(closeAt<0)return html;
  const tagged=openingTag.replace(openTag,`${openTag} data-ssr="catalog"`);
  return html.slice(0,openAt)+tagged+rendered+html.slice(closeAt);
}
/**
 * Inject the server-rendered plan cards into #plan-cards and #topup-cards
 * of a served pricing page. Returns the HTML UNCHANGED when a container is
 * missing, already server-rendered, or the catalog can't be trusted — the
 * client fallback then stays in place.
 */
export function injectPricingCards(html:string):string{
  const rendered=pricingCardsSsrHtml();
  if(!rendered)return html;
  let out=injectIntoContainer(html,'plan-cards',rendered.plans);
  out=injectIntoContainer(out,'topup-cards',rendered.packs);
  out=injectIntoContainer(out,'audit-card',auditCardSsrHtml());
  return out;
}
/* ------------------------------------------------------------------ */
/* /sales SSR — priced plan cards for the pitch page (rot107).          */
/*                                                                     */
/* The sales page source stays price-free; amounts render at serve      */
/* time from PLANS / CREDIT_PACKS — the same catalog source as          */
/* /pricing — so a catalog price change flows through with no page      */
/* edit. Returns null when the catalog can't be trusted; the page       */
/* then keeps its price-free fallback cards.                            */
/* ------------------------------------------------------------------ */
export function salesPlansSsrHtml():string|null{
  const free=PLANS.find(p=>p.id==='free'),pro=PLANS.find(p=>p.id==='pro');
  if(!validPlan(free)||!validPlan(pro))return null;
  const packs=[...CREDIT_PACKS];
  if(packs.length===0||!packs.every(validPack))return null;
  const start=
    `<article class="plan-card"><h3>Free</h3>`+
    priceLine(free.priceCents,'')+
    `<p class="plan-tier">${free.replyLimit.toLocaleString('en-US')} reply attempts · ${free.voiceMinuteLimit} microphone minutes a month</p>`+
    `<p>Talk to The Mayor, tell it about your business, and feel the money loop working: missed-call text-backs, reminders, and the morning briefing.</p>`+
    `<a class="button button-small" href="/">Start free</a></article>`;
  const grow=
    `<article class="plan-card"><h3>Pro</h3>`+
    priceLine(pro.priceCents,' / month')+
    `<p class="plan-tier">${pro.replyLimit.toLocaleString('en-US')} reply attempts · ${pro.voiceMinuteLimit} microphone minutes a month</p>`+
    `<p>For the busier shop: more reply attempts, more microphone minutes, and the full proactive engine watching your book. No hidden fees.</p>`+
    `<a class="button button-small" href="/">Go Pro — ${escapeHtml(formatPrice(pro.priceCents))}/mo</a></article>`;
  const topup=
    `<article class="plan-card"><h3>Top up</h3>`+
    `<p class="plan-tier">One-time, as you need it</p>`+
    `<ul class="pack-list">`+
    packs.map(p=>`<li><strong>${escapeHtml(p.name)} — ${escapeHtml(formatPrice(p.priceCents))}</strong> · +${p.replyAttempts.toLocaleString('en-US')} reply attempts · +${p.voiceMinutes} microphone minutes</li>`).join('')+
    `</ul>`+
    `<p>Buy only what you use — no subscription change, no overage surprises.</p>`+
    `<a class="button button-small" href="/pricing">See pricing</a></article>`;
  return start+grow+topup;
}
/**
 * Inject the server-rendered priced cards into the #sales-plan-cards
 * container of a served /sales page. Returns the HTML UNCHANGED when the
 * container is missing, already server-rendered, or the catalog can't be
 * trusted — the price-free fallback cards then stay in place.
 */
export function injectSalesPlans(html:string):string{
  const rendered=salesPlansSsrHtml();
  if(!rendered)return html;
  let out=injectIntoContainer(html,'sales-plan-cards',rendered);
  const audit=auditCardSsrHtml();
  if(audit)out=injectIntoContainer(out,'sales-audit',audit);
  return out;
}
/* ------------------------------------------------------------------ */
/* The extensive business audit — a named offer card rendered from       */
/* AUDIT_OFFER (src/billing/audit), the same source the checkout        */
/* verifies against Stripe. One-time price, deliverable scope, the      */
/* queue-not-instant delivery truth, and the no-refunds line.           */
/* ------------------------------------------------------------------ */
export function auditCardSsrHtml():string{
  const scope=AUDIT_OFFER.scope.slice(0,-1).join(', ').toLowerCase();
  const plan=AUDIT_OFFER.scope[AUDIT_OFFER.scope.length-1].toLowerCase();
  return `<article class="plan-card"><h3>${escapeHtml(AUDIT_OFFER.name)}</h3>`+
    priceLine(AUDIT_OFFER.priceCents,' one-time')+
    `<p class="plan-tier">One business · one focused plan</p>`+
    `<p>A reviewed report covering ${escapeHtml(scope)} — plus ${escapeHtml(plan)}. Payment queues your audit: the report is generated and independently reviewed after intake, not delivered instantly.</p>`+
    `<p>Purchases are final — no refunds.</p>`+
    `<a class="button button-small" href="/business-audit">Start your audit</a></article>`;
}
/**
 * Inject the server-rendered pricing into the #offer-block container of a
 * served home page. Marks the container data-ssr="catalog" so the client
 * hydration skips it. Returns the HTML UNCHANGED when the container is
 * missing, already server-rendered, structurally unexpected, or the catalog
 * can't be trusted — the price-free client fallback then stays in place.
 */
export function injectOfferBlock(html:string):string{
  const openAt=html.indexOf(OFFER_OPEN);
  if(openAt<0)return html;
  const tagEnd=html.indexOf('>',openAt);
  if(tagEnd<0)return html;
  const openingTag=html.slice(openAt,tagEnd+1);
  if(openingTag.includes('data-ssr='))return html; // already rendered
  const closeAt=html.indexOf('</div>',tagEnd);
  if(closeAt<0)return html;
  if(html.slice(tagEnd+1,closeAt).includes('<div'))return html; // unexpected nesting — don't guess
  const rendered=offerBlockSsrHtml();
  if(!rendered)return html;
  const tagged=openingTag.replace(OFFER_OPEN,`${OFFER_OPEN} data-ssr="catalog"`);
  return html.slice(0,openAt)+tagged+rendered+html.slice(closeAt);
}
