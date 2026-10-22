// Public offer block — plan terms rendered ONLY from the live billing catalog.
// React migration S0 (Mayor direct order, Oct 13): this surface is now a
// React component. The exported API is unchanged — offerBlockHtml(catalog)
// returns the same markup (or null), and loadOfferBlock() keeps its fetch +
// SSR-skip behavior — but the markup itself is rendered by React
// (renderToStaticMarkup: this block has no client state to hydrate).
//
// Prices are never hardcoded here: every amount comes from /api/billing/catalog
// at render time. If the catalog is unreachable or malformed, offerBlockHtml
// returns null and the static price-free fallback in index.html stays in place
// (a stale amount is never shown).
import {renderToStaticMarkup} from 'react-dom/server';

export interface OfferPlan{id:string;name:string;priceCents:number;interval:string;replyLimit:number;voiceMinuteLimit:number}
export interface OfferCatalog{currency:string;plans:OfferPlan[]}

function formatPrice(cents:number,currency:string):string{
 return new Intl.NumberFormat(undefined,{style:'currency',currency,maximumFractionDigits:0}).format(cents/100);
}
function validPlan(p:unknown):p is OfferPlan{
 const v=p as Record<string,unknown>|null;
 return !!v&&typeof v.id==='string'&&typeof v.name==='string'&&typeof v.priceCents==='number'&&Number.isFinite(v.priceCents)&&(v.priceCents as number)>=0&&typeof v.replyLimit==='number'&&typeof v.voiceMinuteLimit==='number';
}
function catalogOffer(catalog:unknown):{free:OfferPlan,pro:OfferPlan,currency:string}|null{
 const plans=(catalog as OfferCatalog|undefined)?.plans;
 if(!Array.isArray(plans))return null;
 const free=plans.find(p=>p.id==='free'),pro=plans.find(p=>p.id==='pro');
 if(!validPlan(free)||!validPlan(pro))return null;
 const rawCurrency=(catalog as OfferCatalog).currency;
 const currency=typeof rawCurrency==='string'&&rawCurrency.length===3?rawCurrency.toUpperCase():'USD';
 return {free,pro,currency};
}

export function OfferBlock({free,pro,currency}:{free:OfferPlan,pro:OfferPlan,currency:string}){
 const row=(p:OfferPlan,blurb:string)=>(
  <div className="offer-plan" key={p.id}>
   <div className="offer-plan-head"><strong>{p.name}</strong><span className="offer-price">{formatPrice(p.priceCents,currency)}{p.priceCents>0?<span className="offer-per"> / month</span>:null}</span></div>
   <p>{p.replyLimit.toLocaleString()} reply attempts (≈{Math.max(1,Math.round(p.replyLimit/10))} real conversations a month) · {p.voiceMinuteLimit} microphone minutes a month</p>
   <p className="offer-blurb">{blurb}</p>
  </div>
 );
 return (
  <>
   <div className="offer-plans">{row(free,'A good place to start.')}{row(pro,'For a busier business.')}</div>
   <p className="offer-note">Cancel Pro renewal in Manage billing.</p>
   <p className="offer-note">Usage counts reply attempts — every try counts toward your allowance, not only delivered replies. Microphone minutes count from the moment the mic opens — startup and silence included. Conversation estimates figure roughly 10 replies per conversation.</p>
   <p className="offer-note">Calls, texts, and your business number run through your own provider account (Telnyx or Twilio): your provider bills you directly for number rental, calls, and messages at its own rates — separate from your Mayor plan, and never on your Mayor bill. Twilio numbers connect for voice calls; automatic text-backs are sent through Telnyx.</p>
  </>
 );
}

/** Rendered offer HTML from a catalog, or null when the catalog can't be trusted. */
export function offerBlockHtml(catalog:unknown):string|null{
 const offer=catalogOffer(catalog);
 if(!offer)return null;
 return renderToStaticMarkup(<OfferBlock free={offer.free} pro={offer.pro} currency={offer.currency}/>);
}

/** Homepage hero price anchor text from a catalog (rot156), or null when
 * the catalog can't be trusted — mirrors heroPriceSsrText in the worker. */
export function heroPriceText(catalog:unknown):string|null{
 const offer=catalogOffer(catalog);
 if(!offer)return null;
 return `Start free \u00b7 Pro ${formatPrice(offer.pro.priceCents,offer.currency)}/mo`;
}
