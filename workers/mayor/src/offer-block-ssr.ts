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
import {PLANS,CREDIT_PACKS,approxConversations,FOUNDING_PRICE_CENTS} from './billing/plans';
import {AUDIT_OFFER} from './billing/audit';
import {providerExampleSsrHtml} from './provider-example';

function escapeHtml(value:string):string{
  return value.replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string));
}
function formatPrice(cents:number):string{
  return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(cents/100);
}
/** The founding price is not a whole-dollar amount — always show its cents. */
function formatPriceExact(cents:number):string{
  return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100);
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
/* The home audit band (front-door repair): the extensive business
 * audit, priced from AUDIT_OFFER and linked to its own page — only
 * while the audit offer is available (the same gate the checkout
 * enforces).
 * rot564 sell-first rework (2026-10-22): the band's PLACEMENT moved.
 * It no longer rides at the foot of the offer block (below the
 * sign-in buttons); injectHomeAuditSlot renders it into the
 * #home-audit-slot container ABOVE the one surviving sign-in block,
 * so a cold visitor meets the audit call to action before the
 * sign-in wall. Markup, price source, availability gate, and copy
 * are unchanged — only the position moved.
 * Paused annotation (2026-10-23, Product Chief order): while the hub
 * Audit checkouts are paused (claim-posture ruling — paid rungs stay
 * down until report generation verifiably runs the real AI), the band
 * says so BEFORE the click and names what the click delivers today
 * (the free scan + the notify path). The state is read at serve time
 * from the hub's availability flag (billing/audit-availability) and
 * the annotation is keyed off it: the serve path passes the flag's
 * value, so the note retires itself when the hub unpauses. Only an
 * affirmative unpaused read omits it. */
export function homeAuditBandSsrHtml(auditPausedState:boolean):string{
  // WS1 build 2 (2026-10-16): promoted from a footnote line to a card
 // at the plan rows' weight (rot298 input 1) — same name, price,
 // sentence, and link; the price still comes only from AUDIT_OFFER.
 const note=auditPausedState?`<p class="home-audit-note">Audit checkout is paused while report generation is restored. The free scan is open, and the audit page can notify you when checkout returns.</p>`:'';
 return `<aside class="home-audit-band"><div class="home-audit-head"><strong>${escapeHtml(AUDIT_OFFER.name)}</strong><span class="home-audit-price">${escapeHtml(formatPrice(AUDIT_OFFER.priceCents))} one-time</span></div><p>A reviewed report on how people find your business, become customers, and come back — plus a practical plan for a better workday.</p>${note}<a class="home-audit-cta" href="/business-audit">See the business audit</a></aside>`;
}

export function offerBlockSsrHtml(founding?:FoundingSsrBlock|null):string|null{
  const free=PLANS.find(p=>p.id==='free'),pro=PLANS.find(p=>p.id==='pro');
  if(!validPlan(free)||!validPlan(pro))return null;
  const row=(p:SsrPlan,blurb:string,extra='')=>
    `<div class="offer-plan"><div class="offer-plan-head"><strong>${escapeHtml(p.name)}</strong>`+
    `<span class="offer-price">${escapeHtml(formatPrice(p.priceCents))}${p.priceCents>0?'<span class="offer-per"> / month</span>':''}</span></div>`+
    `<p>${p.replyLimit.toLocaleString('en-US')} reply attempts (≈${approxConversations(p.replyLimit)} real conversations a month) · ${p.voiceMinuteLimit} microphone minutes a month</p>`+
    `<p class="offer-blurb">${blurb}</p>${extra}</div>`;
  // WS1 build 2 (rot298 input 2): the founding line joins the home
 // offer block under the Pro row — the SAME helper and the SAME
 // fail-quiet seam as /sales and /pricing (no state, no line).
 // rot543 fold: the final-sale disclosure (FINAL_SALE_LINE, below)
 // rides the home Pro row too — 🔵 rot543 ruling: the home ask joins
 // the /pricing + /sales scope. It is unconditional (not founding
 // state): the row presents the Pro price, so the ask is disclosed
 // whether or not the founding line renders.
 return `<div class="offer-plans">${row(free,'A good place to start.')}${row(pro,'For a busier business.',foundingLineSsrHtml(founding)+FINAL_SALE_LINE)}</div>`+
    `<p class="offer-note">Cancel Pro renewal in Manage billing.</p>`+
    `<p class="offer-note">Usage counts reply attempts \u2014 every try counts toward your allowance, not only delivered replies. Microphone minutes count from the moment the mic opens \u2014 startup and silence included. Conversation estimates figure roughly 10 replies per conversation.</p>`+
    `<p class="offer-note">Calls, texts, and your business number run through your own provider account (Telnyx or Twilio): your provider bills you directly for number rental, calls, and messages at its own rates \u2014 separate from your Mayor plan, and never on your Mayor bill. Twilio numbers connect for voice calls; automatic text-backs are sent through Telnyx.</p>`;
}


/* Sales-copy micro-pass (2026-10-17): the labeled Telnyx worked
 * example rides directly after the provider note on /sales and
 * /pricing. The anchor is the note's closing sentence; its first
 * occurrence in each page is the plans-section note (the /sales FAQ
 * repeats the sentence later). Missing anchor -> fail quiet. */
const PROVIDER_NOTE_END='automatic text-backs are sent through Telnyx.</p>';
export function injectProviderExample(html:string):string{
  if(html.includes('Worked example — what that provider bill comes to'))return html; // idempotent (rot107 pin)
  const at=html.indexOf(PROVIDER_NOTE_END);
  if(at<0)return html;
  const cut=at+PROVIDER_NOTE_END.length;
  return html.slice(0,cut)+'\n      '+providerExampleSsrHtml()+html.slice(cut);
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
export interface FoundingSsrBlock {available:boolean;seats_total:number;seats_taken:number|null;seats_remaining:number|null;}
/** The founding line inside the Pro card (locked seam): a live remaining
 * count only when the count was computable, seats remain, AND at least
 * one seat has been claimed; the static cohort line (no live number)
 * when the count is unavailable OR while claimed is still zero
 * (post-deploy pass item 1 — Option A threshold display, 2026-10-22);
 * nothing once the cohort is full — the list block stands alone. */
export function foundingLineSsrHtml(founding?:FoundingSsrBlock|null):string{
 if(!founding)return '';
 // Reinvention Slice 1 — the founding door, whole (blueprint §2.1 E-0):
 // the line is a REAL anchor to /billing?plan=founding. Visibility
 // conditions are unchanged (live count only while computable and
 // seats remain; the static no-number line when the count is
 // unavailable; nothing once the cohort is full) — the anchor carries
 // intent only; the seat gate still decides at claim time.
 const staticLine=`<p class="plan-founding"><a href="/billing?plan=founding">Founding cohort: <strong>${escapeHtml(formatPriceExact(FOUNDING_PRICE_CENTS))}/mo locked for life</strong> for the first ${founding.seats_total} businesses.</a></p>`;
 if(founding.available){
  if(founding.seats_remaining===null||founding.seats_remaining<=0)return '';
  // Post-deploy pass item 1 (2026-10-22, Product Chief ruling —
  // seat-counter framing Option A, threshold display): while NO
  // founding seat has been claimed (seats_taken === 0 on the SAME
  // serve-time count this line already reads — the foundingSeats
  // subscription-row count; no second source, no cached state),
  // present the offer on the established static cohort line with no
  // numeric remainder. The moment the first founding subscription
  // row exists (seats_taken ≥ 1), the counter renders exactly as
  // before. An unknown taken count (null) keeps the counted line.
  if(founding.seats_taken===0)return staticLine;
  return `<p class="plan-founding"><a href="/billing?plan=founding">Founding cohort: <strong>${escapeHtml(formatPriceExact(FOUNDING_PRICE_CENTS))}/mo locked for life</strong> — ${founding.seats_remaining} of ${founding.seats_total} seats left.</a></p>`;
 }
 return staticLine;
}
/* rot535 fold (Product Chief order, 2026-10-22): the final-sale
 * disclosure at the purchase asks — one line, Terms linked, riding the
 * Pro card on /pricing and /sales (the card that carries both the Pro
 * CTA and the founding anchor, so both asks are covered). Disclosure
 * only: no refund flow exists or is implied, and the pages' separate
 * "Cancel anytime" renewal line stands untouched beside it.
 * rot543 extension (🔵 ruling, same day): the scope completes — the
 * home Pro ask joins (offerBlockSsrHtml above + the React mirror in
 * web/offer-block.tsx), and the top-up pack cards gain the line on
 * /pricing and /sales (a top-up is a purchase; no carve-out for
 * in-product asks), alongside — never replacing — the packs' expiry
 * truth. The verticals remain out of scope for this line.
 * rot551 fold C4 (🔵 order, same day) SUPERSEDES that last sentence:
 * the seven vertical pages gain the same sales cards (injectVertical-
 * Plans below, reusing salesPlansSsrHtml), so their Pro and top-up
 * asks carry this line too — the checklist carve-out that kept the
 * verticals ask-free is retired by name in the rot551 addendum. */
export const FINAL_SALE_LINE=`<p class="plan-final-sale">Payments are final and non-refundable \u2014 see <a href="/terms">Terms</a>.</p>`;
export function pricingCardsSsrHtml(founding?:FoundingSsrBlock|null):{plans:string;packs:string}|null{
  const free=PLANS.find(p=>p.id==='free'),pro=PLANS.find(p=>p.id==='pro');
  if(!validPlan(free)||!validPlan(pro))return null;
  const packs=[...CREDIT_PACKS];
  if(packs.length===0||!packs.every(validPack))return null;
  const planCard=(p:SsrPlan,blurb:string)=>
    `<article class="plan-card"><h3>${escapeHtml(p.name)}</h3>`+
    priceLine(p.priceCents,p.priceCents>0?' / month':'')+
    `<p class="plan-tier">${p.replyLimit.toLocaleString('en-US')} reply attempts (≈${approxConversations(p.replyLimit)} real conversations a month) · `+
    `${p.voiceMinuteLimit} microphone minutes a month</p>`+
    `<p>${blurb}</p>${p.id==='pro'?foundingLineSsrHtml(founding):''}<a class="button button-small" href="${p.id==='pro'?'/billing?plan=pro':'/?start=1'}">`+
    `${p.id==='pro'?`Go Pro — ${escapeHtml(formatPrice(p.priceCents))}/mo`:'Start free'}</a>${p.id==='pro'?FINAL_SALE_LINE:''}</article>`;
  const packCard=(p:SsrPack)=>
    `<article class="plan-card"><h3>${escapeHtml(p.name)}</h3>`+
    priceLine(p.priceCents,' one-time')+
    `<p class="plan-tier">+${p.replyAttempts.toLocaleString('en-US')} reply attempts (≈${approxConversations(p.replyAttempts)} real conversations) · `+
    `+${p.voiceMinutes} microphone minutes</p>`+
    `<a class="button button-small" href="/billing?pack=${p.id}">Buy ${escapeHtml(p.name)}</a>${FINAL_SALE_LINE}`+
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
export function injectPricingCards(html:string,auditAvailable=false,founding?:FoundingSsrBlock|null,auditPaused=false):string{
  const rendered=pricingCardsSsrHtml(founding);
  if(!rendered)return html;
  let out=injectIntoContainer(html,'plan-cards',rendered.plans);
  out=injectIntoContainer(out,'topup-cards',rendered.packs);
  out=injectIntoContainer(out,'audit-card',auditCardSsrHtml(auditPaused));
  return injectProviderExample(injectStructuredData(out,auditAvailable,founding));
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
export function salesPlansSsrHtml(founding?:FoundingSsrBlock|null):string|null{
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
    foundingLineSsrHtml(founding)+
    `<a class="button button-small" href="/billing?plan=pro">Go Pro — ${escapeHtml(formatPrice(pro.priceCents))}/mo</a>${FINAL_SALE_LINE}</article>`;
  const topup=
    `<article class="plan-card"><h3>Top up</h3>`+
    `<p class="plan-tier">One-time, as you need it</p>`+
    `<ul class="pack-list">`+
    packs.map(p=>`<li><strong>${escapeHtml(p.name)} — ${escapeHtml(formatPrice(p.priceCents))}</strong> · +${p.replyAttempts.toLocaleString('en-US')} reply attempts (≈${approxConversations(p.replyAttempts)} real conversations) · +${p.voiceMinutes} microphone minutes</li>`).join('')+
    `</ul>`+
    `<p>Buy only what you use — no subscription change, no overage surprises.</p>`+
    `<p class="pack-note">Credits expire at the end of the purchased period — they do not roll over.</p>`+
    `<a class="button button-small" href="/pricing">See pricing</a>${FINAL_SALE_LINE}</article>`;
  return start+grow+topup;
}
/**
 * Inject the server-rendered priced cards into the #sales-plan-cards
 * container of a served /sales page. Returns the HTML UNCHANGED when the
 * container is missing, already server-rendered, or the catalog can't be
 * trusted — the price-free fallback cards then stay in place.
 */
export function injectSalesPlans(html:string,auditAvailable=false,founding?:FoundingSsrBlock|null,auditPaused=false):string{
  const rendered=salesPlansSsrHtml(founding);
  if(!rendered)return html;
  let out=injectIntoContainer(html,'sales-plan-cards',rendered);
  const audit=auditCardSsrHtml(auditPaused);
  if(audit)out=injectIntoContainer(out,'sales-audit',audit);
  return injectProviderExample(injectFaqPage(injectStructuredData(out,auditAvailable,founding)));
}
/* ------------------------------------------------------------------ */
/* Vertical pages (rot551 fold C4): the seven /sales/<slug> pages gain */
/* the subscription offer path in the stack's established pattern —    */
/* the SAME sales cards /sales serves (salesPlansSsrHtml: Free, Pro    */
/* with the founding anchor, Top up), rendered from the live catalog   */
/* with the same serve-time founding block, injected into the page's   */
/* #vertical-plan-cards container. The generated page source stays     */
/* price-free (fallback cards, same voice as /sales); the catalog —    */
/* never a page literal — supplies every price, and FINAL_SALE_LINE    */
/* rides the Pro and top-up cards exactly as on /sales. Cards only:    */
/* the /sales extras (audit card, provider example, FAQ/JSON-LD) are   */
/* not this fold's ask and are not duplicated here. Returns the HTML   */
/* UNCHANGED when the container is missing, already server-rendered,   */
/* or the catalog can't be trusted — the fallback cards stay.          */
/* ------------------------------------------------------------------ */
export function injectVerticalPlans(html:string,founding?:FoundingSsrBlock|null):string{
  const rendered=salesPlansSsrHtml(founding);
  if(!rendered)return html;
  return injectIntoContainer(html,'vertical-plan-cards',rendered);
}
/* ------------------------------------------------------------------ */
/* Structured data (rot130): a Product record for the selling pages,    */
/* built at serve time from the same catalog objects the cards render   */
/* from, so a price in the JSON-LD can never drift from the charged     */
/* price. Amounts are schema numbers (price + priceCurrency), never     */
/* display strings.                                                     */
/* ------------------------------------------------------------------ */
export function structuredDataSsrHtml(auditAvailable:boolean,founding?:FoundingSsrBlock|null):string{
  const offers:Record<string,unknown>[]=[];
  for(const p of PLANS){
    if(!validPlan(p))continue;
    const offer:Record<string,unknown>={
      '@type':'Offer',name:p.name,price:p.priceCents/100,priceCurrency:p.currency,
      availability:'https://schema.org/InStock',url:'https://mayor.mehyar.us/pricing',
    };
    if(p.priceCents>0)offer.priceSpecification={'@type':'UnitPriceSpecification',price:p.priceCents/100,priceCurrency:p.currency,unitText:'MON'};
    offers.push(offer);
    if(p.id==='pro'){
      /* rot535 fold: the founding price is a real checkout price that
       * both selling pages render (the founding anchor) — the
       * structured data must carry it too, from the same catalog
       * constant (FOUNDING_PRICE_CENTS), or crawlers see a price set
       * that omits it. Availability mirrors the visible founding line
       * exactly: OutOfStock only when the block says the cohort is
       * full (the same condition under which the line disappears). */
      const foundingFull=!!founding&&founding.available&&(founding.seats_remaining===null||founding.seats_remaining<=0);
      offers.push({
        '@type':'Offer',name:'Founding cohort',price:FOUNDING_PRICE_CENTS/100,priceCurrency:'USD',
        availability:foundingFull?'https://schema.org/OutOfStock':'https://schema.org/InStock',url:'https://mayor.mehyar.us/pricing',
        priceSpecification:{'@type':'UnitPriceSpecification',price:FOUNDING_PRICE_CENTS/100,priceCurrency:'USD',unitText:'MON'},
      });
    }
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
export function injectStructuredData(html:string,auditAvailable=false,founding?:FoundingSsrBlock|null):string{
  if(html.includes('"@type":"Product"'))return html;
  return html.replace('</head>',`${structuredDataSsrHtml(auditAvailable,founding)}</head>`);
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
/* queue-not-instant delivery truth. Final-sale language lives only  */
/* in Terms/Privacy, post-purchase surfaces, and the /business-audit  */
/* checkout itself (Mayor scope ruling, 2026-10-17).                   */
/* ------------------------------------------------------------------ */
export function auditCardSsrHtml(auditPaused=false):string{
  const scope=AUDIT_OFFER.scope.slice(0,-1).join(', ').toLowerCase();
  const plan=AUDIT_OFFER.scope[AUDIT_OFFER.scope.length-1].toLowerCase();
  /* Paused form (2026-10-23, generation-state pause): the offer stays
   * visible with its paused state stated before any click, and the
   * purchase action is retired — the surviving link is the informational
   * one the homepage band uses, to the page that presents the pause. No
   * "Payment queues your audit" claim while no payment can be taken. */
  if(auditPaused)return `<article class="plan-card"><h3>${escapeHtml(AUDIT_OFFER.name)}</h3>`+
    priceLine(AUDIT_OFFER.priceCents,' one-time')+
    `<p class="plan-tier">One business · one focused plan</p>`+
    `<p>A reviewed report covering ${escapeHtml(scope)} — plus ${escapeHtml(plan)}. The report is generated after intake and put through a separate AI review, not delivered instantly.</p>`+
    `<p class="audit-paused-note">Audit checkout is paused while report generation is restored.</p>`+
    `<a class="button button-small" href="/business-audit">See the business audit</a></article>`;
  return `<article class="plan-card"><h3>${escapeHtml(AUDIT_OFFER.name)}</h3>`+
    priceLine(AUDIT_OFFER.priceCents,' one-time')+
    `<p class="plan-tier">One business · one focused plan</p>`+
    `<p>A reviewed report covering ${escapeHtml(scope)} — plus ${escapeHtml(plan)}. Payment queues your audit: the report is generated after intake and put through a separate AI review, not delivered instantly.</p>`+
    `<a class="button button-small" href="/business-audit">Start your audit</a></article>`;
}
/**
 * Inject the server-rendered pricing into the #offer-block container of a
 * served home page. Marks the container data-ssr="catalog" so the client
 * hydration skips it. Returns the HTML UNCHANGED when the container is
 * missing, already server-rendered, structurally unexpected, or the catalog
 * can't be trusted — the price-free client fallback then stays in place.
 */
export function injectOfferBlock(html:string,founding?:FoundingSsrBlock|null):string{
  const openAt=html.indexOf(OFFER_OPEN);
  if(openAt<0)return html;
  const tagEnd=html.indexOf('>',openAt);
  if(tagEnd<0)return html;
  const openingTag=html.slice(openAt,tagEnd+1);
  if(openingTag.includes('data-ssr='))return html; // already rendered
  const closeAt=html.indexOf('</div>',tagEnd);
  if(closeAt<0)return html;
  if(html.slice(tagEnd+1,closeAt).includes('<div'))return html; // unexpected nesting — don't guess
  const rendered=offerBlockSsrHtml(founding);
  if(!rendered)return html;
  const tagged=openingTag.replace(OFFER_OPEN,`${OFFER_OPEN} data-ssr="catalog"`);
  return html.slice(0,openAt)+tagged+rendered+html.slice(closeAt);
}

/**
 * Inject the audit band into the #home-audit-slot container of a served
 * home page, above the sign-in buttons (rot564 sell-first rework,
 * 2026-10-22 — the band moved out of the offer block; see
 * homeAuditBandSsrHtml). Marks the container data-ssr="catalog" like
 * the other injections. Returns the HTML UNCHANGED when the audit
 * offer is unavailable, the container is missing or already rendered,
 * or its content is not the expected empty slot — the slot then stays
 * empty and the page keeps its price-free static form.
 * `auditPausedState` is the serve-time hub availability read (see
 * billing/audit-availability): true renders the band's paused
 * annotation, false renders the band exactly as before the pause.
 */
const AUDIT_SLOT_OPEN='<div id="home-audit-slot"';
export function injectHomeAuditSlot(html:string,auditAvailable:boolean,auditPausedState:boolean):string{
  if(!auditAvailable)return html;
  const openAt=html.indexOf(AUDIT_SLOT_OPEN);
  if(openAt<0)return html;
  const tagEnd=html.indexOf('>',openAt);
  if(tagEnd<0)return html;
  const openingTag=html.slice(openAt,tagEnd+1);
  if(openingTag.includes('data-ssr='))return html; // already rendered
  const closeAt=html.indexOf('</div>',tagEnd);
  if(closeAt<0)return html;
  if(html.slice(tagEnd+1,closeAt).trim()!=='')return html; // unexpected content — don't guess
  const tagged=openingTag.replace(AUDIT_SLOT_OPEN,`${AUDIT_SLOT_OPEN} data-ssr="catalog"`);
  return html.slice(0,openAt)+tagged+homeAuditBandSsrHtml(auditPausedState)+html.slice(closeAt);
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
  // The start segment is a working CTA (chief's micro-fix 2026-10-17:
  // the signed-out hero carried the words but no link). The visible
  // text is byte-identical to heroPriceSsrText(); only the first
  // segment becomes the /?start=1 anchor every plan card uses.
  const sep=' \u00b7 ';
  const at=text.indexOf(sep);
  const inner=at<0
    ?`<a href="/?start=1">${escapeHtml(text)}</a>`
    :`<a href="/?start=1">${escapeHtml(text.slice(0,at))}</a>${escapeHtml(text.slice(at))}`;
  return html.replace(HERO_PRICE_EMPTY,`<p class="hero-price" id="hero-price">${inner}</p>`);
}
