import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
import MailboxRecovery from './MailboxRecovery';
const labels={not_started:'Not set up',initializing:'Reading initial mailbox references',monitoring:'Monitoring configured',paused:'Paused',stopped:'Monitoring stopped',needs_attention:'Needs attention',disabled:'Monitoring unavailable',reconnect_required:'Reconnect required'};
type Status={state:keyof typeof labels;setupEnabled:boolean;pending:number;lastObservedAt:string|null;configuredFolders?:number;controlRevision?:number;resumeEnabled?:boolean};
function valid(value:unknown):value is Status {
  const s=value as Status|null;return !!s&&Object.hasOwn(labels,s.state)&&typeof s.setupEnabled==='boolean'
    &&(!s.setupEnabled||s.state==='not_started')&&Number.isSafeInteger(s.pending)&&s.pending>=0
    &&(s.state!=='stopped'||typeof s.resumeEnabled==='boolean'&&Number.isSafeInteger(s.controlRevision)&&s.controlRevision!>0)
    &&(s.lastObservedAt===null||typeof s.lastObservedAt==='string'&&Number.isFinite(Date.parse(s.lastObservedAt)));
}
export default function MailboxPanel({tenantId,grantId,online,onUnauthorized,provider='google'}:{tenantId:string;grantId:string;online:boolean;onUnauthorized:(error:unknown)=>void;provider?:'google'|'microsoft'}) {
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),request=useRef<AbortController|null>(null);
  const [confirmStop,setConfirmStop]=useState(false);
  const load=useCallback(async(start=false)=>{
    request.current?.abort();setStatus(null);setError('');if(!online)return;
    const controller=new AbortController();request.current=controller;setBusy(true);
    try {
      const result=await api<unknown>(`/api/tenants/${encodeURIComponent(tenantId)}/connections/${encodeURIComponent(grantId)}/mailbox${provider==='microsoft'?'/folders/status':''}`,
        {signal:controller.signal,...start?{method:'POST',body:'{}'}:{}});
      if(!valid(result)||(provider==='microsoft'&&(!Number.isSafeInteger(result.configuredFolders)||result.configuredFolders!<0||result.setupEnabled)))throw new Error('Mailbox status could not be verified.');
      if(!controller.signal.aborted)setStatus(result);
    } catch(cause) {
      if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'Mailbox status is unavailable.');if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);}
    } finally {if(!controller.signal.aborted)setBusy(false);}
  },[tenantId,grantId,online,onUnauthorized,provider]);
  useEffect(()=>{setBusy(false);void load();return()=>request.current?.abort();},[load]);
  useEffect(()=>setConfirmStop(false),[tenantId,grantId,online]);
  async function stop(resume=false) {
    const expectedRevision=status?.controlRevision;
    if(resume&&(!status?.resumeEnabled||!expectedRevision))return;
    request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(true);setError('');setStatus(null);setConfirmStop(false);
    try{
      await api(`/api/tenants/${encodeURIComponent(tenantId)}/connections/${encodeURIComponent(grantId)}/mailbox/${resume?'resume':'stop'}`,{method:'POST',body:JSON.stringify(resume?{expectedRevision}:{}),signal:controller.signal});
      if(!controller.signal.aborted)await load();
    }catch(cause){if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'Stop could not be verified.');if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);}}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  return <div aria-label="Mailbox monitoring" className="notice mailbox-panel"><div>
    <h3>Mailbox monitoring</h3>
    {!online?<p>Reconnect to check mailbox status.</p>:busy?<p role="status">Checking mailbox…</p>:error?<p role="alert">{error} Refresh status before trying setup again.</p>:status?<>
      <p>{labels[status.state]}</p><p>{status.pending.toLocaleString()} message references awaiting processing.</p>
      {provider==='microsoft'&&<p>{status.configuredFolders} folders configured under current account permission.</p>}
      <p>{status.lastObservedAt?`Last message observation: ${new Date(status.lastObservedAt).toLocaleString()}`:'No message observation recorded yet.'}</p>
      {status.state==='not_started'&&!status.setupEnabled&&<p>{provider==='microsoft'?'Use folder discovery to select folders after your subscription and mailbox service are activated.':'Setup becomes available after your subscription and mailbox service are activated.'}</p>}
      {status.state==='needs_attention'&&<><p>Review synchronization recovery. Your saved records are preserved.</p>
        <MailboxRecovery key={`${tenantId}:${grantId}`} tenantId={tenantId} grantId={grantId} onRecovered={()=>void load()} onUnauthorized={onUnauthorized}/></>}
      {status.state==='stopped'&&<><p>Saved progress is preserved. Resuming does not reset recovery issues or guarantee that old provider checkpoints remain valid.</p>
        {status.resumeEnabled?<button className="button secondary" disabled={busy||!online} onClick={()=>void stop(true)}>Resume monitoring</button>:<p>Resume is unavailable until account permission and mailbox service readiness are verified.</p>}</>}
      {status.setupEnabled&&<button className="button secondary" onClick={()=>void load(true)}>Set up mailbox monitoring</button>}
    </>:null}
    <button className="button secondary" disabled={!online||busy} onClick={()=>void load()}>Refresh mailbox status</button>
    {status&&status.state!=='stopped'&&status.state!=='not_started'&&<button className="button secondary" disabled={!online||busy} onClick={()=>setConfirmStop(true)}>Stop monitoring</button>}
    {confirmStop&&online&&<div><p>Stop monitoring this account? Pending work and saved progress will remain. Calendar access is unchanged.</p>
      <button className="button secondary" disabled={busy} onClick={()=>void stop()}>Confirm stop monitoring</button>
      <button className="button secondary" disabled={busy} onClick={()=>setConfirmStop(false)}>Keep monitoring</button></div>}
    <p>Monitoring reads this account. Sending replies requires separate permission and an approved automation.</p>
  </div></div>;
}
