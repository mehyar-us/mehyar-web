import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
import MailboxReview from './MailboxReview';
const categories={inquiry:'Inquiry',appointment:'Appointment',billing:'Billing',complaint:'Complaint',other:'Other',unknown:'Unclear'};
const priorities={routine:'Routine',urgent:'Potentially urgent',unknown:'Priority unclear'};
const warnings={attachment:'Attachments were excluded.',external_body:'Some content was unavailable.',unsupported_mime:'Some message formats were unsupported.',invalid_part:'Some message parts were malformed.',invalid_encoding:'Some content could not be decoded.',limit:'Message decoding reached a limit.',html_nontext:'Nontext or hidden HTML content was excluded.',html_visibility_unresolved:'HTML visibility could not be fully determined.',text_limit:'Extracted text reached its size limit.',html_limit:'HTML processing reached a limit.',controls_removed:'Control characters were removed.'};
type Item={id:string;category:keyof typeof categories;priority:keyof typeof priorities;summary:string;evidence:string[];observedAt:string;historicalContext:boolean;extractionOmissions:(keyof typeof warnings)[];contextTruncated:boolean;requiresReview:true;authorizesActions:false;aggregation?:{basis:'validated_section_summaries';sectionCount:number;extractedTextCoverageComplete:true}};
type Queue={pending:number;needsReview:number;longMessages:number;unavailableText:number;invalidResponses:number;dispatchEnabled:boolean};
type Directory={items:Item[];withheld:number;nextCursor?:string;queue?:Queue};
function validQueue(q:Queue|undefined){return q===undefined||!!q&&typeof q.dispatchEnabled==='boolean'
  &&[q.pending,q.needsReview,q.longMessages,q.unavailableText,q.invalidResponses].every(n=>Number.isSafeInteger(n)&&n>=0)
  &&q.longMessages+q.unavailableText+q.invalidResponses<=q.needsReview;}
const identifier=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function valid(value:unknown):value is Directory{
  const page=value as Directory|null;
  return !!page&&validQueue(page.queue)&&Number.isSafeInteger(page.withheld)&&page.withheld>=0&&page.withheld<=10
    &&(page.nextCursor===undefined||identifier(page.nextCursor))&&Array.isArray(page.items)&&page.items.length<=10
    &&new Set(page.items.map(i=>i?.id)).size===page.items.length&&page.items.every(i=>i&&identifier(i.id)&&Object.hasOwn(categories,i.category)&&Object.hasOwn(priorities,i.priority)
      &&(i.aggregation===undefined||!!i.aggregation&&i.aggregation.basis==='validated_section_summaries'&&i.aggregation.extractedTextCoverageComplete===true&&Number.isInteger(i.aggregation.sectionCount)&&i.aggregation.sectionCount>=1&&i.aggregation.sectionCount<=32)
      &&typeof i.summary==='string'&&i.summary.trim().length>0&&i.summary.length<=1500
      &&Array.isArray(i.evidence)&&i.evidence.length>0&&i.evidence.length<=5&&i.evidence.every(e=>typeof e==='string'&&e.trim().length>0&&e.length<=1000)
      &&typeof i.observedAt==='string'&&Number.isFinite(Date.parse(i.observedAt))&&typeof i.historicalContext==='boolean'&&typeof i.contextTruncated==='boolean'
      &&i.requiresReview===true&&i.authorizesActions===false&&Array.isArray(i.extractionOmissions)&&i.extractionOmissions.length<=12&&i.extractionOmissions.every(w=>Object.hasOwn(warnings,w)));
}
export default function MailboxAnalyses({tenantId,grantId,onUnauthorized}:{tenantId:string;grantId:string;onUnauthorized:(error:unknown)=>void}){
  const [queue,setQueue]=useState<Queue>();
  const [items,setItems]=useState<Item[]>([]),[cursor,setCursor]=useState<string>(),[withheld,setWithheld]=useState(0),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const request=useRef<AbortController|null>(null),seen=useRef(new Set<string>());
  useEffect(()=>{setQueue(undefined);setItems([]);setCursor(undefined);setWithheld(0);setLoaded(false);setError('');setBusy(false);seen.current.clear();return()=>request.current?.abort();},[tenantId,grantId]);
  async function load(more=false){
    if(busy)return;
    request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(true);setError('');
    setQueue(undefined);
    if(!more){setItems([]);setCursor(undefined);setWithheld(0);setLoaded(false);seen.current.clear();}
    try{
      const result=await api<unknown>(`/api/tenants/${encodeURIComponent(tenantId)}/connections/${encodeURIComponent(grantId)}/mailbox/analyses${more&&cursor?`?after=${encodeURIComponent(cursor)}`:''}`,{signal:controller.signal});
      if(!valid(result)||more&&result.nextCursor&&(result.nextCursor===cursor||seen.current.has(result.nextCursor))||more&&result.items.some(i=>items.some(old=>old.id===i.id)))throw new Error('Mailbox analyses could not be verified. Refresh to try again.');
      if(controller.signal.aborted)return;
      if(result.nextCursor)seen.current.add(result.nextCursor);
      setQueue(result.queue);setItems(old=>more?[...old,...result.items]:result.items);setWithheld(old=>more?old+result.withheld:result.withheld);setCursor(result.nextCursor);setLoaded(true);
    }catch(cause){if(!controller.signal.aborted){setItems([]);setCursor(undefined);setWithheld(0);setLoaded(false);setError(cause instanceof Error?cause.message:'Mailbox analyses are unavailable.');if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);}}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  return <section className="mailbox-analyses" aria-label="Mailbox analyses">
    <h3>Mailbox analyses</h3><p>AI suggestions for your review. Viewing an analysis does not send a reply or approve an action.</p>
    <button className="button secondary" disabled={busy} onClick={()=>void load()}>{loaded?'Refresh analyses':'View analyses'}</button>
    {busy&&<p role="status">Loading analyses…</p>}{error&&<p role="alert">{error}</p>}
    {queue&&<div><p>Analyses waiting: {queue.pending}; needing review: {queue.needsReview}.</p>
      <p>{queue.dispatchEnabled?'Automatic analysis is configured. Work can still wait for account or service readiness.':'Automatic analysis is not enabled.'}</p>
      {queue.longMessages>0&&<p>Long messages needing manual review: {queue.longMessages}.</p>}
      {queue.unavailableText>0&&<p>Messages without usable text: {queue.unavailableText}.</p>}
      {queue.invalidResponses>0&&<p>Unverified model responses: {queue.invalidResponses}.</p>}
    </div>}
    <MailboxReview tenantId={tenantId} grantId={grantId} onUnauthorized={onUnauthorized} onComplete={()=>void load()}/>
    {loaded&&!items.length&&<p>No current analyses on this page. This does not mean your mailbox has no inquiries.</p>}
    {withheld>0&&<p>{withheld} saved analyses withheld because their source, access or business context is no longer current.</p>}
    {items.map(item=><article key={item.id} className="notice">
      <h4>{categories[item.category]} · {priorities[item.priority]}</h4><p>{item.summary}</p>
      {item.aggregation&&<p>Combined from {item.aggregation.sectionCount} section analyses. All extracted text was covered; omitted content was not analyzed.</p>}
      <p>Source observed: {new Date(item.observedAt).toLocaleString()}</p>
      {item.historicalContext&&<p>This analysis includes historical mailbox content.</p>}
      {item.contextTruncated&&<p>Only part of the business brief was included.</p>}
      {item.extractionOmissions.map((warning,index)=><p key={`${warning}:${index}`}>{warnings[warning]}</p>)}
      <details><summary>Read email evidence</summary>{item.evidence.map((excerpt,index)=><blockquote key={index}>{excerpt}</blockquote>)}</details>
      <p>Requires review. Classification and urgency may be incorrect.</p>
    </article>)}
    {cursor&&(items.length<100?<button className="button secondary" disabled={busy} onClick={()=>void load(true)}>Load more analyses</button>:<p>Showing 100 analyses. Refresh to review the current directory.</p>)}
  </section>;
}
