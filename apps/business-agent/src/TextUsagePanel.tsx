import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
type Usage={period:string;resetsAt?:string;textCredits:{used:number;reserved:number;limit:number}};
function valid(value:unknown):value is Usage {
  const usage=value as Usage|undefined;
  return !!usage&&typeof usage.period==='string'&&!!usage.textCredits&&
    [usage.textCredits.used,usage.textCredits.reserved,usage.textCredits.limit].every(n=>Number.isSafeInteger(n)&&n>=0);
}
export default function TextUsagePanel({tenantId,online,onUnauthorized}:{tenantId:string;online:boolean;onUnauthorized:(cause:unknown)=>void}) {
  const [usage,setUsage]=useState<Usage|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const request=useRef<AbortController|null>(null);
  const refresh=useCallback(async()=>{
    request.current?.abort();if(!online)return;
    const controller=new AbortController();request.current=controller;setLoading(true);setError('');setUsage(null);
    try {
      const result=await api<{usage:unknown}>(`/api/tenants/${encodeURIComponent(tenantId)}/usage`,{signal:controller.signal});
      if(!valid(result.usage))throw new Error('Usage totals are not available yet.');
      if(!controller.signal.aborted)setUsage(result.usage);
    }catch(cause){if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'Usage could not be loaded.');if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);}}
    finally{if(!controller.signal.aborted)setLoading(false);}
  },[tenantId,online,onUnauthorized]);
  useEffect(()=>{setUsage(null);setLoading(false);void refresh();return()=>request.current?.abort();},[refresh]);
  const credits=usage?.textCredits;
  const reset=usage?.resetsAt&&Number.isFinite(Date.parse(usage.resetsAt))?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(usage.resetsAt)):null;
  return <section className="panel usage-panel" aria-label="Text credit usage">
    <div className="panel-heading"><h2>Text credits</h2><button className="button secondary" disabled={!online||loading} onClick={()=>void refresh()}>Refresh usage</button></div>
    {!online?<p>Reconnect to load current usage.</p>:loading?<p role="status">Loading usage…</p>:error?<p role="alert">{error}</p>:usage?.period==='unavailable'?<p>Your text allowance is unavailable. Review your subscription status or contact support.</p>:credits?<>
      <dl className="usage-list">
        <div><dt>{usage?.period==='trial'?'Trial allowance':'Monthly allowance'}</dt><dd>{credits.limit.toLocaleString()} credits</dd></div>
        <div><dt>Completed responses</dt><dd>{credits.used.toLocaleString()}</dd></div>
        <div><dt>Responses in progress</dt><dd>{credits.reserved.toLocaleString()}</dd></div>
        <div><dt>Available credits</dt><dd>{Math.max(0,credits.limit-credits.used-credits.reserved).toLocaleString()}</dd></div>
        {usage?.period!=='trial'&&<div><dt>Next allowance reset</dt><dd>{reset??'Not reported'}</dd></div>}
      </dl>
      <p className="small muted">Completed text responses use credits. Failed responses do not. In-progress responses reserve credits until they finish.</p>
      {usage?.period!=='trial'&&<p className="small muted">Included credits reset monthly, including on annual plans, and do not roll over. Times use your device’s timezone.</p>}
    </>:<p>Usage has not been reported yet.</p>}
  </section>;
}
