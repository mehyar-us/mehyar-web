import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
import ConfirmResearchClaim from './ConfirmResearchClaim';
type Job={id:string;website:string;status:string;pageLimit:number;evidencePages:number;usedPages:number;reservedPages:number};
type Claim={field:string;value:string;sourceUrl:string;retrievedAt:string;confidence:string;selector:string};
type EvidencePage={url:string;retrievedAt:string;evidence:Claim[];warnings:string[]};
type Result={jobs?:Job[];job?:Job;pages?:EvidencePage[];nextOffset:number|null};
const statuses:Record<string,string>={reserved:'Queued',submitting:'Starting',uncertain:'Needs attention',running:'Researching',cancel_requested:'Stopping',completed:'Complete',cancelled:'Cancelled',failed:'Failed'};
function safeUrl(value:unknown):value is string {try{if(typeof value!=='string')return false;const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}}
function validJob(job:Job){return job&&typeof job.id==='string'&&safeUrl(job.website)&&Object.hasOwn(statuses,job.status)&&[job.pageLimit,job.evidencePages,job.usedPages,job.reservedPages].every(n=>Number.isSafeInteger(n)&&n>=0);}
function valid(result:Result,detail:boolean){
  if(!result||!(result.nextOffset===null||Number.isSafeInteger(result.nextOffset)&&result.nextOffset>=0))return false;
  if(!detail)return Array.isArray(result.jobs)&&result.jobs.length<=20&&result.jobs.every(validJob);
  return !!result.job&&validJob(result.job)&&Array.isArray(result.pages)&&result.pages.length<=20&&result.pages.every(page=>safeUrl(page.url)&&typeof page.retrievedAt==='string'&&Number.isFinite(Date.parse(page.retrievedAt))&&Array.isArray(page.warnings)&&page.warnings.every(w=>typeof w==='string')&&Array.isArray(page.evidence)&&page.evidence.length<=100&&page.evidence.every(claim=>claim&&[claim.field,claim.value,claim.selector,claim.confidence,claim.retrievedAt].every(v=>typeof v==='string')&&safeUrl(claim.sourceUrl)));
}
export default function ResearchPanel({tenantId,online,canConfirm,onSaved,onUnauthorized}:{tenantId:string;online:boolean;canConfirm:boolean;onSaved:()=>Promise<void>;onUnauthorized:(cause:unknown)=>void}){
  const [jobId,setJobId]=useState<string|null>(null),[offset,setOffset]=useState(0),[result,setResult]=useState<Result|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const active=useRef<AbortController|null>(null);
  const load=useCallback(async()=>{
    active.current?.abort();setResult(null);setError('');setLoading(false);if(!online)return;
    const controller=new AbortController();active.current=controller;setLoading(true);
    try{
      const data=await api<Result>(`/api/tenants/${encodeURIComponent(tenantId)}/research${jobId?'/'+encodeURIComponent(jobId):''}?offset=${offset}`,{signal:controller.signal});
      if(!valid(data,!!jobId)||data.nextOffset!==null&&data.nextOffset<=offset||jobId&&data.job?.id!==jobId)throw new Error('Research returned an unexpected response. Please refresh.');
      if(!controller.signal.aborted)setResult(data);
    }catch(cause){if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'Research could not be loaded.');if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);}}
    finally{if(!controller.signal.aborted)setLoading(false);}
  },[tenantId,jobId,offset,online,onUnauthorized]);
  useEffect(()=>{void load();return()=>active.current?.abort();},[load]);
  function select(id:string|null){active.current?.abort();setResult(null);setJobId(id);setOffset(0);}
  return <section className="panel research-panel" aria-label="Website research" style={{overflowWrap:'anywhere'}}>
    <div className="panel-heading"><h2>Website research</h2><button className="button secondary" disabled={!online||loading} onClick={()=>void load()}>Refresh research</button></div>
    <p className="small muted">Website claims need your review. They are not saved business knowledge or permission to act.</p>
    {jobId&&<button className="button secondary" onClick={()=>select(null)}>Back to research</button>}
    {!online?<p>Reconnect to view research.</p>:loading?<p role="status">Loading research…</p>:error?<p role="alert">{error}</p>:result?<>
      {result.jobs?.length===0&&<p>No website research is available yet. You can add business details manually above.</p>}
      {result.jobs?.map(job=><article className="memory-item" key={job.id}><div><strong>{job.website}</strong><p>{statuses[job.status]} · {job.evidencePages} source pages</p><button className="button secondary" onClick={()=>select(job.id)}>View source evidence</button></div></article>)}
      {result.job&&<><p><strong>{statuses[result.job.status]}</strong> · {result.job.evidencePages} source pages · {result.job.usedPages} pages used · {result.job.reservedPages} reserved</p>{result.pages?.length===0&&<p>No source evidence is available for this research yet.</p>}</>}
      {result.pages?.map(page=><article className="memory-item" key={page.url}><div>
        <a href={page.url} target="_blank" rel="noopener noreferrer">{page.url}</a><p className="small muted">Retrieved {new Date(page.retrievedAt).toLocaleString()}</p>
        {page.warnings.length>0&&<p>Extraction notes: {page.warnings.map(w=>w.replaceAll('_',' ')).join('; ')}</p>}
        {page.evidence.length===0?<p>No business claims were extracted from this page.</p>:page.evidence.map((claim,index)=><div key={index} className="memory-item"><div><strong>{claim.field.replaceAll('_',' ')}</strong><p>{claim.value}</p><p className="small muted">Unverified website claim · Extraction confidence: {claim.confidence}</p><a href={claim.sourceUrl} target="_blank" rel="noopener noreferrer">Claim source</a><details><summary>Source details</summary><p>{claim.selector}</p><p>{claim.retrievedAt}</p></details>{canConfirm&&jobId&&<ConfirmResearchClaim tenantId={tenantId} jobId={jobId} url={page.url} index={index} field={claim.field} value={claim.value} online={online} onSaved={onSaved} onUnauthorized={onUnauthorized}/>}</div></div>)}
      </div></article>)}
      <div className="panel-heading">{offset>0&&<button className="button secondary" onClick={()=>{setResult(null);setOffset(Math.max(0,offset-20));}}>Previous results</button>}{result.nextOffset!==null&&<button className="button secondary" onClick={()=>{setResult(null);setOffset(result.nextOffset!);}}>Next results</button>}</div>
    </>:null}
  </section>;
}
