import {describe,expect,it,vi,beforeEach} from 'vitest';

/* Crew 7e: video studio job lifecycle + claim/complete/fail handoff contract.
 * No real media calls anywhere: the D1 binding is an in-memory fake, and the
 * media pipeline is only ever reached by the agent-side runner, which is not
 * part of this module. */

vi.mock('../src/permissions',async()=>{
 const actual=await vi.importActual<typeof import('../src/permissions')>('../src/permissions');
 const {HttpError}=await import('../src/http');
 return {...actual,requireMembership:async(_env:any,actor:any,roles:readonly string[])=>{
  if(!roles.includes('owner')||actor.userId!=='owner-1')throw new HttpError(403,'forbidden','Not allowed.');
 }};
});

import {
 claimVideoJob,completeVideoJob,failVideoJob,
 draftScriptText,draftStoryboard,scriptCaptions,scriptVoiceover,
 findUnsupportedClaims,assertStoryboardFits,
 handleVideogenRequest,registerVideogenRoutes,
} from '../src/videogen';
import {HttpError} from '../src/http';

type Row=Record<string,any>;
/** In-memory fake for the exact video_jobs statements this module uses. */
function fakeD1(){
 const rows:Row[]=[];
 const cols=['id','tenant_id','type','vertical','offer','services','status','script','script_approved_by','script_approved_at','storyboard_json','storyboard_approved_by','storyboard_approved_at','voiceover_text','caption_text','brand_json','result_asset_url','failure_reason','claimed_by','claimed_at','lease_until','created_at','updated_at'];
 const prepare=(sql:string)=>({
  bind:(...args:any[])=>({
   run:async()=>{
    if(sql.startsWith('INSERT INTO video_jobs')){
     const row:Object.fromEntries=Object.fromEntries(cols.map((c,i)=>[c,args[i]])) as any;
     rows.push(row);return{meta:{changes:1}};
    }
    if(sql.startsWith('UPDATE video_jobs SET status=?,script=?')){
     const [status,script,sab,saa,sj,sbab,sbaa,vt,ct,rau,fr,cb,ca,lu,ua,id,tenant]=args;
     const row=rows.find(r=>r.id===id&&r.tenant_id===tenant);
     if(!row)return{meta:{changes:0}};
     Object.assign(row,{status,script,script_approved_by:sab,script_approved_at:saa,storyboard_json:sj,storyboard_approved_by:sbab,storyboard_approved_at:sbaa,voiceover_text:vt,caption_text:ct,result_asset_url:rau,failure_reason:fr,claimed_by:cb,claimed_at:ca,lease_until:lu,updated_at:ua});
     return{meta:{changes:1}};
    }
    if(sql.startsWith('UPDATE video_jobs SET status=')){
     const [token,at,until,now]=args;
     const candidates=rows
      .filter(r=>r.status==='queued'||(r.status==='generating'&&r.lease_until&&r.lease_until<=now))
      .sort((a,b)=>a.created_at<b.created_at?-1:1);
     const pick=candidates[0];
     if(!pick)return{meta:{changes:0}};
     Object.assign(pick,{status:'generating',claimed_by:token,claimed_at:at,lease_until:until});
     return{meta:{changes:1}};
    }
    throw new Error('fakeD1 run: unsupported '+sql);
   },
   first:async()=>{
    if(sql.startsWith('SELECT * FROM video_jobs WHERE id=? AND tenant_id=?'))
     return rows.find(r=>r.id===args[0]&&r.tenant_id===args[1])??null;
    if(sql.startsWith('SELECT * FROM video_jobs WHERE id=?'))
     return rows.find(r=>r.id===args[0])??null;
    if(sql.startsWith('SELECT * FROM video_jobs WHERE claimed_by=?'))
     return rows.find(r=>r.claimed_by===args[0]&&r.status==='generating')??null;
    throw new Error('fakeD1 first: unsupported '+sql);
   },
   all:async()=>{
    if(sql.startsWith('SELECT * FROM video_jobs WHERE tenant_id=? ORDER BY'))
     return{results:rows.filter(r=>r.tenant_id===args[0]).sort((a,b)=>b.created_at<a.created_at?-1:1).slice(0,args[1])};
    throw new Error('fakeD1 all: unsupported '+sql);
   },
  }),
 });
 return {AGENT_DB:{prepare},rows};
}
const TENANT='a'.repeat(32);
const actor={tenantId:TENANT,userId:'owner-1'};
const APP_ORIGIN='https://mayor.mehyar.us';
function req(path:string,method='GET',body?:unknown,headers:Record<string,string>={}){
 return new Request(`https://x${path}`,{
  method,
  headers:{'content-type':'application/json',origin:APP_ORIGIN,...headers},
  body:body===undefined?undefined:JSON.stringify(body),
 });
}
async function createJob(db:any,type='service_promo_15s',extra:Record<string,unknown>={}){
 const res=await handleVideogenRequest(
  req(`/api/businesses/${TENANT}/videos`,'POST',{type,businessName:'Glow Studio',vertical:'salon',...extra}),
  {AGENT_DB:db.AGENT_DB,APP_ORIGIN} as any,actor as any);
 expect(res!.status).toBe(200);
 return (await res!.json() as any).job;
}

beforeEach(()=>{vi.clearAllMocks();});

describe('deterministic vertical-voiced drafting',()=>{
 it('drafts a 15s promo in salon voice',()=>{
  const script=draftScriptText({businessName:'Glow Studio',vertical:'salon',type:'service_promo_15s'});
  expect(script).toContain('Glow Studio');
  expect(script).toContain('appointment'); // salon booking word, not "reservation"
  expect(script.split('\n')).toHaveLength(3);
 });
 it('drafts a 30s offer announcement with the offer line',()=>{
  const script=draftScriptText({businessName:'Luigi’s',vertical:'restaurant',type:'offer_announcement_30s',offer:'Tuesday 2-for-1 pies'});
  expect(script).toContain('Tuesday 2-for-1 pies');
  expect(script).toContain('reservation'); // restaurant booking word
  expect(script.split('\n')).toHaveLength(4);
 });
 it('plumbing 15s never says appointment',()=>{
  const script=draftScriptText({businessName:'Fix It',vertical:'plumbing_hvac',type:'service_promo_15s'});
  expect(script).toContain('job');
  expect(script).not.toContain('appointment');
 });
 it('storyboard shots total exactly the job duration',()=>{
  const script=draftScriptText({businessName:'Glow',vertical:'salon',type:'service_promo_15s'});
  const shots=draftStoryboard({businessName:'Glow',vertical:'salon',type:'service_promo_15s'},script);
  expect(shots).toHaveLength(3);
  expect(shots.reduce((s,x)=>s+x.duration_s,0)).toBe(15);
  const shots30=draftStoryboard({businessName:'X',vertical:'other',type:'offer_announcement_30s'},'a\nb\nc\nd');
  expect(shots30.reduce((s,x)=>s+x.duration_s,0)).toBe(30);
 });
 it('captions wrap to short lines; voiceover joins beats',()=>{
  const captions=scriptCaptions('A very long script beat that keeps going and going past forty four characters');
  for(const line of captions.split('\n'))expect(line.length).toBeLessThanOrEqual(44);
  expect(scriptVoiceover('line one\nline two')).toBe('line one line two');
 });
});

describe('compliance guardrails (items 11-12)',()=>{
 it.each([
  ['We guarantee amazing results every time','guaranteed-results language'],
  ['Results guaranteed in 30 days','promised results'],
  ['The #1 salon in Brooklyn','"#1" superlative'],
  ['We are the number one shop','"number one" superlative'],
  ['Best in town, period','unsupported "best in" claim'],
  ['Our clients love us so much','invented customer endorsement'],
  ['Our 5-star service speaks for itself','star-rating claim'],
  ['Reviews prove we are the best','unsupported review claim'],
  ['Read our testimonials','testimonial language'],
  ['Everyone says we are amazing','invented consensus'],
  ['"Life changing!" — Sarah','quoted customer attribution'],
  ["You'll save big on every visit",'unsupported savings claim'],
 ])('rejects %s (%s)',(text,label)=>{
  expect(findUnsupportedClaims(text)).toContain(label);
 });
 it('accepts honest copy',()=>{
  expect(findUnsupportedClaims('Glow Studio — cuts, color, and styling. Book your appointment today.')).toEqual([]);
 });
 it('owner-edited script with a fake review is rejected at approval',async()=>{
  const db=fakeD1();
  const job=await createJob(db);
  await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/script/draft`,'POST',{}),{AGENT_DB:db.AGENT_DB,APP_ORIGIN} as any,actor as any);
  await expect(handleVideogenRequest(
   req(`/api/businesses/${TENANT}/videos/${job.id}/script/approve`,'POST',{script:'Glow Studio is great. "Best haircut ever!" — Mike. Come on in.'}),
   {AGENT_DB:db.AGENT_DB,APP_ORIGIN} as any,actor as any)).rejects.toMatchObject({status:422,code:'unsupported_claims'});
 });
 it('storyboard on-screen text with a claim is rejected',async()=>{
  const db=fakeD1();
  const job=await createJob(db);
  await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/script/draft`,'POST',{}),{AGENT_DB:db.AGENT_DB,APP_ORIGIN} as any,actor as any);
  const clean='Glow Studio — cuts and color.\nBook your appointment in under a minute.\nWalk in or book ahead.';
  await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/script/approve`,'POST',{script:clean}),{AGENT_DB:db.AGENT_DB,APP_ORIGIN} as any,actor as any);
  await expect(handleVideogenRequest(
   req(`/api/businesses/${TENANT}/videos/${job.id}/storyboard/approve`,'POST',{shots:[
    {n:1,duration_s:5,scene:'Exterior of Glow Studio in warm morning light',onscreen_text:'Guaranteed best cuts in town'},
    {n:2,duration_s:5,scene:'Stylist at work inside Glow Studio',onscreen_text:'Book today'},
    {n:3,duration_s:5,scene:'Glow Studio storefront at dusk with contact info',onscreen_text:'See you soon'},
   ]}),
   {AGENT_DB:db.AGENT_DB,APP_ORIGIN} as any,actor as any)).rejects.toMatchObject({status:422});
 });
 it('assertStoryboardFits rejects wrong total duration and dup shot numbers',()=>{
  const ok=draftStoryboard({businessName:'G',vertical:'salon',type:'service_promo_15s'},'a\nb\nc');
  expect(()=>assertStoryboardFits('service_promo_15s',ok)).not.toThrow();
  expect(()=>assertStoryboardFits('service_promo_15s',ok.map(s=>({...s,duration_s:6})))).toThrowError(expect.objectContaining({code:'storyboard_duration'}));
  expect(()=>assertStoryboardFits('service_promo_15s',ok.map((s,i)=>({...s,n:i<2?1:s.n})))).toThrowError(expect.objectContaining({code:'storyboard_shots'}));
 });
});

describe('job lifecycle',()=>{
 it('create validates the video type',async()=>{
  const db=fakeD1();
  await expect(handleVideogenRequest(
   req(`/api/businesses/${TENANT}/videos`,'POST',{type:'feature_film'}),
   {AGENT_DB:db.AGENT_DB,APP_ORIGIN} as any,actor as any)).rejects.toThrow();
 });
 it('full happy path: draft -> approve -> draft -> approve -> queued',async()=>{
  const db=fakeD1();
  const env={AGENT_DB:db.AGENT_DB,APP_ORIGIN} as any;
  let job=await createJob(db);
  expect(job.status).toBe('draft');
  expect(job.vertical).toBe('salon');
  let res=await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/script/draft`,'POST',{}),env,actor as any);
  job=(await res!.json() as any).job;
  expect(job.status).toBe('script_pending');
  expect(job.script).toContain('Glow Studio');
  res=await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/script/approve`,'POST',{script:'Glow Studio — cuts, color, styling.\nBook your appointment today.\nWalk in or book ahead.'}),env,actor as any);
  job=(await res!.json() as any).job;
  expect(job.status).toBe('script_approved');
  expect(job.scriptApproved.by).toBe('owner-1');
  expect(job.captionText).toBeTruthy();
  expect(job.voiceoverText).toBeTruthy();
  res=await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/storyboard/draft`,'POST',{}),env,actor as any);
  job=(await res!.json() as any).job;
  expect(job.status).toBe('storyboard_pending');
  expect(job.storyboard).toHaveLength(3);
  const shots=job.storyboard.map((s:any)=>({...s}));
  res=await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/storyboard/approve`,'POST',{shots}),env,actor as any);
  job=(await res!.json() as any).job;
  expect(job.status).toBe('queued');
  expect(job.storyboardApproved.by).toBe('owner-1');
  // generation cannot start without both approvals: claim moves it on
  const claimed=await claimVideoJob(db as any,{workerId:'runner-1'});
  expect(claimed!.id).toBe(job.id);
  expect(claimed!.status).toBe('generating');
  expect(claimed!.captionText).toBe(job.captionText);
 });
 it('state machine rejects out-of-order steps',async()=>{
  const db=fakeD1();const env={AGENT_DB:db.AGENT_DB,APP_ORIGIN} as any;
  const job=await createJob(db);
  await expect(handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/storyboard/draft`,'POST',{}),env,actor as any)).rejects.toMatchObject({status:409});
  await expect(handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/script/approve`,'POST',{script:'x'.repeat(20)}),env,actor as any)).rejects.toMatchObject({status:409});
 });
 it('jobs are tenant-scoped',async()=>{
  const db=fakeD1();const env={AGENT_DB:db.AGENT_DB,APP_ORIGIN} as any;
  const job=await createJob(db);
  const other={tenantId:'b'.repeat(32),userId:'owner-1'};
  await expect(handleVideogenRequest(req(`/api/businesses/${'b'.repeat(32)}/videos/${job.id}`,'GET'),env,other as any)).rejects.toMatchObject({status:404});
  const res=await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}`,'GET'),env,actor as any);
  expect((await res!.json() as any).job.id).toBe(job.id);
 });
 it('list jobs returns newest first',async()=>{
  const db=fakeD1();const env={AGENT_DB:db.AGENT_DB,APP_ORIGIN} as any;
  await createJob(db);await createJob(db,'offer_announcement_30s',{offer:'Deal'});
  const res=await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos`,'GET'),env,actor as any);
  const jobs=(await res!.json() as any).jobs;
  expect(jobs).toHaveLength(2);
  expect(jobs[0].type).toBe('offer_announcement_30s');
 });
 it('cancel a queued job marks it canceled, not deleted',async()=>{
  const db=fakeD1();const env={AGENT_DB:db.AGENT_DB,APP_ORIGIN} as any;
  let job=await createJob(db);
  await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/script/draft`,'POST',{}),env,actor as any);
  await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/script/approve`,'POST',{script:'Glow Studio — cuts and color.\nBook your appointment today.\nWalk in or book ahead.'}),env,actor as any);
  await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/storyboard/draft`,'POST',{}),env,actor as any);
  const status=await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}`,'GET'),env,actor as any);
  const shots=(await status!.json() as any).job.storyboard;
  await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/storyboard/approve`,'POST',{shots}),env,actor as any);
  const res=await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/cancel`,'POST',{}),env,actor as any);
  job=(await res!.json() as any).job;
  expect(job.status).toBe('failed');
  expect(job.canceled).toBe(true);
  expect(await claimVideoJob(db as any,{workerId:'r'})).toBeNull();
 });
 it('non-owner actor is rejected',async()=>{
  const db=fakeD1();
  await expect(handleVideogenRequest(
   req(`/api/businesses/${TENANT}/videos`,'GET'),
   {AGENT_DB:db.AGENT_DB,APP_ORIGIN} as any,{tenantId:TENANT,userId:'viewer-9'} as any)).rejects.toMatchObject({status:403});
 });
});

describe('handoff contract: claim / complete / fail',()=>{
 async function queuedJob(db:any){
  const env={AGENT_DB:db.AGENT_DB,APP_ORIGIN} as any;
  let job=await createJob(db);
  await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/script/draft`,'POST',{}),env,actor as any);
  await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/script/approve`,'POST',{script:'Glow Studio — cuts and color.\nBook your appointment today.\nWalk in or book ahead.'}),env,actor as any);
  await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/storyboard/draft`,'POST',{}),env,actor as any);
  const status=await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}`,'GET'),env,actor as any);
  const shots=(await status!.json() as any).job.storyboard;
  await handleVideogenRequest(req(`/api/businesses/${TENANT}/videos/${job.id}/storyboard/approve`,'POST',{shots}),env,actor as any);
  return job.id;
 }
 it('claim is exclusive: a second claim gets nothing',async()=>{
  const db=fakeD1();
  const id=await queuedJob(db);
  const first=await claimVideoJob(db as any,{workerId:'runner-a'});
  expect(first!.id).toBe(id);
  expect(await claimVideoJob(db as any,{workerId:'runner-b'})).toBeNull();
 });
 it('an expired lease is reclaimed by the next runner',async()=>{
  const db=fakeD1();
  const id=await queuedJob(db);
  await claimVideoJob(db as any,{workerId:'crashed',leaseMinutes:1});
  // force the lease into the past
  const row=db.rows.find(r=>r.id===id)!;
  row.lease_until=new Date(Date.now()-60_000).toISOString();
  const reclaimed=await claimVideoJob(db as any,{workerId:'runner-b'});
  expect(reclaimed!.id).toBe(id);
  expect(reclaimed!.status).toBe('generating');
 });
 it('complete requires https and a generating job',async()=>{
  const db=fakeD1();
  const id=await queuedJob(db);
  await claimVideoJob(db as any,{workerId:'r'});
  await expect(completeVideoJob(db as any,id,'http://cdn.example/v.mp4')).rejects.toMatchObject({status:400});
  const done=await completeVideoJob(db as any,id,'https://cdn.example/v.mp4');
  expect(done.status).toBe('ready');
  expect(done.resultAssetUrl).toBe('https://cdn.example/v.mp4');
  await expect(completeVideoJob(db as any,id,'https://cdn.example/v2.mp4')).rejects.toMatchObject({status:409});
 });
 it('fail records the reason for the owner',async()=>{
  const db=fakeD1();
  const id=await queuedJob(db);
  await claimVideoJob(db as any,{workerId:'r'});
  const failed=await failVideoJob(db as any,id,'render farm timed out');
  expect(failed.status).toBe('failed');
  expect(failed.failureReason).toBe('render farm timed out');
 });
 it('claim with no queued jobs returns null',async()=>{
  const db=fakeD1();
  expect(await claimVideoJob(db as any,{workerId:'r'})).toBeNull();
 });
});

describe('route registration',()=>{
 it('registerVideogenRoutes wires GET and POST patterns',()=>{
  const added:{method:string;pattern:RegExp}[]=[];
  registerVideogenRoutes({add:(method,pattern)=>{added.push({method,pattern});}});
  expect(added.map(a=>a.method).sort()).toEqual(['GET','POST']);
  const post=added.find(a=>a.method==='POST')!.pattern;
  expect(post.test(`/api/businesses/${TENANT}/videos`)).toBe(true);
  expect(post.test(`/api/businesses/${TENANT}/videos/123e4567-e89b-12d3-a456-426614174000/script/approve`)).toBe(true);
  expect(post.test(`/api/businesses/${TENANT}/videos/123e4567-e89b-12d3-a456-426614174000/cancel`)).toBe(true);
 });
 it('unknown paths return null so other routers keep working',async()=>{
  const res=await handleVideogenRequest(req('/api/businesses/foo/videos','GET'),{AGENT_DB:fakeD1().AGENT_DB,APP_ORIGIN} as any,actor as any);
  expect(res).toBeNull();
 });
});
