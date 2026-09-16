import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';

export default function StartResearch({tenantId,online,onCreated,onUnauthorized}:{tenantId:string;online:boolean;onCreated:(job:unknown)=>void;onUnauthorized:(cause:unknown)=>void}){
  const [url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef<{key:string;body:string}|null>(null),active=useRef<AbortController|null>(null);
  useEffect(()=>()=>active.current?.abort(),[]);
  async function submit(){
    if(!online||busy)return;
    if(!pending.current){
      try{const website=new URL(url.trim());if(!['https:','http:'].includes(website.protocol)||website.username||website.password)throw new Error();}
      catch{setError('Enter a public website URL starting with https:// or http://.');return;}
      pending.current={key:crypto.randomUUID(),body:JSON.stringify({url:url.trim(),pages:20,depth:2})};
    }
    const request=pending.current,controller=new AbortController();active.current=controller;setBusy(true);setError('');
    try{
      const response=await api<{job:unknown}>(`/api/tenants/${encodeURIComponent(tenantId)}/research`,{method:'POST',body:request.body,headers:{'X-Idempotency-Key':request.key},signal:controller.signal});
      if(!controller.signal.aborted)onCreated(response.job);
    }catch(cause){if(!controller.signal.aborted){
      // Only explicit pre-reservation rejections allow a different request.
      if(cause instanceof ApiError&&['research_disabled','research_not_ready','invalid_research_request','research_page_limit','research_job_limit','research_trial_unavailable','agent_paused'].includes(cause.code))pending.current=null;
      setError(cause instanceof Error?cause.message:'Research could not be requested. Retry the same request to check its outcome.');
      if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);
    }}finally{if(!controller.signal.aborted)setBusy(false);}
  }
  return <form className="stack" aria-label="Request website research" onSubmit={event=>{event.preventDefault();void submit();}}>
    <label className="field">Website to research<input type="url" required maxLength={4096} placeholder="https://your-business.com" value={url} disabled={busy||!!pending.current} onChange={event=>setUrl(event.target.value)}/></label>
    <p className="small muted">Request up to 20 public pages. Your plan allowance and research availability are checked before the request is accepted. You will review the findings before saving business knowledge.</p>
    {error&&<p role="alert">{error}</p>}
    {pending.current&&!busy&&<p role="status">The request outcome is unconfirmed. Retry uses the same website and request to avoid creating duplicate work.</p>}
    <button className="button primary" type="submit" disabled={!online||busy||!url.trim()}>{busy?'Requesting research…':pending.current?'Retry same research request':'Request website research'}</button>
  </form>;
}
