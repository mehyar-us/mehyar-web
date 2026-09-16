import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
import MemberRoleForm from './MemberRoleForm';
import InvitationEmail from './InvitationEmail';
type Invitation={id:string;email:string;role:string;status:string;expiresAt:string;emailDelivery?:{state:string;checkedAt?:string|null}};
type Member={id:string;name:string|null;email:string|null;role:string;status:string;expiresAt:string|null;revision:number};
type Directory={members:Member[];invitations:Invitation[];seatLimit:number;emailQueueEnabled?:boolean;moreMembers:boolean;moreInvitations:boolean;nextMembersCursor?:string|null;nextInvitationsCursor?:string|null};
type Draft={email:string;role:string;key:string};
export default function TeamPanel({tenantId,online}:{tenantId:string;online:boolean}){
  const [data,setData]=useState<Directory|null>(null),[email,setEmail]=useState(''),[role,setRole]=useState('staff'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState<Draft|null>(null),[removal,setRemoval]=useState<(Member & {key:string})|null>(null);
  const live=useRef(true),operation=useRef<AbortController|null>(null);
  const base=`/api/tenants/${encodeURIComponent(tenantId)}/team`;
  const refresh=useCallback(async()=>{
    if(!online)return;operation.current?.abort();const controller=new AbortController();operation.current=controller;setBusy(true);setError('');setData(null);setRemoval(null);
    try{const result=await api<Directory>(base,{signal:controller.signal});if(!Array.isArray(result.members)||!Array.isArray(result.invitations)||!Number.isSafeInteger(result.seatLimit))throw new Error('The team list could not be read.');if(!controller.signal.aborted)setData(result);}
    catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'The team list is unavailable.');}
    finally{if(!controller.signal.aborted)setBusy(false);}
  },[base,online]);
  useEffect(()=>{live.current=true;setData(null);void refresh();return()=>{live.current=false;operation.current?.abort();};},[refresh]);
  async function loadMore(kind:'members'|'invitations'){
    const cursor=kind==='members'?data?.nextMembersCursor:data?.nextInvitationsCursor;if(!cursor||!online||busy)return;
    const controller=new AbortController();operation.current=controller;setBusy(true);setError('');
    try{
      const result=await api<Directory>(`${base}?${kind}Cursor=${encodeURIComponent(cursor)}`,{signal:controller.signal});
      const items=result[kind],next=kind==='members'?result.nextMembersCursor:result.nextInvitationsCursor;
      if(!Array.isArray(items)||items.length>(kind==='members'?100:50)||next!==null&&next!==undefined&&(typeof next!=='string'||!next.length||next===cursor||!items.length))throw new Error('The next team page could not be read. Refresh the team list.');
      if(controller.signal.aborted)return;
      setData(previous=>!previous?null:kind==='members'?{...previous,members:[...previous.members,...result.members.filter(item=>!previous.members.some(old=>old.id===item.id))],moreMembers:result.moreMembers,nextMembersCursor:result.nextMembersCursor}:{...previous,invitations:[...previous.invitations,...result.invitations.filter(item=>!previous.invitations.some(old=>old.id===item.id))],moreInvitations:result.moreInvitations,nextInvitationsCursor:result.nextInvitationsCursor});
    }catch(cause){if(!controller.signal.aborted){setData(null);setRemoval(null);setError(cause instanceof Error?cause.message:'The team list is unavailable.');}}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  async function mutate(path:string,body:unknown,key?:string){
    if(!online||busy)return false;setBusy(true);setError('');const controller=new AbortController();operation.current=controller;
    try{await api(`${base}/${path}`,{method:'POST',body:JSON.stringify(body),headers:key?{'x-idempotency-key':key}:undefined,signal:controller.signal});return !controller.signal.aborted;}
    catch(cause){if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'The team change could not be confirmed.');if(cause instanceof ApiError&&[401,403,404].includes(cause.status)){setData(null);setRemoval(null);}if(cause instanceof ApiError&&['membership_changed','request_key_conflict','invalid_input'].includes(cause.code))setRemoval(null);if(cause instanceof ApiError&&['invalid_input','invitation_unavailable','request_key_conflict'].includes(cause.code))setPending(null);}return false;}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  async function invite(){
    const draft=pending??{email:email.trim(),role,key:crypto.randomUUID()};setPending(draft);
    if(await mutate('invitations',{email:draft.email,role:draft.role},draft.key)&&live.current){setPending(null);setEmail('');await refresh();}
  }
  return <section className="panel" aria-label="Manage team">
    <div className="panel-heading"><h2>Members and invitations</h2><button className="button secondary" disabled={!online||busy} onClick={()=>void refresh()}>Refresh team</button></div>
    {!online?<p>Reconnect to manage your team.</p>:<>
      {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Updating team…</p>}
      {data&&<>
        <p>Your current plan allows {data.seatLimit} {data.seatLimit===1?'seat':'seats'}, including the owner. An invitation uses a seat when it is accepted.</p>
        <ul>{data.members.map(member=><li key={member.id}><strong>{member.name||member.email||'Workspace member'}</strong>{member.email&&<span> — {member.email}</span>}<p>{member.role} · {member.status}{member.expiresAt?` · expires ${new Date(member.expiresAt).toLocaleString()}`:''}</p>{member.role!=='owner'&&member.status==='active'&&<button className="button secondary" disabled={busy} onClick={()=>setRemoval({...member,key:crypto.randomUUID()})}>Remove access for {member.name||member.email||'member'}</button>}{['manager','staff','billing','viewer'].includes(member.role)&&member.status==='active'&&Number.isSafeInteger(member.revision)&&<MemberRoleForm key={`${member.id}:${member.revision}`} tenantId={tenantId} member={member} disabled={busy||!online} onSaved={refresh}/>}</li>)}</ul>
        {data.nextMembersCursor?<button className="button secondary" disabled={busy} onClick={()=>void loadMore('members')}>Load more members</button>:data.moreMembers&&<p>Refresh the team list to load more members.</p>}
        {removal&&<div role="group" aria-label="Confirm member removal"><p>Remove {removal.email||removal.name||'this member'} from this business? Their access to other businesses will stay unchanged.</p><button className="button primary" disabled={busy} onClick={()=>void(async()=>{if(await mutate('revoke-member',{userId:removal.id,expectedRevision:removal.revision},removal.key)&&live.current){setRemoval(null);await refresh();}})()}>Confirm removal</button><button className="button secondary" disabled={busy} onClick={()=>setRemoval(null)}>Close review</button></div>}
        <form onSubmit={event=>{event.preventDefault();void invite();}}>
          <h3>Invite a teammate</h3><p>{data.emailQueueEnabled?'Creating an invitation does not send email. Use its Queue email invitation button to request delivery.':'Email delivery is not enabled. Ask the teammate to sign in to this app with the exact invited email, then accept their invitation.'}</p>
          <label>Email address<input type="email" required maxLength={254} value={email} disabled={busy||!!pending} onChange={event=>setEmail(event.target.value)}/></label>
          <label>Team role<select value={role} disabled={busy||!!pending} onChange={event=>setRole(event.target.value)}><option value="staff">Staff</option><option value="manager">Manager</option><option value="billing">Billing</option><option value="viewer">Viewer</option></select></label>
          <p className="small muted">Managers manage knowledge and connections. Staff can chat and view knowledge. Billing users manage payments. Viewers read knowledge. Only owners manage this team and approve action policies.</p>
          <button className="button primary" disabled={busy||data.seatLimit<=1}>{pending?'Retry invitation':'Create invitation'}</button>
          {data.seatLimit<=1&&<p>Team acceptance requires a plan with available team seats.</p>}
        </form>
        <h3>Invitations</h3>{!data.invitations.length?<p>No invitations yet.</p>:<ul>{data.invitations.map(invitation=><li key={invitation.id}><strong>{invitation.email}</strong><p>{invitation.role} · {invitation.status} · expires {new Date(invitation.expiresAt).toLocaleString()}</p><InvitationEmail email={invitation.email} delivery={invitation.emailDelivery} enabled={data.emailQueueEnabled===true} pending={invitation.status==='pending'} disabled={busy||!online} onQueue={()=>void(async()=>{if(await mutate(`invitations/${invitation.id}/email`,{})&&live.current)await refresh();})()}/>{invitation.status==='pending'&&<button className="button secondary" disabled={busy} onClick={()=>void(async()=>{if(await mutate(`invitations/${invitation.id}/revoke`,{})&&live.current)await refresh();})()}>Revoke invitation for {invitation.email}</button>}</li>)}</ul>}
        {data.nextInvitationsCursor?<button className="button secondary" disabled={busy} onClick={()=>void loadMore('invitations')}>Load older invitations</button>:data.moreInvitations&&<p>Refresh the team list to load older invitations.</p>}
      </>}
    </>}
  </section>;
}
