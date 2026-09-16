import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
type Source={streamId:string;messageId:string;receipt:string};
type Item={source:Source;excerpt:string;observedAt:string;historicalContext:boolean;extractionOmissions:string[]};
type Page={items:Item[];withheld:number;nextCursor?:string;extendedAnalysisEnabled:boolean};
type Offer={offerId:string;expiresAt:string;textCredits:number;sectionCount:number;authorizesExternalActions:false}&(
  {scope:'analyze_remaining_sections';remainingSections:number[];includesAggregation:false}|
  {scope:'combine_completed_sections';includesSectionAnalysis:false});
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const bounded=(v:unknown,max:number)=>typeof v==='string'&&v.length>0&&v.length<=max;
const integer=(v:unknown,min:number,max:number)=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max;
const key=(i:Item)=>JSON.stringify([i.source.streamId,i.source.messageId]);
function validPage(v:unknown):v is Page{
  const p=v as Page|null;
  return !!p&&typeof p.extendedAnalysisEnabled==='boolean'&&integer(p.withheld,0,10)
    &&(p.nextCursor===undefined||bounded(p.nextCursor,8192)&&/^[A-Za-z0-9_-]+$/.test(p.nextCursor))
    &&Array.isArray(p.items)&&p.items.length<=10&&p.items.every(i=>i&&i.source&&bounded(i.source.streamId,2048)&&bounded(i.source.messageId,2048)&&uuid(i.source.receipt)
      &&typeof i.excerpt==='string'&&Array.from(i.excerpt).length<=160&&typeof i.observedAt==='string'&&Number.isFinite(Date.parse(i.observedAt))
      &&typeof i.historicalContext==='boolean'&&Array.isArray(i.extractionOmissions)&&i.extractionOmissions.length<=12&&i.extractionOmissions.every(w=>bounded(w,64)))
    &&new Set(p.items.map(key)).size===p.items.length;
}
function validOffer(v:unknown):v is Offer{
  const o=v as Offer|null;
  return !!o&&uuid(o.offerId)&&typeof o.expiresAt==='string'&&Date.parse(o.expiresAt)>Date.now()
    &&integer(o.textCredits,1,32)&&integer(o.sectionCount,1,32)&&o.authorizesExternalActions===false
    &&(o.scope==='combine_completed_sections'?o.includesSectionAnalysis===false:
      o.scope==='analyze_remaining_sections'&&o.includesAggregation===false&&Array.isArray(o.remainingSections)
      &&o.remainingSections.length===o.textCredits&&new Set(o.remainingSections).size===o.remainingSections.length
      &&o.remainingSections.every(i=>integer(i,0,o.sectionCount-1)));
}
export default function MailboxReview({tenantId,grantId,onUnauthorized,onComplete}:{tenantId:string;grantId:string;onUnauthorized:(error:unknown)=>void;onComplete:()=>void}){
  const [items,setItems]=useState<Item[]>([]),[cursor,setCursor]=useState<string>(),[enabled,setEnabled]=useState(false),[loaded,setLoaded]=useState(false);
  const [selected,setSelected]=useState<Item>(),[offer,setOffer]=useState<Offer>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  const active=useRef<AbortController|null>(null),seen=useRef(new Set<string>());
  const base=`/api/tenants/${encodeURIComponent(tenantId)}`,directory=`${base}/connections/${encodeURIComponent(grantId)}/mailbox/review-messages`;
  function clear(){setItems([]);setCursor(undefined);setSelected(undefined);setOffer(undefined);setLoaded(false);setEnabled(false);seen.current.clear();}
  useEffect(()=>{clear();setBusy(false);setError('');setStatus('');return()=>{active.current?.abort();active.current=null;};},[tenantId,grantId]);
  async function work(fn:(signal:AbortSignal)=>Promise<void>){
    if(active.current)return;
    const controller=new AbortController();active.current=controller;setBusy(true);setError('');setStatus('');
    try{await fn(controller.signal);}catch(cause){if(!controller.signal.aborted){clear();setStatus('');setError(cause instanceof Error?cause.message:'Review could not be completed.');if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);}}
    finally{if(active.current===controller){active.current=null;setBusy(false);}}
  }
  async function post(path:string,body:unknown,signal:AbortSignal){return api<unknown>(`${base}/mailbox-analysis/${path}`,{method:'POST',body:JSON.stringify(body),signal});}
  async function quote(item:Item,kind:'sections'|'aggregation',signal:AbortSignal){
    let result;
    try{result=await post(`${kind}/review`,item.source,signal);}
    catch(cause){
      if(signal.aborted)return;
      if(kind==='sections'&&cause instanceof ApiError&&cause.code==='triage_sections_complete')return quote(item,'aggregation',signal);
      if(cause instanceof ApiError&&cause.code==='triage_already_complete'){setOffer(undefined);setStatus('The combined analysis is already available below.');onComplete();return;}
      throw cause;
    }
    if(signal.aborted)return;
    if(!validOffer(result)||result.scope!==(kind==='sections'?'analyze_remaining_sections':'combine_completed_sections'))throw new Error('The analysis cost could not be verified. Refresh messages.');
    setSelected(item);setOffer(result);
  }
  function load(more=false){void work(async signal=>{
    setOffer(undefined);setSelected(undefined);
    if(!more)clear();
    const result=await api<unknown>(directory+(more&&cursor?`?after=${encodeURIComponent(cursor)}`:''),{signal});
    if(signal.aborted)return;
    if(!validPage(result)||more&&result.nextCursor&&(result.nextCursor===cursor||seen.current.has(result.nextCursor))||more&&result.items.some(i=>items.some(old=>key(old)===key(i))))throw new Error('Messages could not be verified. Refresh to try again.');
    if(result.nextCursor)seen.current.add(result.nextCursor);
    setItems(old=>more?[...old,...result.items]:result.items);setCursor(result.nextCursor);setEnabled(result.extendedAnalysisEnabled);setLoaded(true);
    if(result.withheld)setStatus(`${result.withheld} messages were withheld because their source or access changed.`);
  });}
  function confirm(){if(!offer||!selected)return;const approved=offer,item=selected;void work(async signal=>{
    if(Date.parse(approved.expiresAt)<=Date.now())throw new Error('This cost review expired. Refresh messages and review the cost again.');
    setOffer(undefined);
    if(approved.scope==='analyze_remaining_sections'){
      for(let n=0;n<approved.remainingSections.length;n++){
        if(signal.aborted)return;
        setStatus(`Analyzing section ${n+1} of ${approved.remainingSections.length}…`);
        const index=approved.remainingSections[n];
        const result=await post('sections/confirm',{offerId:approved.offerId,sectionIndex:index},signal) as Record<string,unknown>|null;
        if(signal.aborted)return;
        if(!result||result.complete!==true||result.sectionIndex!==index||result.sectionCount!==approved.sectionCount||result.requiresReview!==true||result.authorizesActions!==false)throw new Error('Analysis completion could not be verified. Refresh to check remaining work.');
      }
      setStatus('Sections analyzed. Review the separate cost to combine their findings.');await quote(item,'aggregation',signal);
    }else{
      const result=await post('aggregation/confirm',{offerId:approved.offerId},signal) as Record<string,unknown>|null;
      if(signal.aborted)return;
      if(!result||result.complete!==true||result.availableInMailboxAnalyses!==true||result.requiresReview!==true||result.authorizesActions!==false)throw new Error('Analysis completion could not be verified. Refresh analyses.');
      setStatus('Combined analysis is ready for your review below.');setSelected(undefined);onComplete();
    }
  });}
  function stop(){active.current?.abort();active.current=null;setBusy(false);setOffer(undefined);setStatus('Stopped requesting further work. A request already submitted may finish and use its approved credits. Refresh messages to check remaining work.');}
  return <section aria-label="Extended message review"><h4>Long-message review</h4>
    <p>Review a message’s credit cost before analysis. Section analysis and the combined summary have separate approvals. This does not send email or schedule appointments.</p>
    <p>Keep this view open while analyzing. If you leave, return to review remaining work; requests already submitted may still finish.</p>
    <button className="button secondary" disabled={busy} onClick={()=>load()}>{loaded?'Refresh review messages':'View messages needing review'}</button>
    {error&&<p role="alert">{error}</p>}{status&&<p role="status">{status}</p>}
    {loaded&&!enabled&&<p>Extended analysis is not enabled. You can view available excerpts.</p>}
    {loaded&&!items.length&&<p>No current long messages on this page.</p>}
    {items.map(item=><article className="notice" key={key(item)}><blockquote>{item.excerpt}</blockquote><p>Source observed: {new Date(item.observedAt).toLocaleString()}</p>
      {item.historicalContext&&<p>Includes historical mailbox content.</p>}{item.extractionOmissions.length>0&&<p>Some content was excluded or could not be fully extracted. Analysis covers available text only.</p>}
      <button className="button secondary" disabled={busy||!enabled} onClick={()=>{setOffer(undefined);void work(signal=>quote(item,'sections',signal));}}>Review analysis cost</button>
    </article>)}
    {cursor&&items.length<100&&<button className="button secondary" disabled={busy} onClick={()=>load(true)}>Load more review messages</button>}
    {cursor&&items.length>=100&&<p>Showing 100 messages. Refresh to review the current directory.</p>}
    {offer&&selected&&<div className="notice"><h5>{offer.scope==='analyze_remaining_sections'?'Section analysis cost':'Combined summary cost'}</h5><blockquote>{selected.excerpt}</blockquote>
      <p>Uses up to {offer.textCredits} text {offer.textCredits===1?'credit':'credits'} from your allowance.</p><p>{offer.scope==='analyze_remaining_sections'?`Covers ${offer.remainingSections.length} remaining sections. The combined summary is not included.`:'Combines completed sections only. No new section analysis is included.'}</p>
      <p>Cost review expires: {new Date(offer.expiresAt).toLocaleTimeString()}. Completed sections are reused if you return later.</p>
      <button className="button" disabled={busy} onClick={confirm}>Approve {offer.textCredits} {offer.textCredits===1?'credit':'credits'}</button>
      <button className="button secondary" disabled={busy} onClick={()=>{setOffer(undefined);setSelected(undefined);}}>Cancel cost review</button>
    </div>}
    {busy&&<><p>Checking or analyzing the message…</p><button className="button secondary" onClick={stop}>Stop remaining work</button></>}
  </section>;
}
