import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
type Notice={id:string;recordedAt:string;title:string;message:string};
type Page={notices:Notice[];nextCursor:string|null};
const key=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
function valid(value:unknown):value is Page{
  const page=value as Page|null;
  return !!page&&Array.isArray(page.notices)&&page.notices.length<=25&&(page.nextCursor===null||key(page.nextCursor))&&page.notices.every(n=>n&&key(n.id)&&typeof n.recordedAt==='string'&&Number.isFinite(Date.parse(n.recordedAt))&&typeof n.title==='string'&&n.title.length<=100&&typeof n.message==='string'&&n.message.length<=500);
}
export default function BillingNotices({tenantId,online,onUnauthorized}:{tenantId:string;online:boolean;onUnauthorized:(error:unknown)=>void}){
  const [items,setItems]=useState<Notice[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState('');
  const request=useRef<AbortController|null>(null);
  const load=useCallback(async(after?:string)=>{
    request.current?.abort();if(!online)return;
    const controller=new AbortController();request.current=controller;setLoading(true);setError('');
    if(!after){setItems([]);setCursor(null);setLoaded(false);}
    try{
      const result=await api<unknown>(`/api/agent-billing/notices?tenantId=${encodeURIComponent(tenantId)}${after?`&cursor=${encodeURIComponent(after)}`:''}`,{signal:controller.signal});
      if(!valid(result)||result.nextCursor&&(!result.notices.length||result.nextCursor===after))throw new Error('Billing activity could not be read. Refresh to try again.');
      if(controller.signal.aborted)return;
      setItems(previous=>after?[...previous,...result.notices.filter(item=>!previous.some(old=>old.id===item.id))]:result.notices);setCursor(result.nextCursor);setLoaded(true);
    }catch(cause){if(!controller.signal.aborted){setItems([]);setCursor(null);setLoaded(false);setError(cause instanceof Error?cause.message:'Billing activity is unavailable.');if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);}}
    finally{if(!controller.signal.aborted)setLoading(false);}
  },[tenantId,online,onUnauthorized]);
  useEffect(()=>{setItems([]);setCursor(null);setLoaded(false);setLoading(false);setError('');void load();return()=>request.current?.abort();},[load]);
  return <section className="panel" aria-label="Billing activity">
    <div className="panel-heading"><h2>Billing activity</h2><button className="button secondary" disabled={!online||loading} onClick={()=>void load()}>Refresh billing activity</button></div>
    <p>Past billing updates appear here. Your current subscription shows your latest access status.</p>
    {!online?<p>Reconnect to load billing activity.</p>:<>
      {error&&<p role="alert">{error}</p>}
      {items.length>0&&<ol>{items.map(item=><li key={item.id}><h3>{item.title}</h3><p>{item.message}</p><p className="small muted">Recorded <time dateTime={item.recordedAt}>{new Date(item.recordedAt).toLocaleString()}</time></p></li>)}</ol>}
      {loading&&<p role="status">Loading billing activity…</p>}
      {loaded&&!items.length&&!loading&&<p>No billing updates have been recorded yet.</p>}
      {cursor&&<button className="button secondary" disabled={loading} onClick={()=>void load(cursor)}>Load older billing activity</button>}
    </>}
  </section>;
}
