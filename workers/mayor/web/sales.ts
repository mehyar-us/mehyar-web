/**
 * sales.ts — DOM glue for the /sales page.
 * Renders the money-loop examples from src/verticals.ts and the pricing
 * section from GET /api/billing/catalog. Sets no cookies, loads no trackers.
 */
import {buildMoneyLoopExamples,parseCatalog,renderMoneyLoopHtml,renderPricingHtml,renderPricingUnavailableHtml} from './sales-pricing';

const CATALOG_URL='/api/billing/catalog';

function renderMoneyLoop():void{
 const grid=document.getElementById('money-loop-grid');
 if(!grid)return;
 try{
  grid.innerHTML=renderMoneyLoopHtml(buildMoneyLoopExamples());
 }catch{
  grid.innerHTML='<p class="section-fallback" role="status">Examples could not be loaded. The money loop is simple: a missed call gets an instant text-back, and the recovered booking lands on your book.</p>';
 }
 grid.removeAttribute('aria-busy');
}

async function renderPricing():Promise<void>{
 const body=document.getElementById('pricing-body');
 if(!body)return;
 try{
  const response=await fetch(CATALOG_URL,{headers:{accept:'application/json'}});
  if(!response.ok)throw new Error(`catalog_status_${response.status}`);
  const catalog=parseCatalog(await response.json());
  body.innerHTML=catalog?renderPricingHtml(catalog):renderPricingUnavailableHtml();
 }catch{
  // Never a broken page and never a guessed price.
  body.innerHTML=renderPricingUnavailableHtml();
 }
 body.removeAttribute('aria-busy');
}

function init():void{
 renderMoneyLoop();
 void renderPricing();
}

if(document.readyState==='loading'){
 document.addEventListener('DOMContentLoaded',init,{once:true});
}else{
 init();
}
