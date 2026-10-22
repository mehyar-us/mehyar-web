/** Crew 7e — Video studio frontend.
 * Wizard: pick type -> AI-drafted script (editable) -> approve -> storyboard
 * (editable shot list) -> approve -> queued status view -> delivered video
 * player. Honest statuses throughout: the studio reports exactly what the
 * job record says; there is no "ready" state until the runner delivers a
 * finished video URL. Mounted by the integrator via mountVideoStudio(). */
type Hooks={api:(path:string,body?:unknown)=>Promise<any>;tenant:()=>string};
type VideoJobType='service_promo_15s'|'offer_announcement_30s';
type Shot={n:number;duration_s:number;scene:string;onscreen_text:string};
type Job={
 id:string;type:VideoJobType;status:string;businessName:string|null;vertical:string;
 script:string|null;scriptApproved:{by:string;at:string}|null;
 storyboard:Shot[]|null;storyboardApproved:{by:string;at:string}|null;
 voiceoverText:string|null;captionText:string|null;
 brand:{name?:string;primaryColor?:string;secondaryColor?:string;backgroundColor?:string}|null;
 resultAssetUrl:string|null;failureReason:string|null;canceled:boolean;
 createdAt:string;updatedAt:string;
};

const TYPES:{id:VideoJobType;title:string;blurb:string}[]=[
 {id:'service_promo_15s',title:'Service promo — 15s',blurb:'A short spot: who you are, what you do, and how to book.'},
 {id:'offer_announcement_30s',title:'Offer announcement — 30s',blurb:'A 30-second spot built around one offer or special.'},
];
const STATUS_COPY:Record<string,string>={
 draft:'Draft — nothing has been approved yet.',
 script_pending:'Script drafted — waiting for your approval.',
 script_approved:'Script approved — now draft the storyboard.',
 storyboard_pending:'Storyboard drafted — waiting for your approval.',
 storyboard_approved:'Storyboard approved.',
 queued:'In the render queue — the studio will generate your video next.',
 generating:'Generating your video — this usually takes a few minutes. Keep this page open.',
 ready:'Your video is ready.',
 failed:'This video could not be generated.',
};

const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='')=>{const el=document.createElement(tag);el.textContent=text;el.className=className;return el;};
const button=(label:string,action:()=>void,className='secondary')=>{const el=node('button',label,className);el.type='button';el.onclick=action;return el;};

export function mountVideoStudio(root:HTMLElement,hooks:Hooks){
 const base=()=>`/api/businesses/${hooks.tenant()}/videos`;
 const element=node('section','','video-studio');element.setAttribute('aria-label','Video studio');
 let version=0;
 let statusTimer:number|undefined;

 function clear(){version++;if(statusTimer){window.clearInterval(statusTimer);statusTimer=undefined;}element.replaceChildren();}
 function failure(error:unknown){const s=element.querySelector<HTMLElement>('.video-status');if(s){s.textContent=error instanceof Error?error.message:'This could not finish. Try again.';s.setAttribute('role','alert');}}
 async function call(path:string,body?:unknown):Promise<Job>{
  const result=await hooks.api(path,body) as {job:Job};
  return result.job;
 }
 function statusLine(job:Job){
  const s=node('p','','video-status');s.setAttribute('role','status');
  const copy=STATUS_COPY[job.status]??job.status;
  s.textContent=job.status==='failed'&&job.failureReason?`${copy} Reason: ${job.failureReason}`:copy;
  return s;
 }

 function renderTypePicker(){
  const captured=++version;element.replaceChildren();
  element.append(node('h2','Video studio'),node('p','Turn your services into a short, captioned promo video. You approve the script and the storyboard first — the video is only generated after both.','subtle'));
  const grid=node('div','','video-type-grid');
  for(const t of TYPES){
   const card=node('article','','video-type-card');
   card.append(node('h3',t.title),node('p',t.blurb));
   card.append(button('Start this video',()=>renderJobForm(t.id),'primary'));
   grid.append(card);
  }
  element.append(grid);
  element.append(node('details','','video-scope'));
  const details=element.lastElementChild as HTMLElement;
  const summary=node('summary','What the studio makes');
  const copy=node('p','One 15-second service promo or one 30-second offer announcement, with burned-in captions and your brand colors. Generation is handled by our own media pipeline — this page only ever shows the real status of your job.','subtle');
  details.append(summary,copy);
 }

 function renderJobForm(type:VideoJobType){
  const captured=++version;element.replaceChildren();
  element.append(node('h2','New video'),node('p','Tell us about the video. Everything here is editable later — the draft is just a starting point.','subtle'));
  const form=node('form','','video-form');
  const name=node('input') as HTMLInputElement;name.maxLength=160;name.placeholder='Business name';
  const vertical=node('select') as HTMLSelectElement;
  for(const v of [['salon','Hair salon / Barbershop'],['restaurant','Restaurant'],['plumbing_hvac','Plumbing / HVAC'],['dental','Dental office'],['auto_repair','Auto repair'],['other','Other local business']] as const)vertical.append(new Option(v[1],v[0]));
  const services=node('input') as HTMLInputElement;services.maxLength=600;services.placeholder='Services to mention (e.g. cuts, color, styling)';
  const offer=node('input') as HTMLInputElement;offer.maxLength=300;offer.placeholder='Offer line — for the 30s video (e.g. Tuesday 2-for-1 pies)';
  const primary=node('input') as HTMLInputElement;primary.type='color';primary.value='#0f172a';
  const secondary=node('input') as HTMLInputElement;secondary.type='color';secondary.value='#f8fafc';
  const bg=node('input') as HTMLInputElement;bg.type='color';bg.value='#000000';
  const field=(label:string,input:HTMLElement)=>{const l=node('label','','form-field');l.append(node('span',label),input);form.append(l);};
  field('Business name',name);field('Business type',vertical);field('Services to mention',services);field('Offer line (30s video)',offer);
  field('Caption color',primary);field('Caption text color',secondary);field('Caption background',bg);
  const actions=node('div','','video-actions');
  actions.append(button('Back',renderTypePicker));
  const go=button('Draft the script',()=>{},'primary');go.type='submit';actions.append(go);
  form.append(actions);
  form.onsubmit=event=>{
   event.preventDefault();
   if(captured!==version)return;
   go.disabled=true;
   void (async()=>{
    try{
     const job=await call(base(),{
      type,
      ...(name.value.trim()?{businessName:name.value.trim()}:{}),
      vertical:vertical.value,
      ...(services.value.trim()?{services:services.value.trim()}:{}),
      ...(offer.value.trim()?{offer:offer.value.trim()}:{}),
      brand:{primaryColor:primary.value,secondaryColor:secondary.value,backgroundColor:bg.value},
     });
     const drafted=await call(`${base()}/${job.id}/script/draft`,{});
     if(captured!==version)return;
     renderScriptStep(drafted);
    }catch(error){if(captured===version){failure(error);go.disabled=false;}}
   })();
  };
  element.append(form);
 }

 function renderScriptStep(job:Job){
  const captured=++version;element.replaceChildren();
  element.append(node('h2','Approve the script'),statusLine(job));
  element.append(node('p','This is the starting draft, written in your trade’s voice. Edit it freely — but keep claims honest: no fake reviews, no guarantees.','subtle'));
  const area=node('textarea','','video-script') as HTMLTextAreaElement;
  area.value=job.script??'';area.rows=8;
  area.setAttribute('aria-label','Video script');
  element.append(area);
  const actions=node('div','','video-actions');
  actions.append(button('Back to job list',renderJobList));
  const redraft=button('Re-draft',()=>{redraft.disabled=true;void (async()=>{try{const j=await call(`${base()}/${job.id}/script/draft`,{});if(captured!==version)return;renderScriptStep(j);}catch(e){if(captured===version){failure(e);redraft.disabled=false;}}})();});
  const approve=button('Approve script',()=>{},'primary');
  approve.onclick=()=>{approve.disabled=true;void (async()=>{try{const j=await call(`${base()}/${job.id}/script/approve`,{script:area.value});if(captured!==version)return;const sb=await call(`${base()}/${job.id}/storyboard/draft`,{});if(captured!==version)return;renderStoryboardStep(sb);}catch(e){if(captured===version){failure(e);approve.disabled=false;}}})();};
  actions.append(redraft,approve);
  element.append(actions);
 }

 function renderStoryboardStep(job:Job){
  const captured=++version;element.replaceChildren();
  element.append(node('h2','Approve the storyboard'),statusLine(job));
  element.append(node('p','One row per shot. Durations must add up to the video length. On-screen text becomes the burned-in captions.','subtle'));
  const list=node('div','','video-shots');
  const shots=(job.storyboard??[]).map(s=>({...s}));
  function shotEditor(shot:Shot,idx:number){
   const card=node('div','','video-shot');
   card.append(node('h4',`Shot ${shot.n}`));
   const dur=node('input') as HTMLInputElement;dur.type='number';dur.min='1';dur.max='30';dur.step='0.5';dur.value=String(shot.duration_s);dur.setAttribute('aria-label',`Shot ${shot.n} duration in seconds`);
   const scene=node('textarea') as HTMLTextAreaElement;scene.rows=2;scene.value=shot.scene;scene.setAttribute('aria-label',`Shot ${shot.n} scene`);
   const text=node('input') as HTMLInputElement;text.maxLength=220;text.value=shot.onscreen_text;text.setAttribute('aria-label',`Shot ${shot.n} on-screen text`);
   const field=(label:string,input:HTMLElement)=>{const l=node('label','','form-field');l.append(node('span',label),input);card.append(l);};
   field('Duration (s)',dur);field('Scene',scene);field('On-screen text',text);
   card.dataset.idx=String(idx);
   return card;
  }
  for(const [i,s] of shots.entries())list.append(shotEditor(s,i));
  element.append(list);
  const actions=node('div','','video-actions');
  actions.append(button('Back to job list',renderJobList));
  const approve=button('Approve storyboard & queue',()=>{},'primary');
  approve.onclick=()=>{
   const payload:Shot[]=[];
   for(const card of Array.from(list.querySelectorAll<HTMLElement>('.video-shot'))){
    const idx=Number(card.dataset.idx);
    const dur=card.querySelector<HTMLInputElement>('input[type="number"]')!;
    const scene=card.querySelector<HTMLTextAreaElement>('textarea')!;
    const inputs=card.querySelectorAll<HTMLInputElement>('input[type="text"]');
    const textInput=inputs[inputs.length-1];
    payload.push({n:shots[idx].n,duration_s:Number(dur.value),scene:scene.value,onscreen_text:textInput.value});
   }
   approve.disabled=true;
   void (async()=>{try{const j=await call(`${base()}/${job.id}/storyboard/approve`,{shots:payload});if(captured!==version)return;renderQueued(j);}catch(e){if(captured===version){failure(e);approve.disabled=false;}}})();
  };
  actions.append(approve);
  element.append(actions);
 }

 function renderQueued(job:Job){
  const captured=++version;element.replaceChildren();
  element.append(node('h2','Your video is in the queue'),statusLine(job));
  element.append(node('p','Both the script and the storyboard are approved. The studio generates the video from them — captions and brand colors are baked in. Check back here; this page updates itself.','subtle'));
  element.append(button('Back to job list',renderJobList));
  pollUntilReady(job.id,captured);
 }

 function renderReady(job:Job){
  const captured=++version;element.replaceChildren();
  element.append(node('h2','Your video is ready'),statusLine(job));
  if(job.resultAssetUrl){
   const video=node('video','','video-player') as HTMLVideoElement;
   video.controls=true;video.preload='metadata';video.src=job.resultAssetUrl;
   video.setAttribute('aria-label','Your generated promo video');
   element.append(video);
   const link=node('a','Download video','') as HTMLAnchorElement;
   link.href=job.resultAssetUrl;link.download='promo-video.mp4';link.target='_blank';link.rel='noopener';
   element.append(link);
  }else{
   // The record says ready but the asset is missing: say so, never fake it.
   element.append(node('p','The job is marked ready but the video file is not available yet. Refresh in a minute — if it persists, the studio will re-render it.','video-status'));
  }
  element.append(button('Make another video',renderTypePicker,'primary'),button('Back to job list',renderJobList));
 }

 function pollUntilReady(id:string,captured:number){
  if(statusTimer){window.clearInterval(statusTimer);statusTimer=undefined;}
  statusTimer=window.setInterval(()=>{
   void (async()=>{
    try{
     const job=await call(`${base()}/${id}`);
     if(captured!==version)return;
     if(job.status==='ready'){if(statusTimer){window.clearInterval(statusTimer);statusTimer=undefined;}renderReady(job);}
     else if(job.status==='failed'){if(statusTimer){window.clearInterval(statusTimer);statusTimer=undefined;}renderFailed(job);}
     else{
      const s=element.querySelector<HTMLElement>('.video-status');
      if(s)s.textContent=STATUS_COPY[job.status]??job.status;
     }
    }catch(error){if(captured===version)failure(error);}
   })();
  },10000);
 }

 function renderFailed(job:Job){
  const captured=++version;element.replaceChildren();
  element.append(node('h2','This video could not be generated'),statusLine(job));
  element.append(node('p','Nothing was charged and nothing was posted. Your approved script and storyboard are saved — you can re-queue the job or start over.','subtle'));
  const actions=node('div','','video-actions');
  const retry=button('Re-queue from storyboard',()=>{},'primary');
  retry.onclick=()=>{retry.disabled=true;void (async()=>{try{const j=await call(`${base()}/${job.id}/storyboard/draft`,{});if(captured!==version)return;renderStoryboardStep(j);}catch(e){if(captured===version){failure(e);retry.disabled=false;}}})();};
  actions.append(retry,button('Back to job list',renderJobList));
  element.append(actions);
 }

 async function renderJobList(){
  const captured=++version;element.replaceChildren();
  element.append(node('h2','Your videos'));
  element.append(node('p','Loading…','video-status'));
  try{
   const {jobs}=await hooks.api(base()) as {jobs:Job[]};
   if(captured!==version)return;
   element.replaceChildren(node('h2','Your videos'));
   const actions=node('div','','video-actions');
   actions.append(button('New video',renderTypePicker,'primary'));
   element.append(actions);
   if(!jobs.length){element.append(node('p','No videos yet. Start one above.','subtle'));return;}
   const list=node('ul','','video-list');
   for(const job of jobs){
    const item=node('li','','video-list-item');
    const title=job.type==='service_promo_15s'?'Service promo — 15s':'Offer announcement — 30s';
    item.append(node('strong',`${title} · ${job.businessName??'Untitled'}`));
    item.append(node('span',STATUS_COPY[job.status]??job.status,'subtle'));
    const open=button(job.status==='ready'?'Watch':'Continue',()=>{
     if(job.status==='ready')renderReady(job);
     else if(job.status==='queued'||job.status==='generating')renderQueued(job);
     else if(job.status==='failed')renderFailed(job);
     else if(job.status==='script_pending')renderScriptStep(job);
     else if(job.status==='storyboard_pending')renderStoryboardStep(job);
     else if(job.status==='draft')renderScriptStep(job);
     else if(job.status==='script_approved'){void (async()=>{const j=await call(`${base()}/${job.id}/storyboard/draft`,{});if(captured===version)renderStoryboardStep(j);})();}
     else if(job.status==='storyboard_approved'){void (async()=>{const j=await call(`${base()}/${job.id}`);if(captured===version)renderStoryboardStep(j);})();}
    });
    item.append(open);
    list.append(item);
   }
   element.append(list);
  }catch(error){if(captured===version)failure(error);}
 }

 return {
  element,
  open(){clear();renderTypePicker();},
  openJobList(){clear();void renderJobList();},
  clear,
 };
}
