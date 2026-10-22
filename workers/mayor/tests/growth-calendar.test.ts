import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {
 canTransition,isSendable,sendBackoffMs,bucketPostsByLocalDay,copyToneHint,starterCopyIdeas,
 createDraft,getPost,listPosts,schedulePost,approvePost,editPost,cancelPost,retryPost,
 createSeries,approveSeries,archiveSeries,runDuePosts,TEST_GATED_ADAPTER,MAX_SEND_RETRIES,
 registerGrowthCalendarRoutes,GROWTH_CALENDAR_ROUTES,
 type SocialPost,type SocialPublishAdapter,type CreatePostInput,
} from '../src/growth-calendar';

/* ---------------- minimal in-memory D1 fake ----------------
 * Handles exactly the SQL shapes src/growth-calendar.ts (and the
 * membership query in permissions.ts) emit. Anything else throws,
 * so a new query shape fails loudly here instead of silently. */

interface FakeRow{ [k:string]:unknown }
function norm(sql:string){return sql.replace(/\s+/g,' ').trim().toLowerCase();}

function fakeDb(ownerUserId:string){
 const tables:Record<string,FakeRow[]>={mayor_social_posts:[],mayor_social_series:[],agent_memberships:[],agent_tenants:[]};
 tables.agent_tenants.push({id:'t1',status:'active'});
 tables.agent_memberships.push({tenant_id:'t1',user_id:ownerUserId,role:'owner',status:'active',expires_at:null});
 const db={
  prepare(sql:string){
   const n=norm(sql);
   const stmt={
    _params:[] as unknown[],
    bind(...p:unknown[]){stmt._params=p;return stmt;},
    async first<T>():Promise<T|null>{const r=await stmt.all<T>();return (r.results[0]??null) as T|null;},
    async all<T>():Promise<{results:T[]}>{
     const p=stmt._params;
     const posts=()=>tables.mayor_social_posts, series=()=>tables.mayor_social_series;
     const byIdTenant=(rows:FakeRow[])=>rows.filter(r=>r.id===p[0]&&r.tenant_id===p[1]);
     if(n.startsWith('select m.* from agent_memberships')){
      const m=tables.agent_memberships.find(m=>m.tenant_id===p[0]&&m.user_id===p[1]&&m.status==='active');
      return {results:(m?[m]:[]) as T[]};
     }
     if(n.startsWith('select')&&n.includes('from mayor_social_posts where id=? and tenant_id=?')){
      return {results:byIdTenant(posts()) as T[]};
     }
     if(n.startsWith('select')&&n.includes('from mayor_social_posts where tenant_id=? and scheduled_for>=')){
      let rows=posts().filter(r=>r.tenant_id===p[0]&&String(r.scheduled_for)>=String(p[1])&&String(r.scheduled_for)<String(p[2]));
      let i=3;
      if(n.includes('and channel=?')){rows=rows.filter(r=>r.channel===p[i]);i++;}
      if(n.includes('and status=?')){rows=rows.filter(r=>r.status===p[i]);i++;}
      if(n.includes('and series_id=?')){rows=rows.filter(r=>r.series_id===p[i]);i++;}
      rows.sort((a,b)=>String(a.scheduled_for).localeCompare(String(b.scheduled_for)));
      return {results:rows.slice(0,500) as T[]};
     }
     if(n.startsWith('select')&&n.includes('from mayor_social_posts where status in')){
      let rows=posts().filter(r=>(r.status==='approved'||r.status==='scheduled')&&String(r.scheduled_for)<=String(p[0])&&Number(r.retry_count)<Number(p[1]));
      if(n.includes('and tenant_id=?'))rows=rows.filter(r=>r.tenant_id===p[2]);
      rows.sort((a,b)=>String(a.scheduled_for).localeCompare(String(b.scheduled_for)));
      return {results:rows.slice(0,25) as T[]};
     }
     if(n.startsWith('select id from mayor_social_series')){
      return {results:series().filter(r=>r.tenant_id===p[0]&&r.status==='active'&&r.approved_by!=null).map(r=>({id:r.id})) as T[]};
     }
     if(n.startsWith('select')&&n.includes('from mayor_social_series where id=?')){
      return {results:series().filter(r=>r.id===p[0]&&r.tenant_id===p[1]) as T[]};
     }
     if(n.startsWith('select')&&n.includes('from mayor_social_series where tenant_id=?')){
      return {results:series().filter(r=>r.tenant_id===p[0]).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,100) as T[]};
     }
     throw new Error('fakeDb: unhandled SELECT: '+n.slice(0,120));
    },
    async run():Promise<{success:boolean;meta:{changes:number}}>{
     const p=stmt._params;
     const posts=()=>tables.mayor_social_posts, series=()=>tables.mayor_social_series;
     const updPost=(fn:(r:FakeRow)=>boolean):number=>{
      let c=0;for(const r of posts()){if(fn(r)){c++;}}return c;
     };
     if(n.startsWith('insert into mayor_social_posts')){
      const cols=sql.slice(sql.indexOf('(')+1,sql.indexOf(')')).split(',').map(s=>s.trim());
      const row:FakeRow={retry_count:0,publish_mode:'test-gated'}; // D1 column defaults
      cols.forEach((c,i)=>{row[c]=p[i];});
      if(posts().some(r=>r.tenant_id===row.tenant_id&&r.dedupe_key===row.dedupe_key))
       throw new Error('UNIQUE constraint failed: mayor_social_posts.tenant_id, mayor_social_posts.dedupe_key');
      posts().push(row);return {success:true,meta:{changes:1}};
     }
     if(n.startsWith('insert into mayor_social_series')){
      const cols=sql.slice(sql.indexOf('(')+1,sql.indexOf(')')).split(',').map(s=>s.trim());
      const row:FakeRow={};cols.forEach((c,i)=>row[c]=p[i]);series().push(row);return {success:true,meta:{changes:1}};
     }
     if(n.startsWith('update mayor_social_posts set status=\'sending\'')){
      // p: last_attempt_at, publish_mode, updated_at, id, tenant_id
      const c=updPost(r=>r.id===p[3]&&r.tenant_id===p[4]&&(r.status==='approved'||r.status==='scheduled')
       ?(r.status='sending',r.last_attempt_at=p[0],r.publish_mode=p[1],r.updated_at=p[2],true):false);
      return {success:true,meta:{changes:c}};
     }
     if(n.startsWith('update mayor_social_posts set status=\'sent\'')){
      const c=updPost(r=>r.id===p[2]&&r.tenant_id===p[3]?(r.status='sent',r.remote_id=p[0],r.failure_reason=null,r.updated_at=p[1],true):false);
      return {success:true,meta:{changes:c}};
     }
     if(n.startsWith('update mayor_social_posts set status=?,retry_count=?')){
      const c=updPost(r=>r.id===p[4]&&r.tenant_id===p[5]?(r.status=p[0],r.retry_count=p[1],r.failure_reason=p[2],r.updated_at=p[3],true):false);
      return {success:true,meta:{changes:c}};
     }
     if(n.startsWith('update mayor_social_posts set status=\'approved\',approved_by')){
      const c=updPost(r=>r.id===p[3]&&r.tenant_id===p[4]?(r.status='approved',r.approved_by=p[0],r.approved_at=p[1],r.failure_reason=null,r.retry_count=0,r.updated_at=p[2],true):false);
      return {success:true,meta:{changes:c}};
     }
     if(n.startsWith('update mayor_social_posts set status=\'cancelled\'')){
      const c=updPost(r=>r.id===p[1]&&r.tenant_id===p[2]?(r.status='cancelled',r.updated_at=p[0],true):false);
      return {success:true,meta:{changes:c}};
     }
     if(n.startsWith('update mayor_social_posts set scheduled_for=')){
      const c=updPost(r=>r.id===p[2]&&r.tenant_id===p[3]?(r.scheduled_for=p[0],r.status='scheduled',r.updated_at=p[1],true):false);
      return {success:true,meta:{changes:c}};
     }
     if(n.startsWith('update mayor_social_posts set ')){
      const setPart=sql.slice(sql.toLowerCase().indexOf('set ')+4,sql.toLowerCase().indexOf(' where'));
      const cols=setPart.split(',').map(s=>s.split('=')[0].trim());
      const c=updPost(r=>{
       if(r.id!==p[p.length-2]||r.tenant_id!==p[p.length-1])return false;
       cols.forEach((col,i)=>{r[col]=p[i];});return true;
      });
      return {success:true,meta:{changes:c}};
     }
     if(n.startsWith('update mayor_social_series set approved_by')){
      const c=series().filter(r=>r.id===p[3]&&r.tenant_id===p[4]).map(r=>{r.approved_by=p[0];r.approved_at=p[1];r.updated_at=p[2];}).length;
      return {success:true,meta:{changes:c}};
     }
     if(n.startsWith('update mayor_social_series set status=\'archived\'')){
      const c=series().filter(r=>r.id===p[1]&&r.tenant_id===p[2]).map(r=>{r.status='archived';r.updated_at=p[0];}).length;
      return {success:true,meta:{changes:c}};
     }
     throw new Error('fakeDb: unhandled UPDATE: '+n.slice(0,120));
    },
   };
   return stmt;
  },
 };
 return {AGENT_DB:db} as unknown as Pick<Env,'AGENT_DB'>;
}

type TestDb=ReturnType<typeof fakeDb>;

const OWNER='user-owner';
const actor={tenantId:'t1',userId:OWNER};
const NOW=Date.parse('2026-10-09T16:42:00Z');
const iso=(ms:number)=>new Date(ms).toISOString();

async function draftAt(db:TestDb,scheduled_for:string,extra:Partial<CreatePostInput>={}){
 return createDraft(db,actor,{channel:'instagram',language:'en',copy_text:'Hello world',scheduled_for,...extra});
}
async function scheduledDraft(db:TestDb,scheduled_for:string,extra:Partial<CreatePostInput>={}){
 const d=await draftAt(db,scheduled_for,extra);
 return schedulePost(db,actor,d.id,d.scheduled_for);
}
async function approvedPost(db:TestDb,scheduled_for:string,extra:Partial<CreatePostInput>={}){
 const s=await scheduledDraft(db,scheduled_for,extra);
 return approvePost(db,actor,s.id);
}

describe('post state machine',()=>{
 it('allows the happy path draft->scheduled->approved and blocks skips',()=>{
  expect(canTransition('draft','scheduled')).toBe(true);
  expect(canTransition('scheduled','approved')).toBe(true);
  expect(canTransition('draft','approved')).toBe(false);
  expect(canTransition('draft','sent')).toBe(false);
  expect(canTransition('sent','cancelled')).toBe(false);
  expect(canTransition('cancelled','draft')).toBe(false);
  expect(canTransition('failed','approved')).toBe(true);
 });
 it('drives the full lifecycle through the DB',async()=>{
  const db=fakeDb(OWNER);
  const d=await draftAt(db,iso(NOW+3600_000));
  expect(d.status).toBe('draft');
  const s=await schedulePost(db,actor,d.id,iso(NOW+7200_000));
  expect(s.status).toBe('scheduled');
  expect(s.scheduled_for).toBe(iso(NOW+7200_000));
  const a=await approvePost(db,actor,d.id);
  expect(a.status).toBe('approved');
  expect(a.approved_by).toBe(OWNER);
  await expect(editPost(db,actor,d.id,{copy_text:'nope'})).rejects.toThrow('cannot be edited');
  const c=await cancelPost(db,actor,d.id);
  expect(c.status).toBe('cancelled');
  const err=await approvePost(db,actor,d.id).catch(e=>e);
  expect(err.code).toBe('invalid_transition');
 });
 it('rejects duplicate dedupe keys',async()=>{
  const db=fakeDb(OWNER);
  await draftAt(db,iso(NOW+3600_000),{dedupe_key:'same-key'});
  await expect(draftAt(db,iso(NOW+3600_000),{dedupe_key:'same-key'})).rejects.toThrow('dedupe key already exists');
 });
 it('allows edits only before approval',async()=>{
  const db=fakeDb(OWNER);
  const d=await draftAt(db,iso(NOW+3600_000));
  const e=await editPost(db,actor,d.id,{copy_text:'Edited',channel:'facebook'});
  expect(e.copy_text).toBe('Edited');expect(e.channel).toBe('facebook');
 });
});

describe('approval model',()=>{
 it('treats approved posts and series-approved scheduled posts as sendable',()=>{
  const base={series_id:null,approved_by:OWNER} as Partial<SocialPost>;
  expect(isSendable({...base,status:'approved'} as SocialPost,new Set())).toBe(true);
  expect(isSendable({...base,status:'scheduled',series_id:'s1'} as SocialPost,new Set(['s1']))).toBe(true);
  expect(isSendable({...base,status:'scheduled',series_id:'s1'} as SocialPost,new Set())).toBe(false);
  expect(isSendable({...base,status:'scheduled',series_id:null} as SocialPost,new Set())).toBe(false);
  expect(isSendable({...base,status:'draft'} as SocialPost,new Set())).toBe(false);
 });
 it('grants series approval to scheduled posts only while the series is approved',async()=>{
  const db=fakeDb(OWNER);
  const series=await createSeries(db,actor,{name:'Fall promo',channels:['instagram']});
  const d=await draftAt(db,iso(NOW-60_000),{series_id:series.id});
  await schedulePost(db,actor,d.id,iso(NOW-60_000));
  // Not series-approved yet: worker must skip it.
  let summary=await runDuePosts(db,{nowMs:NOW,adapter:liveAdapter('remote-1')});
  expect(summary.skipped).toBe(1);expect(summary.sent).toBe(0);
  expect((await getPost(db,actor,d.id)).status).toBe('scheduled');
  // Owner approves the series: now it becomes sendable.
  await approveSeries(db,actor,series.id);
  summary=await runDuePosts(db,{nowMs:NOW,adapter:liveAdapter('remote-1')});
  expect(summary.sent).toBe(1);
  expect((await getPost(db,actor,d.id)).status).toBe('sent');
 });
 it('archiving a series revokes sendability',async()=>{
  const db=fakeDb(OWNER);
  const series=await createSeries(db,actor,{name:'X',channels:['x']});
  await approveSeries(db,actor,series.id);
  const d=await draftAt(db,iso(NOW-60_000),{series_id:series.id,channel:'x'});
  await schedulePost(db,actor,d.id,iso(NOW-60_000));
  await archiveSeries(db,actor,series.id);
  const summary=await runDuePosts(db,{nowMs:NOW,adapter:liveAdapter('r')});
  expect(summary.sent).toBe(0);expect(summary.skipped).toBe(1);
 });
});

function liveAdapter(remoteId:string):SocialPublishAdapter{
 return {publishMode:'live',async publish(){return {ok:true,remoteId};}};
}

describe('runDuePosts honesty and idempotency',()=>{
 it('never reports sent through the test-gated adapter',async()=>{
  const db=fakeDb(OWNER);
  const p=await approvedPost(db,iso(NOW-60_000));
  const summary=await runDuePosts(db,{nowMs:NOW,adapter:TEST_GATED_ADAPTER});
  expect(summary.sent).toBe(0);
  const after=await getPost(db,actor,p.id);
  expect(after.status).toBe('approved'); // stays approved, eligible after backoff
  expect(after.failure_reason).toContain('test_gated');
  expect(after.publish_mode).toBe('test-gated');
  expect(summary.errors[0].errorCode).toBe('test_gated');
 });
 it('exhausts retries into failed with the reason preserved',async()=>{
  const db=fakeDb(OWNER);
  const p=await approvedPost(db,iso(NOW-3600_000));
  let s=await getPost(db,actor,p.id);
  for(let i=0;i<MAX_SEND_RETRIES;i++){
   const t=NOW+i*31*60_000; // past backoff each round
   await runDuePosts(db,{nowMs:t,adapter:TEST_GATED_ADAPTER});
   s=await getPost(db,actor,p.id);
  }
  expect(s.status).toBe('failed');
  expect(s.retry_count).toBe(MAX_SEND_RETRIES);
  expect(s.failure_reason).toContain('test_gated');
  // Owner can re-approve explicitly for another attempt.
  const r=await retryPost(db,actor,p.id);
  expect(r.status).toBe('approved');
 });
 it('respects backoff between attempts',async()=>{
  const db=fakeDb(OWNER);
  const p=await approvedPost(db,iso(NOW-60_000));
  await runDuePosts(db,{nowMs:NOW,adapter:TEST_GATED_ADAPTER});
  // Immediate second run must skip (backoff window).
  const summary=await runDuePosts(db,{nowMs:NOW+60_000,adapter:TEST_GATED_ADAPTER});
  expect(summary.attempted).toBe(0);
 });
 it('does not double-send: the optimistic claim wins exactly once',async()=>{
  const db=fakeDb(OWNER);
  const p=await approvedPost(db,iso(NOW-60_000));
  const first=await runDuePosts(db,{nowMs:NOW,adapter:liveAdapter('remote-1')});
  const second=await runDuePosts(db,{nowMs:NOW,adapter:liveAdapter('remote-2')});
  expect(first.sent).toBe(1);expect(second.sent).toBe(0);
  expect((await getPost(db,actor,p.id)).remote_id).toBe('remote-1');
 });
 it('treats a success claim from a test-gated adapter as failure',async()=>{
  const db=fakeDb(OWNER);
  const p=await approvedPost(db,iso(NOW-60_000));
  const lying:SocialPublishAdapter={publishMode:'test-gated',async publish(){return {ok:true,remoteId:'fake'};}};
  await runDuePosts(db,{nowMs:NOW,adapter:lying});
  const after=await getPost(db,actor,p.id);
  expect(after.status).not.toBe('sent');
  expect(after.failure_reason).toContain('untrusted_success');
 });
 it('skips future slots and non-approved posts',async()=>{
  const db=fakeDb(OWNER);
  await approvedPost(db,iso(NOW+3600_000)); // future
  await scheduledDraft(db,iso(NOW-60_000)); // not approved
  const summary=await runDuePosts(db,{nowMs:NOW,adapter:liveAdapter('r')});
  expect(summary.attempted).toBe(0);expect(summary.sent).toBe(0);
 });
 it('uses exponential backoff timings',()=>{
  expect(sendBackoffMs(0)).toBe(5*60_000);
  expect(sendBackoffMs(1)).toBe(10*60_000);
  expect(sendBackoffMs(3)).toBe(30*60_000);
  expect(sendBackoffMs(10)).toBe(30*60_000);
 });
});

describe('list + calendar bucketing',()=>{
 it('lists posts in the requested window',async()=>{
  const db=fakeDb(OWNER);
  await draftAt(db,iso(NOW+86400_000));
  await draftAt(db,iso(NOW+9*86400_000),{channel:'x'});
  const week=await listPosts(db,actor,{from:iso(NOW),to:iso(NOW+8*86400_000)});
  expect(week).toHaveLength(1);
  const filtered=await listPosts(db,actor,{from:iso(NOW),to:iso(NOW+10*86400_000),channel:'x'});
  expect(filtered).toHaveLength(1);expect(filtered[0].channel).toBe('x');
 });
 it('buckets posts by local day',async()=>{
  const db=fakeDb(OWNER);
  // 2026-10-09T16:42Z = 12:42 EDT; 2026-10-10T02:00Z = 22:00 EDT Oct 9
  const a=await draftAt(db,'2026-10-09T18:00:00Z');
  const b=await draftAt(db,'2026-10-10T02:00:00Z');
  const posts=await listPosts(db,actor,{from:'2026-10-09T00:00:00Z',to:'2026-10-12T00:00:00Z'});
  expect(posts).toHaveLength(2);
  const weekStart=Date.parse('2026-10-09T04:00:00Z'); // 2026-10-09 00:00 America/New_York (EDT)
  const buckets=bucketPostsByLocalDay(posts,weekStart,3,'America/New_York');
  expect(buckets[0].dayKey).toBe('2026-10-09');
  expect(buckets[0].posts.map(p=>p.id).sort()).toEqual([a.id,b.id].sort());
  expect(buckets[1].posts).toHaveLength(0);
 });
});

describe('copy helpers',()=>{
 it('returns a vertical tone hint and templates',()=>{
  expect(copyToneHint('salon')).toContain('receptionist');
  expect(copyToneHint(null)).toBeTruthy();
  const ideas=starterCopyIdeas('restaurant');
  expect(ideas).toHaveLength(3);
  expect(ideas.every(i=>i.includes('{business}'))).toBe(true);
 });
});

describe('route registration',()=>{
 it('exports the register function and a route table',()=>{
  expect(typeof registerGrowthCalendarRoutes).toBe('function');
  expect(GROWTH_CALENDAR_ROUTES.length).toBeGreaterThan(0);
  const added:unknown[]=[];
  registerGrowthCalendarRoutes({addRoute:(d:unknown)=>added.push(d)});
  expect(added).toHaveLength(GROWTH_CALENDAR_ROUTES.length);
 });
 it('patterns capture tenant and post ids',()=>{
  const def=GROWTH_CALENDAR_ROUTES.find(d=>d.method==='GET'&&d.pattern.test(`/api/businesses/${'a'.repeat(32)}/social-posts`))!;
  const tenant='b'.repeat(32);
  const postId=`${'c'.repeat(8)}-${'d'.repeat(4)}-${'e'.repeat(4)}-${'f'.repeat(4)}-${'0'.repeat(12)}`;
  const m=`/api/businesses/${tenant}/social-posts/${postId}/approve`.match(def.pattern);
  expect(m?.[1]).toBe(tenant);
  expect(m?.[2]).toBe(postId);
  expect(m?.[3]).toBe('approve');
 });
});
