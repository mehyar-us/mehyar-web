// Public offer block — plan terms rendered ONLY from the live billing catalog.
//
// Prices are never hardcoded here: every amount comes from /api/billing/catalog
// at render time. If the catalog is unreachable or malformed, offerBlockHtml
// returns null and the static price-free fallback in index.html stays in place
// (a stale amount is never shown).
export interface OfferPlan{id:string;name:string;priceCents:number;interval:string;replyLimit:number;voiceMinuteLimit:number}
export interface OfferCatalog{currency:string;plans:OfferPlan[]}

function escapeHtml(value:string):string{
 return value.replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string));
}
function formatPrice(cents:number,currency:string):string{
 return new Intl.NumberFormat(undefined,{style:'currency',currency,maximumFractionDigits:0}).format(cents/100);
}
function validPlan(p:unknown):p is OfferPlan{
 const v=p as Record<string,unknown>|null;
 return !!v&&typeof v.id==='string'&&typeof v.name==='string'&&typeof v.priceCents==='number'&&Number.isFinite(v.priceCents)&&(v.priceCents as number)>=0&&typeof v.replyLimit==='number'&&typeof v.voiceMinuteLimit==='number';
}
/** Rendered offer HTML from a catalog, or null when the catalog can't be trusted. */
export function offerBlockHtml(catalog:unknown):string|null{
 const plans=(catalog as OfferCatalog|undefined)?.plans;
 if(!Array.isArray(plans))return null;
 const free=plans.find(p=>p.id==='free'),pro=plans.find(p=>p.id==='pro');
 if(!validPlan(free)||!validPlan(pro))return null;
 const rawCurrency=(catalog as OfferCatalog).currency;
 const currency=typeof rawCurrency==='string'&&rawCurrency.length===3?rawCurrency.toUpperCase():'USD';
 const row=(p:OfferPlan,blurb:string)=>`<div class="offer-plan"><div class="offer-plan-head"><strong>${escapeHtml(p.name)}</strong><span class="offer-price">${escapeHtml(formatPrice(p.priceCents,currency))}${p.priceCents>0?'<span class="offer-per"> / month</span>':''}</span></div><p>${p.replyLimit.toLocaleString()} assistant replies · ${p.voiceMinuteLimit} microphone minutes a month</p><p class="offer-blurb">${blurb}</p></div>`;
 return `<div class="offer-plans">${row(free,'A good place to start.')}${row(pro,'For a busier business.')}</div><p class="offer-note">Purchases are final — no refunds. Cancel Pro renewal in Manage billing.</p>`;
}
/** Fetch the live catalog and swap the price-free fallback for catalog-priced plans. Never throws. */
export async function loadOfferBlock():Promise<void>{
 const el=document.getElementById('offer-block');
 if(!el)return;
 try{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   const res=await fetch('/api/billing/catalog',{headers:{accept:'application/json'},signal:controller.signal});
   if(!res.ok)return;
   const html=offerBlockHtml(await res.json());
   if(html)el.innerHTML=html;
  }finally{clearTimeout(timer);}
 }catch{/* keep the price-free fallback */}
}
