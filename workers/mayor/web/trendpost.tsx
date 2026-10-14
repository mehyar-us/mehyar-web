import {useCallback,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './trendpost.css';

/** Trendpost panel (2026-10-14): the weekly posting plan inside The Mayor.
 * Review-gated like every Mayor action — Approve / Edit / Skip per post,
 * nothing publishes from here. Approved posts are ready to post (copy
 * button) until a live channel connection dispatches them. */

interface Post{id:string;dayLabel:string;slot:string;kind:string;kindLabel:string;angle:string;draft:string;state:'pending'|'edited'|'approved'|'skipped'}
interface Plan{id:string;weekStart:string;summary:string;source:string;posts:Post[]}
interface Access{planId:string;included:boolean;sampleAvailable:boolean;canGenerate:boolean}

function api(tenantId:string,path:string,init?:RequestInit){
 return fetch(`/api/businesses/${tenantId}/trendpost${path}`,{headers:{'content-type':'application/json'},...init}).then(async r=>{
  if(!r.ok)throw new Error((await r.json().catch(()=>({})))?.message??`Request failed (${r.status})`);
  return r.json();});
}

function PostCard({post,busy,onDecide}:{post:Post;busy:boolean;onDecide:(post:Post,action:'approve'|'skip'|'edit',draft?:string)=>void}){
 const [editing,setEditing]=useState(false);
 const [draft,setDraft]=useState(post.draft);
 const [copied,setCopied]=useState(false);
 useEffect(()=>{setDraft(post.draft);},[post.draft]);
 const decided=post.state==='approved'||post.state==='skipped';
 return <article className={`tp-post tp-${post.state}`}>
  <header className="tp-post-head">
   <strong>{post.slot}</strong>
   <span className="tp-kind">{post.kindLabel}</span>
   {post.state==='edited'&&<span className="tp-edited">edited</span>}
  </header>
  <p className="tp-angle">{post.angle}</p>
  {editing
   ?<><textarea className="tp-edit" value={draft} maxLength={500} rows={4} onChange={e=>setDraft(e.target.value)} aria-label="Edit this post"/>
     <div className="tp-actions">
      <button type="button" className="tp-btn tp-primary" disabled={busy||!draft.trim()} onClick={()=>{onDecide(post,'edit',draft.trim());setEditing(false);}}>Save draft</button>
      <button type="button" className="tp-btn" disabled={busy} onClick={()=>{setDraft(post.draft);setEditing(false);}}>Cancel</button>
     </div></>
   :<p className="tp-draft">{post.draft}</p>}
  {!editing&&!decided&&<div className="tp-actions">
   <button type="button" className="tp-btn tp-primary" disabled={busy} onClick={()=>onDecide(post,'approve')}>Approve</button>
   <button type="button" className="tp-btn" disabled={busy} onClick={()=>setEditing(true)}>Edit</button>
   <button type="button" className="tp-btn tp-quiet" disabled={busy} onClick={()=>onDecide(post,'skip')}>Skip</button>
  </div>}
  {post.state==='approved'&&<div className="tp-actions">
   <span className="tp-ready">Approved — ready to post</span>
   <button type="button" className="tp-btn" onClick={async()=>{try{await navigator.clipboard.writeText(post.draft);setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{/* clipboard unavailable */}}}>{copied?'Copied':'Copy post'}</button>
  </div>}
  {post.state==='skipped'&&<p className="tp-skipped">Skipped</p>}
 </article>;
}

export function TrendpostPanel({tenantId}:{tenantId:string}){
 const [plan,setPlan]=useState<Plan|null>(null);
 const [access,setAccess]=useState<Access|null>(null);
 const [loading,setLoading]=useState(true);
 const [unavailable,setUnavailable]=useState(false);
 const [busyId,setBusyId]=useState<string|null>(null);
 const [error,setError]=useState<string|null>(null);

 const load=useCallback(async()=>{
  try{
   const data=await api(tenantId,'/plan');
   setPlan(data.plan??null);setAccess(data.access??null);
  }catch{setUnavailable(true);}
  setLoading(false);
 },[tenantId]);
 useEffect(()=>{void load();},[load]);

 const generate=async()=>{
  setBusyId('generate');setError(null);
  try{const data=await api(tenantId,'/generate',{method:'POST'});setPlan(data.plan);setAccess(data.access);}
  catch(e){setError(e instanceof Error?e.message:'Could not build the plan. Try again.');}
  setBusyId(null);
 };
 const decide=async(post:Post,action:'approve'|'skip'|'edit',draft?:string)=>{
  setBusyId(post.id);setError(null);
  try{
   const data=await api(tenantId,`/posts/${post.id}/${action}`,{method:'POST',body:action==='edit'?JSON.stringify({draft}):undefined});
   if(data.plan)setPlan(data.plan);
  }catch(e){setError(e instanceof Error?e.message:'That did not save. Try again.');}
  setBusyId(null);
 };

 if(loading||unavailable)return null;
 const showGateNote=access&&!access.included;
 return <section className="tp-panel" aria-labelledby="tp-heading">
  <div className="tp-head">
   <div>
    <h2 id="tp-heading">Posts this week</h2>
    {plan?<p className="tp-summary">{plan.summary}</p>
     :<p className="tp-summary">Tell The Mayor to plan your week of posts — angles, drafts in your voice, and the best time for each. You approve every post before anything goes out.</p>}
    {showGateNote&&!plan&&access.sampleAvailable&&<p className="tp-note">Free sample: your first weekly plan is on us.</p>}
    {showGateNote&&plan&&!access.canGenerate&&<p className="tp-note">That was your free sample plan — weekly plans are part of Pro. <a href="/billing">See Pro</a></p>}
   </div>
   {access?.canGenerate&&<button type="button" className="tp-btn tp-primary" disabled={busyId==='generate'} onClick={generate}>{plan?'Refresh this week\u2019s plan':'Plan my week'}</button>}
  </div>
  {error&&<p className="tp-error" role="alert">{error}</p>}
  {plan&&<div className="tp-grid">{plan.posts.map(p=><PostCard key={p.id} post={p} busy={busyId===p.id} onDecide={decide}/>)}</div>}
 </section>;
}

export function mountTrendpost(root:HTMLElement,tenantId:string){
 createRoot(root).render(<TrendpostPanel tenantId={tenantId}/>);
}
