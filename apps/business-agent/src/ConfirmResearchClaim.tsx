import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';

export default function ConfirmResearchClaim({tenantId,jobId,url,index,field,value,online,onSaved,onUnauthorized}:{tenantId:string;jobId:string;url:string;index:number;field:string;value:string;online:boolean;onSaved:()=>Promise<void>;onUnauthorized:(cause:unknown)=>void}){
  const [open,setOpen]=useState(false),[topic,setTopic]=useState(field.replaceAll('_',' ')),[reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
  const pending=useRef<string|null>(null),active=useRef<AbortController|null>(null);
  useEffect(()=>()=>active.current?.abort(),[]);
  async function confirm(){
    if(!online||busy||!reviewed||!topic.trim())return;
    const controller=new AbortController();active.current=controller;setBusy(true);setError('');
    const body=pending.current??JSON.stringify({url,index,key:topic.trim(),expectedValue:value});pending.current=body;
    try{
      const response=await api<{confirmed:boolean;removed:boolean;memory:{key:string;value:string}|null}>(`/api/tenants/${encodeURIComponent(tenantId)}/research/${encodeURIComponent(jobId)}/confirm`,{method:'POST',body,signal:controller.signal});
      if(response.confirmed!==true||typeof response.removed!=='boolean'||(!response.removed&&(!response.memory||response.memory.key!==JSON.parse(body).key||response.memory.value!==value)))throw new Error('The confirmation response was incomplete. Retry the same confirmation to check its outcome.');
      if(controller.signal.aborted)return;
      setSaved(response.removed?'This claim was confirmed previously, then removed from knowledge. It has not been recreated.':'Saved to business knowledge with its source.');
      try{await onSaved();}catch{if(!controller.signal.aborted)setError('The fact was confirmed, but saved knowledge could not refresh. Refresh the workspace to see the latest details.');}
    }catch(cause){if(!controller.signal.aborted){
      if(cause instanceof ApiError&&cause.status===409&&cause.code==='research_memory_conflict')pending.current=null;
      setError(cause instanceof Error?cause.message:'Confirmation could not be completed. Retry to check the same request.');
      if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);
    }}finally{if(!controller.signal.aborted)setBusy(false);}
  }
  if(saved)return <div><p role="status">{saved}</p>{error&&<p role="alert">{error}</p>}</div>;
  return <div className="stack">
    {!open?<button className="button secondary" disabled={!online} onClick={()=>setOpen(true)}>Review for business knowledge</button>:<form className="stack" onSubmit={event=>{event.preventDefault();void confirm();}}>
      <label className="field">Knowledge topic<input value={topic} maxLength={120} required disabled={busy||!!pending.current} onChange={event=>setTopic(event.target.value)}/></label>
      <p>The claim above will be saved exactly as shown. An existing topic will not be replaced.</p>
      <label><input type="checkbox" checked={reviewed} disabled={busy||!!pending.current} onChange={event=>setReviewed(event.target.checked)}/> I reviewed this claim and confirm it is accurate for my business.</label>
      <p className="small muted">This saves a business fact. It does not authorize messages, bookings or other actions.</p>
      {error&&<p role="alert">{error}</p>}
      <button className="button primary" type="submit" disabled={!online||busy||!reviewed||!topic.trim()}>{busy?'Confirming…':pending.current?'Retry same confirmation':'Confirm and save fact'}</button>
    </form>}
  </div>;
}
