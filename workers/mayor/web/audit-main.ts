import {createIcons,ArrowUpRight,ArrowRight,NotebookTabs,MonitorSmartphone,CalendarCheck,UsersRound,MapPin,ListTodo,Route,Check,LockKeyhole,RefreshCw,FileText} from 'lucide';
import {mountAuditReport} from './audit-report';

export type AuditIntake={contactName:string;email:string;businessName:string;website:string;goals:string;notes?:string;links?:string[];acceptedTerms:true};
export type AuditOfferResponse={offer:{name:string;priceCents:number;currency:string;payment:string;scope?:string[]};available:boolean;mode:'test'|'live'|null;message:string|null};
export type AuditReceipt={orderId:string;paymentStatus:'pending'|'paid'|'failed'|'expired'|'refunded';fulfillmentStatus:'awaiting_payment'|'queued'|'in_review'|'report_ready'|'needs_review';priceCents:number;currency:string;paidAt:string|null;reportAvailable?:boolean;mode:'test'|'live'};
const statusTokenKey='mayor:business-audit:receipt';
const icons={ArrowUpRight,ArrowRight,NotebookTabs,MonitorSmartphone,CalendarCheck,UsersRound,MapPin,ListTodo,Route,Check,LockKeyhole,RefreshCw,FileText};

export function publicAuditUrl(raw:string){
 const trimmed=raw.trim();
 if(!trimmed||trimmed.length>2048)throw new Error('Enter a valid public website or document link.');
 let parsed:URL;
 try{parsed=new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed)?trimmed:`https://${trimmed}`);}catch{throw new Error('Enter a valid public website or document link.');}
 const host=parsed.hostname.toLowerCase();
 if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.port||!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)||/(?:^|\.)(localhost|local|internal|test|example|invalid|onion)$/.test(host))throw new Error('Use a public website domain without account credentials or a custom port.');
 parsed.protocol='https:';parsed.hash='';return parsed.href;
}
export function normalizeAuditIntake(fields:Record<string,string|boolean>):AuditIntake{
 const text=(name:string,max:number,label:string)=>{const value=typeof fields[name]==='string'?fields[name].trim():'';if(!value||value.length>max)throw new Error(`${label} is required and must be ${max} characters or fewer.`);return value;};
 const contactName=text('contactName',120,'Your name'),businessName=text('businessName',160,'Your business name'),email=text('email',254,'Your email').toLowerCase(),goals=text('goals',2000,'Your goals');
 if(contactName.length<2||businessName.length<2)throw new Error('Use at least two characters for your name and business name.');
 if(goals.length<10)throw new Error('Describe your goals in at least ten characters.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Enter a valid email address for your request.');
 if(fields.acceptedTerms!==true)throw new Error('Review and accept the audit scope and terms before continuing.');
 const website=publicAuditUrl(text('website',2048,'Your website'));
 if(new URL(website).search)throw new Error('Use your main website address without query parameters.');
 const notes=typeof fields.notes==='string'?fields.notes.trim():'';if(notes.length>3000)throw new Error('Keep your additional context to 3,000 characters or fewer.');
 const rawLinks=typeof fields.links==='string'?fields.links.split(/\r?\n/).map(value=>value.trim()).filter(Boolean):[];
 if(rawLinks.length>5)throw new Error('Share up to five supporting links, one per line.');
 const links=[...new Set(rawLinks.map(publicAuditUrl))];
 return {contactName,email,businessName,website,goals,...(notes?{notes}:{}),...(links.length?{links}:{}),acceptedTerms:true};
}
export function checkoutAvailability(response:AuditOfferResponse){
 const matches=response.offer?.priceCents===33000&&response.offer.currency==='USD'&&response.offer.payment==='one_time';
 const available=matches&&response.available&&(response.mode==='test'||response.mode==='live');
 return {available,test:response.mode==='test',label:available?(response.mode==='test'?'Continue to test checkout':'Continue to checkout · $330'):'Checkout unavailable',
  message:!matches?'The audit price could not be verified. Please try again.':response.message??(available?(response.mode==='test'?'Test checkout is available. This does not collect a live payment.':'Secure checkout is available. Review the scope and price before paying.'):'Checkout is being prepared. Review the full scope while setup is completed.')};
}
export function receiptPresentation(receipt:AuditReceipt){
 const test=receipt.mode==='test',prefix=test?'Test payment':'Payment',needsAttention=receipt.paymentStatus==='paid'&&receipt.fulfillmentStatus==='needs_review';
 const payment={pending:`${prefix} pending`,paid:`${prefix} confirmed`,failed:`${prefix} could not be completed`,expired:'Checkout expired',refunded:`${prefix} refunded`}[receipt.paymentStatus];
 const fulfillment={awaiting_payment:'Awaiting payment',queued:'Audit request received',in_review:'Generating and reviewing your audit',report_ready:'Report ready',needs_review:'Generation needs attention'}[receipt.fulfillmentStatus];
 const summary=needsAttention?`${test?'Your test payment':'Your payment'} is confirmed. A reviewed report is unavailable. Your request needs attention.${test?' This does not confirm a live purchase.':''}`:receipt.paymentStatus==='paid'?(test?'This is a completed test checkout. It does not confirm a live purchase.':receipt.fulfillmentStatus==='report_ready'?'Your payment is confirmed and the report is marked ready.':receipt.fulfillmentStatus==='in_review'?'Your payment is confirmed and your audit is recorded as in review.':'Your payment is confirmed. Your audit request is recorded; report availability will appear here.'):
  receipt.paymentStatus==='pending'?'Payment has not been confirmed yet. Refresh this page to check the saved status.':receipt.paymentStatus==='failed'?'The saved checkout status shows the payment did not complete.':receipt.paymentStatus==='refunded'?'Your payment is recorded as refunded.':'This checkout has expired. Return to the form to start a new request.';
 return {payment,fulfillment,summary,test,supportUrl:needsAttention?'https://mehyar.us/contact':null};
}
export function safeCheckoutUrl(raw:unknown){
 if(typeof raw!=='string')throw new Error('Checkout could not be opened. Please try again.');
 const url=new URL(raw);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||url.username||url.password)throw new Error('The secure checkout address could not be verified.');return url.href;
}
export function safeReportUrl(raw:unknown){
 if(typeof raw!=='string'||!raw)return null;
 try{const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function validAuditToken(raw:unknown):raw is string{return typeof raw==='string'&&/^[A-Za-z0-9._~-]{32,512}$/.test(raw);}

function mountAuditPage(){
 const element=<T extends HTMLElement>(id:string)=>{const value=document.getElementById(id);if(!value)throw new Error(`Missing audit control: ${id}`);return value as T;};
 const form=element<HTMLFormElement>('audit-intake-form'),checkout=element<HTMLButtonElement>('audit-checkout-button'),availability=element('audit-availability'),testNotice=element('audit-test-notice'),formStatus=element('audit-form-status');
 const receiptPanel=element('audit-receipt'),receiptHeading=element('receipt-heading'),receiptSummary=element('receipt-summary'),receiptDetails=element('receipt-details'),receiptRefresh=element<HTMLButtonElement>('receipt-refresh'),reportLink=element<HTMLAnchorElement>('audit-report-link');
 const supportLink=document.createElement('a');supportLink.className='button button-outline';supportLink.textContent='Contact support';supportLink.target='_blank';supportLink.rel='noopener noreferrer';supportLink.referrerPolicy='no-referrer';supportLink.setAttribute('aria-label','Contact support (opens in a new tab)');supportLink.hidden=true;reportLink.insertAdjacentElement('afterend',supportLink);
 let offer:AuditOfferResponse|null=null,statusToken:string|null=null,submitting=false,previousSubmission:{payload:string;key:string}|null=null;
 const decorate=()=>createIcons({icons});
 const setButton=(label:string)=>{checkout.textContent=label;};
 const showFormError=(message:string)=>{formStatus.textContent=message;formStatus.hidden=false;formStatus.scrollIntoView({block:'nearest',behavior:'smooth'});};
 async function api(path:string,init:RequestInit={}){
  const response=await fetch(path,{...init,credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000)});
  let data:any;try{data=await response.json();}catch{throw new Error('The request could not be verified. Please try again.');}
  if(!response.ok)throw new Error(typeof data.message==='string'?data.message:'The request could not be completed. Please try again.');return data;
 }
 async function loadOffer(){
  try{offer=await api('/api/business-audit/offer') as AuditOfferResponse;const state=checkoutAvailability(offer);availability.textContent=state.message;testNotice.hidden=!state.test;checkout.disabled=!state.available;setButton(state.label);}
  catch{availability.textContent='Checkout availability could not be verified. Please refresh to try again.';setButton('Checkout unavailable');checkout.disabled=true;}
 }
 function detail(label:string,value:string){const group=document.createElement('div'),term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=value;group.append(term,description);return group;}
 async function loadReceipt(){
  if(!statusToken)return;receiptPanel.hidden=false;receiptRefresh.disabled=true;reportLink.hidden=true;supportLink.hidden=true;
  receiptHeading.textContent='Checking your request…';receiptSummary.textContent='Verifying the saved payment and report status.';
  try{
   const receipt=await api('/api/business-audit/status',{headers:{authorization:`Bearer ${statusToken}`}}) as AuditReceipt;
   if(!['pending','paid','failed','expired','refunded'].includes(receipt.paymentStatus)||!['awaiting_payment','queued','in_review','report_ready','needs_review'].includes(receipt.fulfillmentStatus)||!['test','live'].includes(receipt.mode)||receipt.priceCents!==33000||receipt.currency!=='USD')throw new Error('The saved receipt details could not be verified.');
   const presentation=receiptPresentation(receipt);receiptHeading.textContent=presentation.payment;receiptSummary.textContent=presentation.summary;
   receiptDetails.replaceChildren(detail('Audit request',receipt.orderId),detail('Purchase',`${presentation.test?'Test · ':''}$330 USD · one-time`),detail('Report status',presentation.fulfillment));
   if(presentation.supportUrl){supportLink.href=presentation.supportUrl;supportLink.hidden=false;}
   if(receipt.paymentStatus==='paid'&&receipt.fulfillmentStatus==='report_ready'&&receipt.reportAvailable){reportLink.href=`/business-audit/report#receipt=${encodeURIComponent(statusToken!)}`;reportLink.hidden=false;}
  }catch(error){receiptHeading.textContent='We couldn’t verify this request';receiptSummary.textContent=error instanceof Error?error.message:'Please retry the saved receipt link.';receiptDetails.replaceChildren();}
  finally{receiptRefresh.disabled=false;decorate();}
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(submitting)return;
  if(!offer||!checkoutAvailability(offer).available){showFormError('Checkout is not available yet. No payment request has been created.');return;}
  if(!form.reportValidity())return;
  formStatus.hidden=true;
  let intake:AuditIntake;
  try{const data=new FormData(form);intake=normalizeAuditIntake(Object.fromEntries([...data.entries()].map(([key,value])=>[key,key==='acceptedTerms'?value==='on':String(value)])));}
  catch(error){showFormError(error instanceof Error?error.message:'Review your business details.');return;}
  const payload=JSON.stringify(intake);if(previousSubmission?.payload!==payload)previousSubmission={payload,key:crypto.randomUUID()};
  submitting=true;checkout.disabled=true;setButton(offer.mode==='test'?'Preparing test checkout…':'Preparing secure checkout…');
  try{
   const result=await api('/api/business-audit/checkout',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':previousSubmission!.key},body:payload});
   const checkoutUrl=safeCheckoutUrl(result.url);if(!validAuditToken(result.statusToken))throw new Error('The private receipt could not be verified. Please try again.');
   try{sessionStorage.setItem(statusTokenKey,result.statusToken);}catch{/* The secure return URL also carries the receipt token. */}
   window.location.assign(checkoutUrl);
  }catch(error){showFormError(error instanceof Error?error.message:'Checkout could not be opened. Please try again.');submitting=false;checkout.disabled=false;setButton(checkoutAvailability(offer).label);}
 });
 receiptRefresh.addEventListener('click',()=>void loadReceipt());
 const currentUrl=new URL(window.location.href),returnedToken=currentUrl.searchParams.get('receipt');
 if(returnedToken){
  if(validAuditToken(returnedToken)){statusToken=returnedToken;try{sessionStorage.setItem(statusTokenKey,statusToken);}catch{}}
  currentUrl.searchParams.delete('receipt');currentUrl.searchParams.delete('payment');window.history.replaceState({},'',currentUrl.pathname+currentUrl.search+currentUrl.hash);
 }else{try{const saved=sessionStorage.getItem(statusTokenKey);if(validAuditToken(saved))statusToken=saved;}catch{}}
 decorate();void loadOffer();if(statusToken)void loadReceipt();
}
if(typeof document!=='undefined'&&document.getElementById('audit-intake-form')){
 if(window.location.pathname.replace(/\/$/,'')==='/business-audit/report')void mountAuditReport(statusTokenKey,validAuditToken);
 else mountAuditPage();
}
