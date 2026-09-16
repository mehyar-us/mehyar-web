import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
type Invitation={id:string;role:string;expiresAt:string;businessName:string};
export default function InvitationInbox({online,onAccepted}:{online:boolean;onAccepted:(tenantId:string)=>Promise<void>}){
  const [items,setItems]=useState<Invitation[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[more,setMore]=useState(false),[cursor,setCursor]=useState<string|null>(null);
  const request=useRef<AbortController|null>(null);
  const refresh=useCallback(async(after?:string)=>{
    request.current?.abort();setError('');if(!after){setItems([]);setMore(false);setCursor(null);}if(!online)return;
    const controller=new AbortController();request.current=controller;setBusy(true);
    try{
      const result=await api<{invitations:Invitation[];more:boolean;nextCursor?:string|null}>(`/api/invitations${after?`?cursor=${encodeURIComponent(after)}`:''}`,{signal:controller.signal});
      if(!Array.isArray(result.invitations)||result.invitations.length>50||result.nextCursor&&(!/^[a-f0-9]{64}$/.test(result.nextCursor)||result.nextCursor===after||!result.invitations.length))throw new Error('Invitations could not be read.');
      if(!controller.signal.aborted){setItems(previous=>after?[...previous,...result.invitations.filter(invitation=>!previous.some(old=>old.id===invitation.id))]:result.invitations);setMore(result.more);setCursor(result.nextCursor??null);}
    }
    catch(cause){if(!controller.signal.aborted){setItems([]);setMore(false);setCursor(null);setError(cause instanceof Error?cause.message:'Invitations are unavailable.');}}
    finally{if(!controller.signal.aborted)setBusy(false);}
  },[online]);
  useEffect(()=>{void refresh();return()=>request.current?.abort();},[refresh]);
  async function accept(id:string){
    if(busy||!online)return;setBusy(true);setError('');const controller=new AbortController();request.current=controller;
    try{const result=await api<{tenantId:string}>('/api/invitations/accept',{method:'POST',body:JSON.stringify({id}),signal:controller.signal});if(controller.signal.aborted)return;await onAccepted(result.tenantId);if(!controller.signal.aborted)await refresh();}
    catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Acceptance could not be confirmed. Retry the same invitation.');}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  return <section className="panel" aria-label="Your invitations"><div className="panel-heading"><h2>Your invitations</h2><button className="button secondary" disabled={!online||busy} onClick={()=>void refresh()}>Refresh invitations</button></div>
    {!online?<p>Reconnect to view invitations.</p>:<>{error&&<p role="alert">{error}</p>}{busy&&<p role="status">Loading invitations…</p>}{!busy&&!error&&!items.length&&<p>No pending invitations for your signed-in email.</p>}
    <ul>{items.map(invitation=><li key={invitation.id}><strong>{invitation.businessName}</strong><p>Join as {invitation.role}. Expires {new Date(invitation.expiresAt).toLocaleString()}.</p><button className="button primary" disabled={busy} onClick={()=>void accept(invitation.id)}>Accept invitation to {invitation.businessName}</button></li>)}</ul>{cursor?<button className="button secondary" disabled={busy} onClick={()=>void refresh(cursor)}>Load older invitations</button>:more&&<p>Refresh invitations to load older entries.</p>}</>}
  </section>;
}
