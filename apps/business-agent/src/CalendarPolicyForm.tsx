import {useEffect,useRef,useState,type FormEvent} from 'react';
import {api,ApiError,post,type Grant} from './api';

type Calendar={id:string;name:string;canWrite:boolean;timeZone?:string};
export default function CalendarPolicyForm({tenantId,grants,online,paused,onUnauthorized}:{
  tenantId:string;grants:Grant[];online:boolean;paused:boolean;onUnauthorized:(error:unknown)=>void;
}) {
  const eligible=grants.filter(g=>g.tenantId===tenantId&&g.status==='authorized'&&['google','microsoft'].includes(g.provider)&&g.grantedCapabilities.includes('calendar_manage'));
  const [grantId,setGrantId]=useState(''),[calendarId,setCalendarId]=useState('');
  const [calendars,setCalendars]=useState<Calendar[]>([]),[ready,setReady]=useState(false),[loading,setLoading]=useState(false);
  const [name,setName]=useState('Appointments'),[recipients,setRecipients]=useState(''),[limit,setLimit]=useState('10');
  const [days,setDays]=useState('30'),[mode,setMode]=useState('approve'),[escalation,setEscalation]=useState('Ask the owner');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[saving,setSaving]=useState(false);
  const mounted=useRef(true),busy=useRef(false),attempt=useRef<{fingerprint:string;body:Record<string,unknown>}|null>(null);
  const grant=eligible.find(g=>g.id===grantId);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    const controller=new AbortController();setCalendars([]);setCalendarId('');setReady(false);setLoading(false);setError('');
    if(!grant||!online||paused)return()=>controller.abort();
    setLoading(true);
    void api<{calendars:Calendar[];incomplete:boolean}>(`/api/tenants/${encodeURIComponent(tenantId)}/connections/${encodeURIComponent(grant.id)}/calendars?provider=${grant.provider}`,{signal:controller.signal})
      .then(result=>{
        if(controller.signal.aborted)return;
        if(!Array.isArray(result.calendars)||typeof result.incomplete!=='boolean')throw new Error('Calendar choices could not be verified.');
        setCalendars(result.calendars);setReady(!result.incomplete);
        if(result.incomplete)setError('The calendar list is incomplete. A complete list is required before saving this policy.');
      }).catch(cause=>{if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'Could not load calendars.');if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);}})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[tenantId,grant?.id,grant?.provider,online,paused,onUnauthorized]);
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(busy.current||!online||paused||!grant||!ready||!calendars.some(c=>c.id===calendarId&&c.canWrite))return;
    const allowed=[...new Set(recipients.split(/[\n,;]/).map(s=>s.trim().toLowerCase()).filter(Boolean))];
    if(!allowed.length||allowed.length>100||allowed.some(s=>!/^\S+@\S+\.\S+$/.test(s))) {setError('Enter between one and 100 valid attendee email addresses.');return;}
    const config={name:name.trim(),trigger:'Owner-requested appointment',operation:'calendar.create',provider:grant.provider,grantId,
      mode,resources:[calendarId],recipients:allowed,maxActionsPerDay:Number(limit),maxCostMicrosPerDay:0,escalation:escalation.trim(),enabled:true};
    const fingerprint=JSON.stringify([config,days]);
    if(attempt.current?.fingerprint!==fingerprint)attempt.current={fingerprint,body:{...config,id:crypto.randomUUID(),expectedVersion:0,
      startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+Number(days)*86400000).toISOString()}};
    const body=attempt.current.body;
    busy.current=true;setSaving(true);setError('');setNotice('');
    try {
      const result=await post<{policy:{id:string;version:number}}>(`/api/tenants/${encodeURIComponent(tenantId)}/action-policies`,body);
      if(result.policy.id!==body.id||result.policy.version!==1)throw new Error('The saved policy could not be verified. Retry to check the same request.');
      if(mounted.current){setNotice('Appointment policy saved. Each appointment still requires its own review. No booking was made.');}
    }catch(cause){if(mounted.current){setError(cause instanceof Error?cause.message:'Could not save this policy.');if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);}}
    finally{busy.current=false;if(mounted.current)setSaving(false);}
  }
  return <section className="panel calendar-policy" aria-label="Appointment policy setup">
    <h2>Set up appointment permissions</h2><p>Choose one writable calendar, allowed attendees, and a daily limit. This creates permission rules for future proposals.</p>
    {!eligible.length?<p>Connect an account with calendar management access in Connections first.</p>:<form onSubmit={event=>void save(event)}>
      <fieldset disabled={saving||!online||paused} style={{border:0,padding:0,minWidth:0}}>
        <label className="field">Connected account<select value={grantId} onChange={event=>setGrantId(event.target.value)} required>
          <option value="">Choose an account</option>{eligible.map((g,i)=><option key={g.id} value={g.id}>{g.provider==='google'?'Google':'Microsoft'} authorization {i+1}</option>)}
        </select></label>
        {loading&&<p role="status">Loading calendars…</p>}
        <label className="field">Appointment calendar<select value={calendarId} onChange={event=>setCalendarId(event.target.value)} required disabled={!ready}>
          <option value="">Choose a calendar</option>{calendars.map(c=><option key={c.id} value={c.id} disabled={!c.canWrite}>{c.name}{c.canWrite?'':' (read only)'}</option>)}
        </select></label>
        {ready&&!calendars.some(c=>c.canWrite)&&<p>No writable calendars were found.</p>}
        <label className="field">Policy name<input value={name} onChange={e=>setName(e.target.value)} required maxLength={100}/></label>
        <label className="field">Allowed attendee emails<textarea value={recipients} onChange={e=>setRecipients(e.target.value)} required placeholder="One email per line"/></label>
        <label className="field">Review mode<select value={mode} onChange={e=>setMode(e.target.value)}><option value="approve">Require approval for each appointment</option><option value="preview">Draft appointments only</option></select></label>
        <label className="field">Maximum appointments per day<input type="number" min={1} max={1000} step={1} required value={limit} onChange={e=>setLimit(e.target.value)}/></label>
        <label className="field">Permission expires in days<input type="number" min={1} max={365} step={1} required value={days} onChange={e=>setDays(e.target.value)}/></label>
        <label className="field">When help is needed<input required maxLength={500} value={escalation} onChange={e=>setEscalation(e.target.value)}/></label>
        <button className="button primary" disabled={!ready||!calendarId||!!notice} type="submit">{saving?'Saving policy…':'Save appointment policy'}</button>
      </fieldset>
    </form>}
    {paused&&<p>Resume your agent to configure appointment permissions.</p>}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </section>;
}
