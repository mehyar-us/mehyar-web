import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
type Request={userId:string;role:string;expectedRevision:number;key:string};
export default function MemberRoleForm({tenantId,member,disabled,onSaved}:{tenantId:string;member:{id:string;role:string;revision:number;name:string|null;email:string|null};disabled:boolean;onSaved:()=>Promise<void>}){
  const [role,setRole]=useState(member.role),[pending,setPending]=useState<Request|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  async function save(){
    if(disabled||busy||conflict)return;
    const data=pending??{userId:member.id,role,expectedRevision:member.revision,key:crypto.randomUUID()};setPending(data);setBusy(true);setError('');
    const controller=new AbortController();request.current=controller;
    try{await api(`/api/tenants/${encodeURIComponent(tenantId)}/team/role`,{method:'POST',body:JSON.stringify({userId:data.userId,role:data.role,expectedRevision:data.expectedRevision}),headers:{'x-idempotency-key':data.key},signal:controller.signal});if(!controller.signal.aborted)await onSaved();}
    catch(cause){if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'The role change could not be confirmed.');if(cause instanceof ApiError&&[400,401,403,404,409].includes(cause.status))setConflict(true);}}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  const name=member.name||member.email||'member';
  return <form aria-label={`Change role for ${name}`} onSubmit={event=>{event.preventDefault();void save();}}>
    <label>Role for {name}<select value={role} disabled={disabled||busy||!!pending||conflict} onChange={event=>setRole(event.target.value)}><option value="manager">Manager</option><option value="staff">Staff</option><option value="billing">Billing</option><option value="viewer">Viewer</option></select></label>
    {role!==member.role&&<p>Change this member from {member.role} to {role}? Their permissions in this business will change.</p>}
    {error&&<p role="alert">{error}</p>}{conflict&&<p>Refresh the team list to review the current membership before making another change.</p>}
    <button className="button secondary" disabled={disabled||busy||conflict||!pending&&role===member.role} type="submit">{busy?'Saving role…':pending?'Retry role change':'Confirm role change'}</button>
  </form>;
}
