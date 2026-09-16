import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
type Offer={recoveryId:string;expiresAt:string;pendingReferences:number;cachedMessages:number;affectedStreams:number;targetLabel:string};
function valid(value:unknown):value is Offer {
  const v=value as Offer|null;return !!v&&typeof v.recoveryId==='string'&&/^[a-f0-9-]{36}$/.test(v.recoveryId)
    &&typeof v.expiresAt==='string'&&Date.parse(v.expiresAt)>Date.now()
    &&typeof v.targetLabel==='string'&&v.targetLabel.length>0&&v.targetLabel.length<=2048
    &&[v.pendingReferences,v.cachedMessages,v.affectedStreams].every(n=>Number.isSafeInteger(n)&&n>=0)&&v.affectedStreams>0;
}
export default function MailboxRecovery({tenantId,grantId,onRecovered,onUnauthorized}:{tenantId:string;grantId:string;onRecovered:()=>void;onUnauthorized:(error:unknown)=>void}) {
  const [offer,setOffer]=useState<Offer|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempted,setAttempted]=useState(false);
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  async function run(confirm=false) {
    if(busy||confirm&&!offer)return;
    request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(true);setError('');
    if(confirm)setAttempted(true);else{setOffer(null);setAttempted(false);}
    try{
      const result=await api<unknown>(`/api/tenants/${encodeURIComponent(tenantId)}/connections/${encodeURIComponent(grantId)}/mailbox/recovery`,
        {method:'POST',body:JSON.stringify(confirm?{recoveryId:offer!.recoveryId}:{}),signal:controller.signal});
      if(controller.signal.aborted)return;
      if(confirm){if((result as {state?:string})?.state!=='restarted')throw new Error('Recovery could not be verified.');onRecovered();}
      else{if(!valid(result))throw new Error('Recovery review could not be verified.');setOffer(result);}
    }catch(cause){if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'Recovery is unavailable.');if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);}}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  return <section aria-label="Mailbox recovery">
    {error&&<p role="alert">{error}{attempted?' Retry this recovery request or refresh mailbox status before reviewing another.':''}</p>}
    {offer&&<>
      <p>Recovery target: {offer.targetLabel}</p>
      <p>Targets needing recovery: {offer.affectedStreams}. This review applies only to the target above. Folder names reflect the latest saved setup.</p>
      <p>At review: {offer.pendingReferences} pending references and {offer.cachedMessages} cached messages.</p>
      <p>Recovery replaces queued references with a fresh scan. Saved messages must be checked again. It does not send messages or delete mail from your provider.</p>
      <button className="button secondary" disabled={busy} onClick={()=>void run(true)}>{attempted?'Retry same recovery':'Confirm mailbox recovery'}</button>
    </>}
    {!attempted&&<button className="button secondary" disabled={busy} onClick={()=>void run()}>{offer?'Review again':'Review mailbox recovery'}</button>}
    {busy&&<p role="status">{attempted?'Requesting recovery…':'Preparing recovery review…'}</p>}
  </section>;
}
