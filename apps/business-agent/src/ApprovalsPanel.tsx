import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { api, ApiError, post } from './api';

type Review = {
  id:string; requestedBy:string; policyId:string; policyVersion:number; actionHash:string;
  status:string; createdAt:string; expiresAt:string; approvedBy:string|null; approvedAt:string|null;
  reason:string|null; executionAvailable:boolean; executionNote:string;
  receipt?:{provider:string;state:'accepted'|'applied';id?:string;calendarId?:string;internetMessageId?:string}|null;
  action: {operation:'mail.reply';resourceId:string;messageId:string;recipient:string;text:string}
    | {operation:'calendar.create';resourceId:string;title:string;description?:string;attendees:string[];start:string;end:string;timeZone:string};
};
export default function ApprovalsPanel({tenantId,role,online,paused,onUnauthorized}:{
  tenantId:string;role:string;online:boolean;paused:boolean;onUnauthorized:(error:unknown)=>void;
}) {
  const [reviews,setReviews]=useState<Review[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState('');
  const [loading,setLoading]=useState(true),[notice,setNotice]=useState('');
  const mounted=useRef(true),request=useRef<AbortController|null>(null),inFlight=useRef(false);
  const canRead=['owner','manager','staff'].includes(role),canDecide=['owner','manager'].includes(role);
  const endpoint=`/api/tenants/${encodeURIComponent(tenantId)}/actions`;
  const report=useCallback((cause:unknown)=>{
    if(!mounted.current||(cause instanceof DOMException&&cause.name==='AbortError')) return;
    setError(cause instanceof Error?cause.message:'The review could not be completed.');
    if(cause instanceof ApiError&&cause.status===401) onUnauthorized(cause);
  },[onUnauthorized]);
  const refresh=useCallback(async()=>{
    if(!canRead){setLoading(false);return;}
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setLoading(true);setError('');
    try {
      const result=await api<{actions:Review[]}>(endpoint,{signal:controller.signal});
      if(!Array.isArray(result.actions)) throw new Error('The workspace returned an unexpected review list.');
      if(mounted.current&&!controller.signal.aborted) setReviews(result.actions);
    } catch(cause) {
      if(mounted.current&&!controller.signal.aborted) setReviews([]);
      report(cause);
    } finally {if(mounted.current&&!controller.signal.aborted)setLoading(false);}
  },[canRead,endpoint,report]);
  useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;request.current?.abort();};},[refresh]);
  async function decide(review:Review,decision:'approve'|'reject') {
    if(inFlight.current||!online||!canDecide||(decision==='approve'&&paused)) return;
    inFlight.current=true;setBusy(review.id);setError('');setNotice('');
    try {
      const result=await post<{action:Review}>(`${endpoint}/${encodeURIComponent(review.id)}/decision`,{decision,actionHash:review.actionHash});
      if(result.action.id!==review.id||result.action.actionHash!==review.actionHash) throw new Error('The returned review does not match this action. Refresh before continuing.');
      if(mounted.current) {
        setReviews(items=>items.map(item=>item.id===review.id?result.action:item));
        setNotice(decision==='approve'?'Permission recorded. This is not a delivery or booking confirmation.':'Action rejected.');
      }
    } catch(cause){report(cause);}
    finally {inFlight.current=false;if(mounted.current)setBusy('');}
  }
  async function execute(review:Review) {
    if(inFlight.current||!online||paused||!canDecide||!review.executionAvailable||review.status!=='approved')return;
    inFlight.current=true;setBusy(review.id);setError('');setNotice('');
    try {
      const result=await post<{action:Review;receipt:NonNullable<Review['receipt']>}>(`${endpoint}/${encodeURIComponent(review.id)}/execute`,{actionHash:review.actionHash});
      if(result.action.id!==review.id||result.action.actionHash!==review.actionHash||result.action.status!=='succeeded'||!['accepted','applied'].includes(result.receipt.state))
        throw new Error('The provider result could not be verified. Refresh the review before taking another action.');
      if(mounted.current){setReviews(items=>items.map(item=>item.id===review.id?result.action:item));
        setNotice(result.receipt.state==='accepted'?'The provider accepted the reply. Delivery is not yet confirmed.':'The provider confirmed the appointment was created.');}
    }catch(cause){await refresh();report(cause);}
    finally{inFlight.current=false;if(mounted.current)setBusy('');}
  }
  return <div className="page approvals-page">
    <div className="page-heading"><span className="eyebrow">YOU HAVE THE FINAL SAY</span><h1>Approvals.</h1>
      <p>Review the exact recipient, content and destination before granting permission.</p></div>
    {!canRead?<section className="panel"><h2>Review access is limited</h2><p>Your role cannot view customer action reviews.</p></section>:<>
      <div className="billing-toolbar"><p className="small muted">Staff see their own proposals. Owners and managers can decide.</p>
        <button className="button secondary" disabled={!online||loading||!!busy} onClick={()=>void refresh()}><RefreshCw size={16}/> Refresh reviews</button></div>
      {error&&<div className="banner error" role="alert">{error}</div>}
      {notice&&<div className="notice" role="status">{notice}</div>}
      {paused&&<div className="notice"><ShieldCheck size={18}/><p>Your agent is paused. You can reject actions; approval requires resuming the agent.</p></div>}
      {loading?<p role="status">Loading action reviews…</p>:!reviews.length&&!error?<section className="panel"><h2>No actions waiting for review</h2><p>Proposed replies and appointments will appear here when a configured workflow creates them.</p></section>:null}
      <div className="stack">{reviews.map(review=><article className="panel action-review" key={review.id} aria-label={review.action.operation==='mail.reply'?'Reply review':'Appointment review'}>
        <div className="panel-heading"><h2>{review.action.operation==='mail.reply'?'Reply to customer':review.action.title}</h2><span className="subtle-pill">{review.status}</span></div>
        <dl className="details-list">
          <div><dt>Destination</dt><dd>{review.action.resourceId}</dd></div>
          {review.action.operation==='mail.reply'?<div><dt>Recipient</dt><dd>{review.action.recipient}</dd></div>:<>
            <div><dt>Guests</dt><dd>{review.action.attendees.join(', ')}</dd></div>
            <div><dt>Start</dt><dd>{review.action.start}</dd></div><div><dt>End</dt><dd>{review.action.end}</dd></div>
            <div><dt>Timezone</dt><dd>{review.action.timeZone}</dd></div></>}
          <div><dt>Review expires</dt><dd>{new Date(review.expiresAt).toLocaleString()}</dd></div>
          <div><dt>Policy version</dt><dd>{review.policyVersion}</dd></div>
        </dl>
        <p className="action-preview">{review.action.operation==='mail.reply'?review.action.text:review.action.description||'No appointment description.'}</p>
        {review.reason&&<p className="small">{review.reason}</p>}
        {review.receipt&&<p className="small" aria-label="Provider receipt">{review.receipt.provider}: {review.receipt.state==='accepted'?'Reply accepted; delivery not confirmed.':'Appointment created.'}
          {review.receipt.id&&` Receipt: ${review.receipt.id}`}</p>}
        {!review.executionAvailable&&<p className="small muted">{review.executionNote}</p>}
        {canDecide&&['pending','approved','preview'].includes(review.status)&&<div className="dialog-actions">
          <button className="button secondary" disabled={!online||!!busy||loading} onClick={()=>void decide(review,'reject')}><X size={16}/> Reject action</button>
          {review.status==='pending'&&<button className="button primary" disabled={!online||paused||!!busy||loading} onClick={()=>void decide(review,'approve')}><Check size={16}/> Approve action</button>}
          {review.status==='approved'&&review.executionAvailable&&<button className="button primary" disabled={!online||paused||!!busy||loading} onClick={()=>void execute(review)}>
            {review.action.operation==='mail.reply'?'Send approved reply':'Book approved appointment'}</button>}
        </div>}
      </article>)}</div>
    </>}
  </div>;
}
