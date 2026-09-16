import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
type Usage={state:'unavailable'}|{state:'available';accepted:number;reserved:number;limit:number;remaining:number;resetsAt:string;warning:string;deliveryEnabled:boolean};
function valid(value:unknown):value is Usage{
  const u=value as Extract<Usage,{state:'available'}>|null;if(!u)return false;
  if((u.state as string)==='unavailable')return true;
  return u.state==='available'&&[u.accepted,u.reserved,u.limit,u.remaining,u.accepted+u.reserved].every(n=>Number.isSafeInteger(n)&&n>=0)&&u.limit>0&&u.remaining===Math.max(0,u.limit-u.accepted-u.reserved)&&typeof u.resetsAt==='string'&&Number.isFinite(Date.parse(u.resetsAt))&&typeof u.deliveryEnabled==='boolean'&&['normal','70','90','100'].includes(u.warning);
}
const warnings:Record<string,string>={'70':'70% or more of your email allowance is used or reserved.','90':'90% or more of your email allowance is used or reserved.','100':'Your email allowance is fully used or reserved. New email reservations are paused; no automatic overage charge is created.'};
export default function EmailUsagePanel({tenantId,online,onUnauthorized}:{tenantId:string;online:boolean;onUnauthorized:(error:unknown)=>void}){
  const [usage,setUsage]=useState<Usage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),request=useRef<AbortController|null>(null);
  const refresh=useCallback(async()=>{
    request.current?.abort();setUsage(null);setError('');if(!online)return;
    const controller=new AbortController();request.current=controller;setLoading(true);
    try{const result=await api<unknown>(`/api/tenants/${encodeURIComponent(tenantId)}/platform-email-usage`,{signal:controller.signal});if(!valid(result))throw new Error('Email usage could not be verified.');if(!controller.signal.aborted)setUsage(result);}
    catch(cause){if(!controller.signal.aborted){setUsage(null);setError(cause instanceof Error?cause.message:'Email usage is unavailable.');if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);}}
    finally{if(!controller.signal.aborted)setLoading(false);}
  },[tenantId,online,onUnauthorized]);
  useEffect(()=>{setLoading(false);void refresh();return()=>request.current?.abort();},[refresh]);
  return <section className="panel usage-panel" aria-label="Platform email usage"><div className="panel-heading"><h2>Platform emails</h2><button className="button secondary" disabled={!online||loading} onClick={()=>void refresh()}>Refresh email usage</button></div>
    {!online?<p>Reconnect to load email usage.</p>:loading?<p role="status">Loading email usage…</p>:error?<p role="alert">{error}</p>:usage?.state==='unavailable'?<p>Your email allowance is unavailable. Review your subscription or contact support.</p>:usage?.state==='available'?<>
      <dl className="usage-list"><div><dt>Monthly email allowance</dt><dd>{usage.limit.toLocaleString()}</dd></div><div><dt>Accepted by email provider</dt><dd>{usage.accepted.toLocaleString()}</dd></div><div><dt>Reserved or awaiting confirmation</dt><dd>{usage.reserved.toLocaleString()}</dd></div><div><dt>Available emails</dt><dd>{usage.remaining.toLocaleString()}</dd></div><div><dt>Email allowance resets</dt><dd>{new Date(usage.resetsAt).toLocaleString()}</dd></div></dl>
      {Object.hasOwn(warnings,usage.warning)&&<p role="status">{warnings[usage.warning]}</p>}
      {!usage.deliveryEnabled&&<p>Email delivery is currently disabled.</p>}
      <p>Acceptance does not confirm delivery. Uncertain sends keep their reservation until resolved. Included emails reset monthly, including on annual plans; unused capacity does not roll over.</p><p>This covers platform notices such as team invitations. Connected Gmail and Outlook correspondence uses separate workflow allowances.</p>
    </>:<p>Email usage has not been reported yet.</p>}
  </section>;
}
