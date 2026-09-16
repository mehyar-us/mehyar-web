import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
import {jobStates,validMailboxJob,validMailboxJobs,type MailboxJob} from './mailbox-job-contract';
import {validOffer,type Offer} from './MailboxReview';
export default function MailboxJobs({tenantId,onUnauthorized}:{tenantId:string;onUnauthorized:(error:unknown)=>void}){
  const [jobs,setJobs]=useState<MailboxJob[]>([]),[cursor,setCursor]=useState<string>(),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  const [review,setReview]=useState<{job:MailboxJob;offer:Offer}>();
  const [view,setView]=useState<'all'|'active'>('all');
  const active=useRef<AbortController|null>(null),seen=useRef(new Set<string>());
  const base=`/api/tenants/${encodeURIComponent(tenantId)}/mailbox-analysis`;
  function clear(){setJobs([]);setCursor(undefined);setLoaded(false);setReview(undefined);seen.current.clear();}
  useEffect(()=>{clear();setError('');setStatus('');setBusy(false);return()=>{active.current?.abort();active.current=null;};},[tenantId]);
  async function work(fn:(signal:AbortSignal)=>Promise<void>){
    if(active.current)return;const controller=new AbortController();active.current=controller;setBusy(true);setError('');setStatus('');
    try{await fn(controller.signal);}catch(cause){if(!controller.signal.aborted){clear();setStatus('');setError(cause instanceof Error?cause.message:'Background analyses are unavailable.');if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);}}
    finally{if(active.current===controller){active.current=null;setBusy(false);}}
  }
  const post=(path:string,body:unknown,signal:AbortSignal)=>api<unknown>(`${base}/${path}`,{method:'POST',body:JSON.stringify(body),signal});
  function load(more=false,mode=view){void work(async signal=>{
    setReview(undefined);if(!more)clear();
    setView(mode);const query=new URLSearchParams({view:mode});if(more&&cursor)query.set('after',cursor);
    const result=await api<unknown>(`${base}/section-jobs?${query}`,{signal});
    if(signal.aborted)return;
    if(!validMailboxJobs(result)||mode==='active'&&result.jobs.some(j=>!['queued','running'].includes(j.status))||more&&result.nextCursor&&(result.nextCursor===cursor||seen.current.has(result.nextCursor))||more&&result.jobs.some(j=>jobs.some(old=>old.id===j.id)))throw new Error('Background analyses could not be verified. Refresh to try again.');
    if(result.nextCursor)seen.current.add(result.nextCursor);
    setJobs(result.jobs);setCursor(result.nextCursor);setLoaded(true);
  });}
  function cancel(job:MailboxJob){void work(async signal=>{
    setReview(undefined);let result;
    try{result=await post(`section-jobs/${encodeURIComponent(job.id)}/cancel`,{},signal);}
    catch(cause){if(cause instanceof ApiError&&cause.status===401)throw cause;throw new Error('Cancellation could not be confirmed. Refresh background analyses to check its status.');}
    if(signal.aborted)return;
    if(!validMailboxJob(result)||result.id!==job.id||['queued','running'].includes(result.status))throw new Error('Cancellation status could not be verified. Refresh background analyses.');
    setJobs(old=>view==='active'?old.filter(j=>j.id!==job.id):old.map(j=>j.id===job.id?result:j));setStatus(result.status==='cancelled'?'The job is stopped. Completed sections remain available.':'The job had already stopped or completed. Refresh all analyses to see its latest status.');
  });}
  function quote(job:MailboxJob){setReview(undefined);void work(async signal=>{
    let result;
    try{result=await post('aggregation/review',job.source,signal);}
    catch(cause){if(signal.aborted)return;if(cause instanceof ApiError&&cause.code==='triage_already_complete'){setStatus('The combined summary is already available. Open the mailbox and refresh analyses.');return;}throw cause;}
    if(signal.aborted)return;
    if(!validOffer(result)||result.scope!=='combine_completed_sections')throw new Error('The combined summary cost could not be verified.');
    setReview({job,offer:result});
  });}
  function confirm(){if(!review)return;const accepted=review;void work(async signal=>{
    setReview(undefined);if(Date.parse(accepted.offer.expiresAt)<=Date.now())throw new Error('The cost review expired. Review the combined summary cost again.');
    const result=await post('aggregation/confirm',{offerId:accepted.offer.offerId},signal) as Record<string,unknown>|null;
    if(signal.aborted)return;
    if(!result||result.complete!==true||result.availableInMailboxAnalyses!==true||result.requiresReview!==true||result.authorizesActions!==false)throw new Error('Summary completion could not be verified. Refresh mailbox analyses.');
    setStatus('The combined summary is ready. Open the mailbox and refresh analyses to review it.');
  });}
  return <section className="panel mailbox-jobs" aria-label="Your background analyses"><h2>Your background analyses</h2>
    <p>Your approved section jobs across this business’s mailboxes. They can continue while the app is closed, until their approval expires. Refresh to check current progress.</p>
    <button className="button secondary" disabled={busy} onClick={()=>load()}>{loaded?'Refresh background analyses':'View background analyses'}</button>
    <button className="button secondary" disabled={busy} onClick={()=>load(false,view==='all'?'active':'all')}>{view==='all'?'Show active analyses':'Show all analyses'}</button>
    {loaded&&<p>{view==='active'?'Showing active jobs only.':'Showing all job states, one page at a time.'} Refresh returns to the first page.</p>}
    {busy&&<p role="status">Checking background analysis…</p>}{status&&<p role="status">{status}</p>}{error&&<p role="alert">{error}</p>}
    {loaded&&!jobs.length&&<p>No background analyses on this page.</p>}
    {jobs.map(job=><article className="notice" key={job.id}><h3>Analysis {job.id.slice(0,8)} · {jobStates[job.status]}</h3>
      <p>Accepted: {new Date(job.createdAt).toLocaleString()}</p><p>{job.completedSections} of {job.totalSections} approved sections completed. Credit limit: {job.maximumTextCredits}.</p>
      <p>Approval ends: {new Date(job.approvalExpiresAt).toLocaleString()}. The combined summary is not included.</p>
      {job.status==='review_required'&&<p>Work stopped because it could not safely continue. Review the mailbox’s access and remaining message analysis before approving more work.</p>}
      {['queued','running'].includes(job.status)&&<><p>Stopping prevents further work. Already submitted requests may finish and use approved credits.</p><button className="button secondary" disabled={busy} onClick={()=>cancel(job)}>Stop job</button></>}
      {job.status==='completed'&&<button className="button secondary" disabled={busy} onClick={()=>quote(job)}>Review combined summary cost</button>}
    </article>)}
    {cursor&&<button className="button secondary" disabled={busy} onClick={()=>load(true)}>Next background analyses</button>}
    {review&&<div className="notice"><h3>Combined summary cost for analysis {review.job.id.slice(0,8)}</h3>
      <p>Uses up to {review.offer.textCredits} text {review.offer.textCredits===1?'credit':'credits'}. This combines completed sections only and does not authorize messages or appointments.</p>
      <p>Review expires: {new Date(review.offer.expiresAt).toLocaleTimeString()}.</p>
      <button className="button" disabled={busy} onClick={confirm}>Approve {review.offer.textCredits} {review.offer.textCredits===1?'credit':'credits'} for summary</button>
      <button className="button secondary" disabled={busy} onClick={()=>setReview(undefined)}>Cancel summary review</button>
    </div>}
  </section>;
}
