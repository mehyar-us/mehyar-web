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
    `<p>${p.replyLimit.toLocaleString('en-US')} assistant replies · ${p.voiceMinuteLimit} microphone minutes a month</p>`+
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
    `<p class="plan-tier">${p.replyLimit.toLocaleString('en-US')} assistant replies · `+
    `${p.voiceMinuteLimit} microphone minutes a month</p>`+
    `<p>${blurb}</p><a class="button button-small" href="/">Start free</a></article>`;
  const packCard=(p:SsrPack)=>
    `<article class="plan-card"><h3>${escapeHtml(p.name)}</h3>`+
    priceLine(p.priceCents,' one-time')+
    `<p class="plan-tier">+${p.replyAttempts.toLocaleString('en-US')} reply attempts · `+
    `+${p.voiceMinutes} microphone minutes</p></article>`;
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
  return out;
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
