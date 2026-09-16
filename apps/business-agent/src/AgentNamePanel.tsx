import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';

export default function AgentNamePanel({tenantId,agentName,online,onSaved,onUnauthorized}:{tenantId:string;agentName:string;online:boolean;onSaved:()=>Promise<void>;onUnauthorized:(cause:unknown)=>void}){
  const [name,setName]=useState(agentName),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const active=useRef<AbortController|null>(null),pending=useRef<{key:string;body:string;name:string}|null>(null);
  useEffect(()=>{if(!pending.current)setName(agentName);},[agentName]);
  useEffect(()=>{if(!online){active.current?.abort();setBusy(false);}return()=>active.current?.abort();},[online]);
  async function save(){
    if(!online||busy)return;
    const request=pending.current??{key:crypto.randomUUID(),body:JSON.stringify({agentName:name.trim(),expectedName:agentName}),name:name.trim()};pending.current=request;
    const controller=new AbortController();active.current=controller;setBusy(true);setError('');setNotice('');
    try{
      const result=await api<{agentName:string}>(`/api/tenants/${encodeURIComponent(tenantId)}/agent-name`,{method:'POST',headers:{'X-Idempotency-Key':request.key},body:request.body,signal:controller.signal});
      if(result.agentName!==request.name)throw new Error('The response was incomplete. Retry the same name change.');
      if(controller.signal.aborted)return;pending.current=null;setNotice('Assistant name saved.');await onSaved();
    }catch(cause){if(!controller.signal.aborted){if(cause instanceof ApiError&&['agent_name_changed','invalid_agent_name'].includes(cause.code))pending.current=null;setError(cause instanceof Error?cause.message:'The name could not be saved.');if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);}}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  return <form className="stack" aria-label="Assistant name settings" onSubmit={event=>{event.preventDefault();void save();}}>
    <label htmlFor={`${tenantId}-agent-name`}>Assistant display name</label><input id={`${tenantId}-agent-name`} value={name} maxLength={60} disabled={!online||busy||!!pending.current} onChange={event=>setName(event.target.value)}/>
    <p className="small muted">Use a name your team will recognize. This changes the display name, not the assistant’s permissions.</p>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <button className="button primary" disabled={!online||busy||!name.trim()||name.trim()===agentName&&!pending.current||/[\p{Cc}\p{Cf}]/u.test(name)}>{busy?'Saving name…':pending.current?'Retry same name change':'Save assistant name'}</button>
    <button type="button" className="button secondary" disabled={!online||busy||!!pending.current} onClick={()=>void onSaved().catch(onUnauthorized)}>Reload current name</button>
  </form>;
}
