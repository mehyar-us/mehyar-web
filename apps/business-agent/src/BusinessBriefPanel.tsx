import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
const fields=[['businessName','Business name'],['category','Business category'],['services','Services and products'],['requestOwner','Owner of incoming requests'],['prices','Prices'],['currency','Currency'],['hours','Business hours'],['locations','Locations'],['serviceArea','Service area'],['contactRoutes','Contact methods'],['bookingSystem','Booking system'],['publicPolicies','Public policies'],['brandLanguage','Brand language'],['existingTools','Existing tools'],['serviceDuration','Service duration'],['staffResources','Staff and resources'],['cancellationRules','Cancellation and rescheduling rules'],['escalationDestination','Human escalation destination'],['tone','Agent tone'],['permittedAutonomy','Actions that need review']] as const;
type Brief={revision:number;fields:Record<string,string>;sources?:Record<string,Source>};
type Recommendation={id:string;name:string;proposed:true;executionEnabled:false;prerequisites:string[];example:string;expectedImprovement:string;plan:{name:string;monthlyCents:number;setupCents:number};addon:string|null};
type Source={id:string;field:string;value:string;sourceUrl:string;retrievedAt:string;confirmedAt:string;confidence:string};
type Result={brief:Brief;identityVerified:false;authorizesActions:false;unresolvedQuestions:{field:string;question:string}[];recommendations:Recommendation[];sources?:Source[]};
function validSources(sources:Source[]|undefined){return sources===undefined||Array.isArray(sources)&&sources.length<=100&&sources.every(s=>{try{const url=new URL(s.sourceUrl);return typeof s.id==='string'&&['businessName','category','services','prices','currency','hours','locations','serviceArea','contactRoutes'].includes(s.field)&&typeof s.value==='string'&&s.value.length<=2000&&['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&Number.isFinite(Date.parse(s.retrievedAt))&&Number.isFinite(Date.parse(s.confirmedAt))&&['high','medium'].includes(s.confidence);}catch{return false;}});}
const empty=()=>Object.fromEntries(fields.map(([key])=>[key,'']));
function validBrief(b:Brief){return b&&Number.isSafeInteger(b.revision)&&b.revision>=0&&b.fields&&fields.every(([key])=>typeof b.fields[key]==='string'&&b.fields[key].length<=2000)&&(b.sources===undefined||!!b.sources&&!Array.isArray(b.sources)&&validSources(Object.values(b.sources))&&Object.entries(b.sources).every(([key,source])=>source.field===key&&source.value===b.fields[key]));}
function valid(v:Result){return v&&validBrief(v.brief)&&v.identityVerified===false&&v.authorizesActions===false&&Array.isArray(v.unresolvedQuestions)&&v.unresolvedQuestions.length<=7&&v.unresolvedQuestions.every(q=>typeof q.field==='string'&&typeof q.question==='string')&&Array.isArray(v.recommendations)&&v.recommendations.length===3&&v.recommendations.every(r=>r&&typeof r.id==='string'&&typeof r.name==='string'&&r.proposed===true&&r.executionEnabled===false&&typeof r.example==='string'&&typeof r.expectedImprovement==='string'&&Array.isArray(r.prerequisites)&&r.prerequisites.every(p=>typeof p==='string')&&r.plan&&typeof r.plan.name==='string'&&[r.plan.monthlyCents,r.plan.setupCents].every(n=>Number.isSafeInteger(n)&&n>=0)&&(r.addon===null||typeof r.addon==='string'));}
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
export default function BusinessBriefPanel({tenantId,online,canEdit,onUnauthorized}:{tenantId:string;online:boolean;canEdit:boolean;onUnauthorized:(cause:unknown)=>void}){
  const [result,setResult]=useState<Result|null>(null),[draft,setDraft]=useState(empty),[reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const active=useRef<AbortController|null>(null),pending=useRef<{key:string;body:string;revision:number}|null>(null);
  const [sourceIds,setSourceIds]=useState<Record<string,string>>({});
  const load=useCallback(async()=>{
    active.current?.abort();const c=new AbortController();active.current=c;setResult(null);setError('');setBusy(true);
    try{const data=await api<Result>(`/api/tenants/${encodeURIComponent(tenantId)}/business-brief`,{signal:c.signal});if(!valid(data)||!validSources(data.sources))throw new Error('The business brief returned an unexpected response. Please reload.');if(!c.signal.aborted){setResult(data);setDraft(data.brief.fields);setSourceIds(Object.fromEntries(Object.entries(data.brief.sources??{}).map(([key,source])=>[key,source.id])));setReviewed(false);}}
    catch(cause){if(!c.signal.aborted){setError(cause instanceof Error?cause.message:'The brief could not be loaded.');if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);}}
    finally{if(!c.signal.aborted)setBusy(false);}
  },[tenantId,onUnauthorized]);
  useEffect(()=>{if(online&&!pending.current)void load();else{active.current?.abort();setBusy(false);}return()=>active.current?.abort();},[load,online]);
  async function save(){
    if(!online||busy||!canEdit||!reviewed||!result)return;
    const request=pending.current??{key:crypto.randomUUID(),revision:result.brief.revision,body:JSON.stringify({expectedRevision:result.brief.revision,reviewed:true,fields:Object.fromEntries(fields.map(([key])=>[key,draft[key].trim()])),sourceIds})};pending.current=request;
    const c=new AbortController();active.current=c;setBusy(true);setError('');setNotice('');
    try{const response=await api<{brief:Brief}>(`/api/tenants/${encodeURIComponent(tenantId)}/business-brief`,{method:'POST',headers:{'X-Idempotency-Key':request.key},body:request.body,signal:c.signal});
      if(!validBrief(response.brief)||response.brief.revision!==request.revision+1)throw new Error('The save response was incomplete. Retry the same update to confirm its outcome.');
      if(c.signal.aborted)return;pending.current=null;setNotice('Business brief saved. These details do not activate automations.');await load();
    }catch(cause){if(!c.signal.aborted){if(cause instanceof ApiError&&['brief_revision_conflict','brief_source_changed'].includes(cause.code)){pending.current=null;setReviewed(false);}setError(cause instanceof Error?cause.message:'The brief could not be saved. Retry the same update.');if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);}}
    finally{if(!c.signal.aborted)setBusy(false);}
  }
  function field(key:string,label:string){const source=result?.brief.sources?.[key];return <div className="field" key={key}><label htmlFor={`${tenantId}-brief-${key}`}>{label}</label><textarea id={`${tenantId}-brief-${key}`} rows={2} maxLength={2000} value={draft[key]??''} disabled={!canEdit||busy||!!pending.current} onChange={event=>{setDraft(current=>({...current,[key]:event.target.value}));setSourceIds(current=>{const next={...current};delete next[key];return next;});setReviewed(false);}}/>{source&&sourceIds[key]===source.id&&<a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">Saved source for {label.toLowerCase()}</a>}</div>;}
  return <section className="panel research-panel" aria-label="Business brief" style={{overflowWrap:'anywhere'}}>
    <div className="panel-heading"><h2>Business brief</h2><button className="button secondary" disabled={!online||busy||!!pending.current} onClick={()=>void load()}>Reload saved brief</button></div>
    <p>Review your business details and how requests should be handled. Saving does not verify website ownership or grant permission to act.</p>
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
    {!online?<p>Reconnect to view or update the business brief.</p>:!result?<p>{busy?'Loading business brief…':'Reload the brief to try again.'}</p>:<>
      {!!result.sources?.length&&<details><summary>Confirmed research suggestions ({result.sources.length})</summary><p>These facts were confirmed in business knowledge. Copying fills an empty draft field only; review and save the brief afterward.</p>{result.sources.map(source=><article className="memory-item" key={source.id}><div><strong>{fields.find(([key])=>key===source.field)?.[1]}</strong><p>{source.value}</p><a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">View confirmed source</a><p className="small muted">Retrieved {new Date(source.retrievedAt).toLocaleString()} · Confirmed {new Date(source.confirmedAt).toLocaleString()} · Extraction confidence: {source.confidence}</p>{canEdit&&<button className="button secondary" type="button" disabled={busy||!!pending.current||!!draft[source.field]?.trim()} onClick={()=>{
        setDraft(current=>current[source.field]?.trim()?current:{...current,[source.field]:source.value});setSourceIds(current=>({...current,[source.field]:source.id}));setReviewed(false);setNotice('Copied into your draft. Review and save the brief to keep it.');
        const target=document.getElementById(`${tenantId}-brief-${source.field}`),details=target?.closest('details');if(details)details.open=true;target?.focus();
      }}>Copy into empty field</button>}</div></article>)}</details>}
      <form className="stack" onSubmit={event=>{event.preventDefault();void save();}}>
        {fields.slice(0,4).map(([key,label])=>field(key,label))}
        <details><summary>Business details and operating preferences</summary><div className="stack">{fields.slice(4).map(([key,label])=>field(key,label))}</div></details>
        {canEdit?<><label><input type="checkbox" checked={reviewed} disabled={busy||!!pending.current} onChange={event=>setReviewed(event.target.checked)}/> I reviewed these business details.</label>
          {pending.current&&!busy&&<p role="status">The save outcome is unconfirmed. Retry preserves the same update.</p>}
          <button className="button primary" disabled={!online||busy||!reviewed} type="submit">{busy?'Saving brief…':pending.current?'Retry same brief update':'Save reviewed brief'}</button></>:<p>The workspace owner can edit and confirm this brief.</p>}
      </form>
      {result.unresolvedQuestions.length>0&&<div><h3>Still to confirm</h3><ul>{result.unresolvedQuestions.map(q=><li key={q.field}>{q.question}</li>)}</ul></div>}
      <h3>Three suggested starting points</h3><p>Proposed capabilities, not active automations. Prices are per plan, not per recommendation. Setup and readiness checks apply.</p>
      {result.recommendations.map(r=><article className="memory-item" key={r.id}><div><h4>{r.name}</h4><p>{r.expectedImprovement}</p><p>{r.example}</p><p>{r.plan.name}: {money(r.plan.monthlyCents)}/month plus {money(r.plan.setupCents)} setup.{r.addon&&` Add-on required: ${r.addon.replaceAll('-',' ')}.`}</p><details><summary>Requirements before use</summary><ul>{r.prerequisites.map(p=><li key={p}>{p.replaceAll('_',' ')}</li>)}</ul></details></div></article>)}
    </>}
  </section>;
}
