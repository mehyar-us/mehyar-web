import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {api,ApiError,post} from './api';
type Policy={id:string;version:number;name:string;trigger:string;operation:'mail.reply'|'calendar.create';provider:string;grantId:string;
  mode:'preview'|'approve'|'automatic';resources:string[];recipients:string[];template?:string;startsAt:string;expiresAt:string;
  maxActionsPerDay:number;maxCostMicrosPerDay:number;escalation:string;enabled:boolean};
export default function PolicyManager({tenantId,online,onUnauthorized,onChanged}:{tenantId:string;online:boolean;onUnauthorized:(cause:unknown)=>void;onChanged:()=>void}) {
  const [policies,setPolicies]=useState<Policy[]>([]),[draft,setDraft]=useState<Policy|null>(null);
  const [recipientText,setRecipientText]=useState(''),[expiryText,setExpiryText]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const mounted=useRef(true),inFlight=useRef(false),request=useRef<AbortController|null>(null);
  const endpoint=`/api/tenants/${encodeURIComponent(tenantId)}/action-policies`;
  const report=useCallback((cause:unknown)=>{
    if(!mounted.current||cause instanceof DOMException&&cause.name==='AbortError')return;
    setError(cause instanceof Error?cause.message:'Could not update this policy.');
    if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);
  },[onUnauthorized]);
  const refresh=useCallback(async()=>{
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setLoading(true);setError('');
    try {
      const result=await api<{policies:Policy[]}>(endpoint,{signal:controller.signal});
      if(!Array.isArray(result.policies))throw new Error('Saved policies could not be verified.');
      if(!controller.signal.aborted&&mounted.current){setPolicies(result.policies);setDraft(null);}
    }catch(cause){report(cause);}finally{if(!controller.signal.aborted&&mounted.current)setLoading(false);}
  },[endpoint,report]);
  useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;request.current?.abort();};},[refresh]);
  async function save(event:FormEvent) {
    event.preventDefault();if(!draft||inFlight.current||!online)return;
    // Whitelist policy fields: response metadata is never echoed into the strict API.
    const {id,version,name,trigger,operation,provider,grantId,mode,resources,template,startsAt,maxActionsPerDay,maxCostMicrosPerDay,escalation,enabled}=draft;
    const recipients=[...new Set(recipientText.split(/[\n,;]/).map(value=>value.trim().toLowerCase()).filter(Boolean))];
    if(!recipients.length||recipients.length>100||recipients.some(value=>!/^\S+@\S+\.\S+$/.test(value))) {
      setError('Enter between one and 100 valid recipient email addresses.');return;
    }
    const expiry=Date.parse(expiryText+'Z');
    if(!Number.isFinite(expiry)||expiry<=Date.parse(startsAt)||(enabled&&expiry<=Date.now())||expiry>Date.now()+366*86400000) {
      setError('Choose an expiry after the policy start and within one year. Enabled policies must expire in the future.');return;
    }
    const expiresAt=expiryText===new Date(draft.expiresAt).toISOString().slice(0,19)?draft.expiresAt:new Date(expiry).toISOString();
    const body={id,expectedVersion:version,name,trigger,operation,provider,grantId,mode,resources,recipients,template,startsAt,expiresAt,maxActionsPerDay,maxCostMicrosPerDay,escalation,enabled};
    inFlight.current=true;setBusy(true);setError('');setNotice('');
    try {
      const result=await post<{policy:Policy}>(endpoint,body);
      if(result.policy.id!==id||result.policy.version!==version+1)throw new Error('Policy update could not be verified. Refresh before making another change.');
      if(mounted.current){setPolicies(items=>items.map(item=>item.id===id?result.policy:item));setDraft(null);
        setNotice('Policy updated. Pending approvals under the previous version have been cancelled. Already dispatched actions may still finish.');onChanged();}
    }catch(cause){report(cause);}finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  }
  return <section className="panel calendar-policy" aria-label="Saved policies">
    <h2>Saved permissions</h2><p>Review or withdraw the rules your agent can use. Changing a policy requires new approvals for pending actions.</p>
    <button className="button secondary" disabled={!online||busy||loading} onClick={()=>void refresh()}>Refresh policies</button>
    {loading?<p role="status">Loading policies…</p>:!policies.length&&!error?<p>No policies have been saved.</p>:null}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!draft&&policies.map(policy=><article key={policy.id} aria-label={`Policy: ${policy.name}`}>
      <h3>{policy.name}</h3><p>{policy.operation==='calendar.create'?'Appointments':'Email replies'} · {policy.enabled?'Enabled':'Disabled'} · Version {policy.version}</p>
      <p>Expires {new Date(policy.expiresAt).toLocaleString()} · Up to {policy.maxActionsPerDay} actions per day</p>
      <button className="button secondary" disabled={!online||busy||loading} onClick={()=>{setDraft({...policy});setRecipientText(policy.recipients.join('\n'));setExpiryText(new Date(policy.expiresAt).toISOString().slice(0,19));setError('');setNotice('');}}>Edit {policy.name}</button>
    </article>)}
    {draft&&<form onSubmit={event=>void save(event)} aria-label="Edit policy">
      <fieldset disabled={!online||busy} style={{border:0,padding:0,minWidth:0}}>
        <label className="field">Policy name<input required maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
        <label><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/> Policy enabled</label>
        <p>Calendar or message resources: {draft.resources.join(', ')}</p>
        <p>Provider: {draft.provider} · Policy starts {new Date(draft.startsAt).toLocaleString()}</p>
        <label className="field">Allowed recipient emails<textarea required value={recipientText} onChange={e=>setRecipientText(e.target.value)}/></label>
        <label className="field">Permission expiry (UTC)<input type="datetime-local" step={1} required value={expiryText} onChange={e=>setExpiryText(e.target.value)}/></label>
        <label className="field">Review mode<select value={draft.mode} onChange={e=>setDraft({...draft,mode:e.target.value as Policy['mode']})}>
          <option value="approve">Require approval for every action</option><option value="preview">Drafts only</option>
          {draft.mode==='automatic'&&<option value="automatic" disabled>Saved automatic policy (execution still requires approval)</option>}
        </select></label>
        <p>Daily supplier spending limit: ${(draft.maxCostMicrosPerDay/1_000_000).toFixed(2)}</p>
        <label className="field">Maximum actions per day<input type="number" required min={1} max={1000} step={1} value={draft.maxActionsPerDay} onChange={e=>setDraft({...draft,maxActionsPerDay:Number(e.target.value)})}/></label>
        <label className="field">When help is needed<input required maxLength={500} value={draft.escalation} onChange={e=>setDraft({...draft,escalation:e.target.value})}/></label>
        <p>Changes apply only after saving and cancel pending approvals. Draft-only policies cannot approve execution. Account, resources and supplier spending limit stay unchanged.</p>
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={()=>setDraft(null)}>Cancel policy edit</button>
          <button className="button primary" type="submit">{busy?'Saving changes…':'Save policy changes'}</button></div>
      </fieldset>
    </form>}
  </section>;
}
