/** Explicit-submit to the actual local public API; receipt stays in an ignored file. */
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
if(process.argv.slice(2).some(value=>value!=='--decline'))throw new Error('Unsupported sandbox intake option.');const path=new URL(process.argv.includes('--decline')?'.dev.vars.audit-decline-receipt.json':'.dev.vars.audit-receipt.json',import.meta.url);
const intake={contactName:'Mayor Sandbox',email:'mayor-audit-sandbox@example.test',businessName:'Synthetic Mayor audit verification',website:'https://mehyar.us',goals:'Review public customer journeys and provide evidence-based priorities for a synthetic local-business test.',notes:'Synthetic sandbox intake; no real customer information. Payment verification only; do not infer that a report is already delivered.',links:[],acceptedTerms:true};
let saved;try{saved=JSON.parse(await readFile(path,'utf8'));}catch{}
const requestId=saved?.requestId??randomUUID();
const offer=await fetch('http://127.0.0.1:5195/api/business-audit/offer').then(response=>response.json());
if(offer.mode!=='test'||offer.offer?.priceCents!==33000||!offer.available)throw new Error('Actual Mayor sandbox audit unavailable.');
await writeFile(path,JSON.stringify({requestId,intake},null,2));
const response=await fetch('http://127.0.0.1:5195/api/business-audit/checkout',{method:'POST',headers:{origin:'http://127.0.0.1:5195','content-type':'application/json','idempotency-key':requestId},body:JSON.stringify(intake)}),result=await response.json();
if(!response.ok)throw new Error(`Actual audit API HTTP${response.status}: ${result.error??'unavailable'}`);
const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||url.username||url.password||url.port||!/^[a-f0-9]{64}$/.test(result.statusToken))throw new Error('Audit checkout/receipt validation failed.');
await writeFile(path,JSON.stringify({requestId,intake,...result},null,2));
console.log(JSON.stringify({mode:'test',priceCents:33000,orderId:result.orderId,checkoutUrl:result.url,replay:result.replay,receiptStoredInIgnoredFile:true},null,2));
