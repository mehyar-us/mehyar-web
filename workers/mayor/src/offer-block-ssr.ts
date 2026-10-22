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
import {PLANS,CREDIT_PACKS,approxConversations} from './billing/plans';
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
    `<p>${p.replyLimit.toLocaleString('en-US')} reply attempts (≈${approxConversations(p.replyLimit)} real conversations a month) · ${p.voiceMinuteLimit} microphone minutes a month</p>`+
    `<p class="offer-blurb">${blurb}</p></div>`;
  return `<div class="offer-plans">${row(free,'A good place to start.')}${row(pro,'For a busier business.')}</div>`+
    `<p class="offer-note">Purchases are final — no refunds. Cancel Pro renewal in Manage billing.</p>`+
    `<p class="offer-note">Usage counts reply attempts \u2014 every try counts toward your allowance, not only delivered replies. Microphone minutes count from the moment the mic opens \u2014 startup and silence included. Conversation estimates figure roughly 10 replies per conversation.</p>`+
    `<p class="offer-note">Calls, texts, and your business number run through your own provider account (Telnyx or Twilio): your provider bills you directly for number rental, calls, and messages at its own rates \u2014 separate from your Mayor plan, and never on your Mayor bill. Twilio numbers connect for voice calls; automatic text-backs are sent through Telnyx.</p>`;
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
    `<p class="plan-tier">${p.replyLimit.toLocaleString('en-US')} reply attempts (≈${approxConversations(p.replyLimit)} real conversations a month) · `+
    `${p.voiceMinuteLimit} microphone minutes a month</p>`+
    `<p>${blurb}</p><a class="button button-small" href="${p.id==='pro'?'/billing?plan=pro':'/?start=1'}">`+
    `${p.id==='pro'?`Go Pro — ${escapeHtml(formatPrice(p.priceCents))}/mo`:'Start free'}</a></article>`;
  const packCard=(p:SsrPack)=>
    `<article class="plan-card"><h3>${escapeHtml(p.name)}</h3>`+
    priceLine(p.priceCents,' one-time')+
    `<p class="plan-tier">+${p.replyAttempts.toLocaleString('en-US')} reply attempts (≈${approxConversations(p.replyAttempts)} real conversations) · `+
    `+${p.voiceMinutes} microphone minutes</p>`+
    `<a class="button button-small" href="/billing?pack=${p.id}">Buy ${escapeHtml(p.name)}</a>`+
    `<p class="pack-note">Credits expire at the end of the purchased period — they do not roll over.</p></article>`;
  return {
    plans:planCard(free,'A good place to start. Talk to The Mayor and feel the money loop working.')
      +planCard(pro,'For the busier business: the full proactive engine watching your book. Automatic text-backs are sent through Telnyx once your number is connected. Twilio numbers connect for voice calls.'),
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
export function injectPricingCards(html:string,auditAvailable=false):string{
  const rendered=pricingCardsSsrHtml();
  if(!rendered)return html;
  let out=injectIntoContainer(html,'plan-cards',rendered.plans);
  out=injectIntoContainer(out,'topup-cards',rendered.packs);
  out=injectIntoContainer(out,'audit-card',auditCardSsrHtml());
  return injectStructuredData(out,auditAvailable);
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
    `<p class="plan-tier">${free.replyLimit.toLocaleString('en-US')} reply attempts (≈${approxConversations(free.replyLimit)} real conversations a month) · ${free.voiceMinuteLimit} microphone minutes a month</p>`+
    `<p>Talk to The Mayor, tell it about your business, and feel the money loop working: missed-call text-backs once your number is connected (automatic text-backs send through Telnyx), reminders, and the morning briefing.</p>`+
    `<a class="button button-small" href="/?start=1">Start free</a></article>`;
  const grow=
    `<article class="plan-card"><h3>Pro</h3>`+
    priceLine(pro.priceCents,' / month')+
    `<p class="plan-tier">${pro.replyLimit.toLocaleString('en-US')} reply attempts (≈${approxConversations(pro.replyLimit)} real conversations a month) · ${pro.voiceMinuteLimit} microphone minutes a month</p>`+
    `<p>For the busier shop: more reply attempts, more microphone minutes, and the full proactive engine watching your book. Automatic text-backs are sent through Telnyx once your number is connected. Twilio numbers connect for voice calls. No hidden fees \u2014 phone and messaging usage is billed by your own provider at its rates, never marked up by us.</p>`+
    `<a class="button button-small" href="/billing?plan=pro">Go Pro — ${escapeHtml(formatPrice(pro.priceCents))}/mo</a></article>`;
  const topup=
    `<article class="plan-card"><h3>Top up</h3>`+
    `<p class="plan-tier">One-time, as you need it</p>`+
    `<ul class="pack-list">`+
    packs.map(p=>`<li><strong>${escapeHtml(p.name)} — ${escapeHtml(formatPrice(p.priceCents))}</strong> · +${p.replyAttempts.toLocaleString('en-US')} reply attempts (≈${approxConversations(p.replyAttempts)} real conversations) · +${p.voiceMinutes} microphone minutes</li>`).join('')+
    `</ul>`+
    `<p>Buy only what you use — no subscription change, no overage surprises.</p>`+
    `<p class="pack-note">Credits expire at the end of the purchased period — they do not roll over.</p>`+
    `<a class="button button-small" href="/pricing">See pricing</a></article>`;
  return start+grow+topup;
}
/**
 * Inject the server-rendered priced cards into the #sales-plan-cards
 * container of a served /sales page. Returns the HTML UNCHANGED when the
 * container is missing, already server-rendered, or the catalog can't be
 * trusted — the price-free fallback cards then stay in place.
 */
export function injectSalesPlans(html:string,auditAvailable=false):string{
  const rendered=salesPlansSsrHtml();
  if(!rendered)return html;
  let out=injectIntoContainer(html,'sales-plan-cards',rendered);
  const audit=auditCardSsrHtml();
  if(audit)out=injectIntoContainer(out,'sales-audit',audit);
  return injectFaqPage(injectStructuredData(out,auditAvailable));
}
/* ------------------------------------------------------------------ */
/* Structured data (rot130): a Product record for the selling pages,    */
/* built at serve time from the same catalog objects the cards render   */
/* from, so a price in the JSON-LD can never drift from the charged     */
/* price. Amounts are schema numbers (price + priceCurrency), never     */
/* display strings.                                                     */
/* ------------------------------------------------------------------ */
export function structuredDataSsrHtml(auditAvailable:boolean):string{
  const offers:Record<string,unknown>[]=[];
  for(const p of PLANS){
    if(!validPlan(p))continue;
    const offer:Record<string,unknown>={
      '@type':'Offer',name:p.name,price:p.priceCents/100,priceCurrency:p.currency,
      availability:'https://schema.org/InStock',url:'https://mayor.mehyar.us/pricing',
    };
    if(p.priceCents>0)offer.priceSpecification={'@type':'UnitPriceSpecification',price:p.priceCents/100,priceCurrency:p.currency,unitText:'MON'};
    offers.push(offer);
  }
  for(const p of CREDIT_PACKS){
    if(!validPack(p))continue;
    offers.push({'@type':'Offer',name:`${p.name} top-up`,price:p.priceCents/100,priceCurrency:p.currency,availability:'https://schema.org/InStock',url:'https://mayor.mehyar.us/pricing'});
  }
  offers.push({'@type':'Offer',name:AUDIT_OFFER.name,price:AUDIT_OFFER.priceCents/100,priceCurrency:AUDIT_OFFER.currency,availability:auditAvailable?'https://schema.org/InStock':'https://schema.org/OutOfStock',url:'https://mayor.mehyar.us/business-audit'});
  const data={
    '@context':'https://schema.org','@type':'Product',name:'The Mayor',
    description:'An AI chief of staff for local business owners. Once a business number is connected, it answers missed calls and texts back leads, and keeps the day\'s money in view.',
    brand:{'@type':'Brand',name:'The Mayor'},
    offers,
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}
export function injectStructuredData(html:string,auditAvailable=false):string{
  if(html.includes('"@type":"Product"'))return html;
  return html.replace('</head>',`${structuredDataSsrHtml(auditAvailable)}</head>`);
}
/* FAQPage structured data: built from the same Q&A text the /sales page
 * shows in its visible FAQ (a unit test pins the two to the same strings,
 * so the markup can never drift from what visitors read). */
const SALES_FAQ:{q:string;a:string}[]=[
  {q:'Do you guarantee more bookings or revenue?',a:'No. The examples on this page are illustrative walkthroughs of the missed-call text-back flow \u2014 not customer stories and not promises. The Mayor answers faster and keeps your day organized; results vary by business.'},
  {q:'What happens after I sign up?',a:'You sign in, tell The Mayor about your business, and it starts with your real book: missed-call text-back, reminders, and a daily briefing in your language.'},
  {q:'Which phone providers does The Mayor work with?',a:'You connect a business number you own through Telnyx or Twilio. Once a Telnyx number is connected, missed-call text-backs are sent automatically from that number; until a number is connected, The Mayor prepares drafts you can copy into your own messaging app. Twilio numbers connect for voice calls; automatic text-backs are sent through Telnyx.'},
];
export function faqPageSsrHtml():string{
  const data={'@context':'https://schema.org','@type':'FAQPage',mainEntity:SALES_FAQ.map(({q,a})=>({'@type':'Question',name:q,acceptedAnswer:{'@type':'Answer',text:a}}))};
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}
export function injectFaqPage(html:string):string{
  if(html.includes('"@type":"FAQPage"'))return html;
  return html.replace('</head>',`${faqPageSsrHtml()}</head>`);
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
    `<p>A reviewed report covering ${escapeHtml(scope)} — plus ${escapeHtml(plan)}. Payment queues your audit: the report is generated after intake and put through a separate AI review, not delivered instantly.</p>`+
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

/* Homepage hero price anchor (rot156): the Pro price above the fold,
 * rendered from the same catalog as every other figure. The placeholder
 * ships empty; if the catalog can't be trusted the anchor stays empty —
 * never a stale or hardcoded price. */
export function heroPriceSsrText():string|null{
  const free=PLANS.find(p=>p.id==='free'),pro=PLANS.find(p=>p.id==='pro');
  if(!validPlan(free)||!validPlan(pro))return null;
  return `Start free \u00b7 Pro ${formatPrice(pro.priceCents)}/mo`;
}
const HERO_PRICE_EMPTY='<p class="hero-price" id="hero-price"></p>';
export function injectHeroPrice(html:string):string{
  if(!html.includes(HERO_PRICE_EMPTY))return html;
  const text=heroPriceSsrText();
  if(!text)return html;
  return html.replace(HERO_PRICE_EMPTY,`<p class="hero-price" id="hero-price">${escapeHtml(text)}</p>`);
}
