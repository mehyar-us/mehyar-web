/**
 * sales-pricing.ts — pure, DOM-free logic for the /sales page.
 *
 * Pricing NEVER hardcodes dollar amounts here: every price renders from the
 * GET /api/billing/catalog payload (plans.ts is the single source of truth).
 * A staged pricing change ships with zero code changes
 * because this module only formats whatever the catalog serves.
 */
import {VERTICAL_PROFILES,type Vertical} from '../src/verticals';

export interface CatalogPlan{
 id:string;name:string;priceCents:number;interval:string;
 replyLimit:number;voiceMinuteLimit:number;
}
export interface CatalogPack{
 id:string;name:string;priceCents:number;replyAttempts:number;voiceMinutes:number;
}
export interface PricingCatalog{
 currency:string;plans:CatalogPlan[];creditPacks:CatalogPack[];
}

/** Format a cent amount using the catalog's own currency. Never a literal $. */
export function formatPriceCents(priceCents:number,currency='USD'):string{
 if(!Number.isSafeInteger(priceCents)||priceCents<0)throw new Error('invalid_price_cents');
 const major=priceCents/100;
 const fractionDigits=Number.isInteger(major)?0:2;
 return new Intl.NumberFormat('en-US',{style:'currency',currency,minimumFractionDigits:fractionDigits,maximumFractionDigits:fractionDigits}).format(major);
}

function isRecord(value:unknown):value is Record<string,unknown>{
 return typeof value==='object'&&value!==null;
}
function num(value:unknown):number|null{
 return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
}
function str(value:unknown):string|null{
 return typeof value==='string'&&value.length>0?value:null;
}

/**
 * Validate the /api/billing/catalog payload. Returns null on any shape
 * mismatch so the page shows the "unavailable" state instead of guessing.
 */
export function parseCatalog(data:unknown):PricingCatalog|null{
 if(!isRecord(data))return null;
 const currency=str(data.currency)??'USD';
 const rawPlans=Array.isArray(data.plans)?data.plans:null;
 const rawPacks=Array.isArray(data.creditPacks)?data.creditPacks:null;
 if(!rawPlans||!rawPacks)return null;
 const plans:CatalogPlan[]=[];
 for(const raw of rawPlans){
  if(!isRecord(raw))return null;
  const priceCents=num(raw.priceCents);const replyLimit=num(raw.replyLimit);
  const voiceMinuteLimit=num(raw.voiceMinuteLimit);
  const id=str(raw.id);const name=str(raw.name);const interval=str(raw.interval);
  if(priceCents===null||replyLimit===null||voiceMinuteLimit===null||!id||!name||!interval)return null;
  plans.push({id,name,priceCents,interval,replyLimit,voiceMinuteLimit});
 }
 const creditPacks:CatalogPack[]=[];
 for(const raw of rawPacks){
  if(!isRecord(raw))return null;
  const priceCents=num(raw.priceCents);const replyAttempts=num(raw.replyAttempts);
  const voiceMinutes=num(raw.voiceMinutes);
  const id=str(raw.id);const name=str(raw.name);
  if(priceCents===null||replyAttempts===null||voiceMinutes===null||!id||!name)return null;
  creditPacks.push({id,name,priceCents,replyAttempts,voiceMinutes});
 }
 if(plans.length===0)return null;
 return {currency,plans,creditPacks};
}

function escapeHtml(text:string):string{
 return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function intervalLabel(interval:string):string{
 if(interval==='month')return 'per month';
 if(interval==='calendar_month')return 'per calendar month';
 return `per ${interval.replace(/_/g,' ')}`;
}
function countLabel(value:number,singular:string,plural:string):string{
 return `${value.toLocaleString('en-US')} ${value===1?singular:plural}`;
}

/** Full pricing section body, rendered from the live catalog. */
export function renderPricingHtml(catalog:PricingCatalog):string{
 const planCards=catalog.plans.map(plan=>{
  const price=formatPriceCents(plan.priceCents,catalog.currency);
  const popular=plan.id==='pro';
  return `<article class="price-card${popular?' price-card-popular':''}" aria-label="${escapeHtml(plan.name)} plan">
   ${popular?'<span class="price-badge">Most popular</span>':''}
   <h3>${escapeHtml(plan.name)}</h3>
   <p class="price-amount"><span class="price-value">${escapeHtml(price)}</span><span class="price-interval">${escapeHtml(intervalLabel(plan.interval))}</span></p>
   <ul class="price-features">
    <li>${escapeHtml(countLabel(plan.replyLimit,'reply attempt','reply attempts'))} included</li>
    <li>${escapeHtml(countLabel(plan.voiceMinuteLimit,'voice minute','voice minutes'))} included</li>
   </ul>
   <a class="button${popular?'':' button-outline'}" href="/">Start free</a>
  </article>`;
 }).join('');
 const packCards=catalog.creditPacks.map(pack=>{
  const price=formatPriceCents(pack.priceCents,catalog.currency);
  return `<article class="price-card pack-card" aria-label="${escapeHtml(pack.name)} credit pack">
   <h3>${escapeHtml(pack.name)} pack</h3>
   <p class="price-amount"><span class="price-value">${escapeHtml(price)}</span><span class="price-interval">one-time</span></p>
   <ul class="price-features">
    <li>${escapeHtml(countLabel(pack.replyAttempts,'reply attempt','reply attempts'))}</li>
    <li>${escapeHtml(countLabel(pack.voiceMinutes,'voice minute','voice minutes'))}</li>
   </ul>
   <a class="button button-outline" href="/">Start free</a>
  </article>`;
 }).join('');
 return `<div class="price-grid" role="list">${planCards}</div>
  ${packCards?`<h3 class="packs-heading">Top-up credit packs</h3><div class="price-grid" role="list">${packCards}</div>`:''}
  <p class="pricing-note">Prices in ${escapeHtml(catalog.currency)}. What you see is what you are charged — no hidden fees. Purchases are final and non-refundable. Cancel a Pro renewal anytime from Manage billing inside the app.</p>`;
}

/** Shown when the catalog fetch fails or the payload is unusable. Never guesses a price. */
export function renderPricingUnavailableHtml():string{
 return `<div class="pricing-unavailable" role="status"><p><strong>Pricing is unavailable right now.</strong></p><p>Please try again in a moment, or sign in to see current plans inside the app.</p><p><a class="button button-outline" href="/">Sign in</a></p></div>`;
}

// ── Money-loop examples ──────────────────────────────────────────────────
// One illustrative example per vertical, sourced from VERTICAL_PROFILES
// (vocabulary, text-back templates, KPI labels). Each is explicitly labeled
// illustrative — no invented revenue, no fake customers, no testimonials.

export interface MoneyLoopExample{
 vertical:Vertical;
 tradeLabel:string;
 customer:string;booking:string;staff:string;
 miss:string;
 textback:string;
 recover:string;
 kpis:{label:string;hint:string}[];
}

const VERTICAL_ORDER:Exclude<Vertical,'other'>[]=['salon','restaurant','plumbing_hvac','dental','auto_repair','pet_grooming','med_spa'];

const MISS_COPY:Record<Exclude<Vertical,'other'>,string>={
 salon:'A regular calls on your day off to move her color appointment. Nobody picks up — normally that chair sits empty and she books somewhere else.',
 restaurant:'A party of six calls at 6:40 on a Friday. The line is slammed, the call goes unanswered — normally that table goes to whoever picks up first.',
 plumbing_hvac:'A homeowner calls at 9:20 at night about a leaking water heater. Nobody answers — normally they call the next plumber on the list.',
 dental:'A patient calls during lunch to reschedule a cleaning. The front desk is out — normally that hygiene chair stays empty.',
 auto_repair:'A driver calls mid-morning about a brake noise. The bay is full and the phone rings out — normally they drive to the shop across town.',
 pet_grooming:'A client calls Saturday morning for a same-day groom before a trip. Nobody answers — normally that table stays open and the dog goes unwashed.',
 med_spa:'A client calls after hours about a consultation. Nobody picks up — normally she books with the spa that answers first.',
};

const RECOVER_COPY:Record<Exclude<Vertical,'other'>,string>={
 salon:'She replies YES. The Mayor follows up with your open chair times, and the rebooked appointment lands on your book before you open the shop.',
 restaurant:'They reply YES. The Mayor confirms the party size and holds the reservation — a Friday table that would have gone elsewhere.',
 plumbing_hvac:'They reply YES. The Mayor triages it as urgent, and the job is on tomorrow\u2019s board before you wake up.',
 dental:'They reply YES. The Mayor offers your open hygiene times, and the recare visit is rebooked without a phone tag loop.',
 auto_repair:'They reply YES. The Mayor takes the vehicle details and the service appointment is on the board — the ticket stays with you.',
 pet_grooming:'They reply YES. The Mayor finds the open table and the grooming appointment is booked before the trip.',
 med_spa:'She replies YES. The Mayor books the consultation into your open room time — the lead never cools.',
};

// Compliance guard (item 12): KPI hints may carry illustrative money figures
// (e.g. the med_spa no-show hint's four-hundred-dollar claim). A sales page must not
// repeat unsupported revenue claims, so any hint clause carrying a dollar
// amount is dropped, keeping the definitional part. Flagged to the
// coordinator: review the med_spa no-show hint in src/verticals.ts for the
// in-app surface too.
function salesSafeHint(hint:string):string{
 const stripped=hint.replace(/\s*[—–-]\s*[^—–-]*\$[^—–-]*/g,' ').replace(/\s+/g,' ').trim();
 return stripped.length>0?stripped:hint.replace(/\$\d[\d,.]*/g,'an amount that varies');
}

export function buildMoneyLoopExamples():MoneyLoopExample[]{
 return VERTICAL_ORDER.map(vertical=>{
  const profile=VERTICAL_PROFILES[vertical];
  const textback=profile.textbackTemplate.replace('{business}','your business');
  return {
   vertical,
   tradeLabel:profile.label,
   customer:profile.vocabulary.customer,
   booking:profile.vocabulary.booking,
   staff:profile.vocabulary.staff,
   miss:MISS_COPY[vertical],
   textback,
   recover:RECOVER_COPY[vertical],
   kpis:(profile.kpis??[]).map(kpi=>({label:kpi.label,hint:salesSafeHint(kpi.hint)})),
  };
 });
}

export function renderMoneyLoopHtml(examples:MoneyLoopExample[]):string{
 return examples.map(example=>{
  const kpiChips=example.kpis.map(kpi=>
   `<li title="${escapeHtml(kpi.hint)}">${escapeHtml(kpi.label)}</li>`).join('');
  return `<article class="loop-card">
   <p class="loop-example-label"><span class="example-badge">Example</span> Illustrative — results vary</p>
   <h3>${escapeHtml(example.tradeLabel)}</h3>
   <ol class="loop-steps">
    <li><strong>The missed ${escapeHtml(example.booking)}.</strong> ${escapeHtml(example.miss)}</li>
    <li><strong>The instant text-back.</strong> The Mayor texts within a minute, in your voice: <q>${escapeHtml(example.textback)}</q></li>
    <li><strong>The recovered ${escapeHtml(example.booking)}.</strong> ${escapeHtml(example.recover)}</li>
   </ol>
   ${kpiChips?`<p class="loop-kpis-label">Watch it move your numbers:</p><ul class="kpi-chips">${kpiChips}</ul>`:''}
  </article>`;
 }).join('');
}
