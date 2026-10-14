// Offer-block loader (React migration S0): keeps the React renderer in its
// own lazily-loaded chunk. In production the worker almost always renders
// the block server-side (dataset.ssr='catalog'), so the React chunk is only
// fetched on the degraded path — the main app bundle carries none of it.

/** Fetch the live catalog and swap the price-free fallback for catalog-priced plans. Never throws. */
export async function loadOfferBlock():Promise<void>{
 const el=document.getElementById('offer-block');
 if(!el)return;
 if(el.dataset.ssr==='catalog')return; // worker already rendered from the live catalog (src/offer-block-ssr.ts)
 try{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   const res=await fetch('/api/billing/catalog',{headers:{accept:'application/json'},signal:controller.signal});
   if(!res.ok)return;
   const {offerBlockHtml,heroPriceText}=await import('./offer-block');
   const catalog=await res.json();
   const html=offerBlockHtml(catalog);
   if(html)el.innerHTML=html;
   const hero=document.getElementById('hero-price');
   if(hero&&!hero.textContent){const text=heroPriceText(catalog);if(text)hero.textContent=text;}
  }finally{clearTimeout(timer);}
 }catch{/* keep the price-free fallback */}
}
