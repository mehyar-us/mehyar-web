import {describe,it,expect} from 'vitest';
import {generateTrendpostPlan,getTrendpostPlan,decideTrendpostPost,editTrendpostPost,planSummary,trendpostAccessView} from '../src/trendpost';

/* Trendpost (2026-10-14): the in-memory shim serves exactly the statements
 * the module issues (membership, billing context, memory, trendpost tables)
 * so state transitions run for real against stored rows. env.AI is absent,
 * so generation takes the deterministic template path. */

const TENANT='a'.repeat(32), USER='user-1';
const NOW=Date.parse('2026-10-14T15:00:00Z'); // a Wednesday

function fakeDb(){
 const memberships=[{tenant_id:TENANT,user_id:USER,role:'owner',status:'active',expires_at:null}];
 const plans:any[]=[],posts:any[]=[];
 let pro=false;
 const db={prepare:(sql:string)=>({bind:(...args:any[])=>({
  first:async()=>{
   if(sql.includes('agent_memberships'))return memberships.find(m=>m.tenant_id===args[0]&&m.user_id===args[1])??null;
   if(sql.includes('mayor_billing_paid_periods'))return pro?{period_key:'2026-10',period_start:0,period_end:9999999999}:null;
   if(sql.includes('mayor_memory'))return null;
   if(sql.includes('COUNT(*)')&&sql.includes('mayor_trendpost_plans'))return {n:plans.filter(p=>p.tenant_id===args[0]).length};
   if(sql.includes('FROM mayor_trendpost_plans')&&sql.includes("state='active'")){const act=plans.filter(p=>p.tenant_id===args[0]&&p.state==='active').sort((a,b)=>b.created_at-a.created_at)[0];return act?{id:act.id}:null;}
   if(sql.includes('FROM mayor_trendpost_plans'))return plans.find(p=>p.id===args[0]&&p.tenant_id===args[1])??null;
   if(sql.includes('FROM mayor_trendpost_posts')){const p=posts.find(p=>p.id===args[0]&&p.tenant_id===args[1]);return p?{plan_id:p.plan_id}:null;}
   return null;},
  all:async()=>{
   if(sql.includes('FROM mayor_trendpost_posts'))return {results:posts.filter(p=>p.plan_id===args[0]).sort((a,b)=>a.day_index-b.day_index)};
   return {results:[]};},
  run:async()=>{
   if(sql.startsWith("UPDATE mayor_trendpost_plans SET state='archived'")){for(const p of plans)if(p.tenant_id===args[0]&&p.state==='active')p.state='archived';return {success:true};}
   if(sql.startsWith('INSERT INTO mayor_trendpost_plans')){plans.push({id:args[0],tenant_id:args[1],week_start:args[2],summary_json:args[3],state:args[4],source:args[5],created_at:args[6]});return {success:true};}
   if(sql.startsWith('INSERT INTO mayor_trendpost_posts')){posts.push({id:args[0],plan_id:args[1],tenant_id:args[2],day_index:args[3],slot:args[4],kind:args[5],angle:args[6],draft:args[7],state:args[8],created_at:args[9]});return {success:true};}
   if(sql.startsWith('UPDATE mayor_trendpost_posts SET state=')){const p=posts.find(p=>p.id===args[2]&&p.tenant_id===args[3]);if(p&&(p.state==='pending'||p.state==='edited')){p.state=args[0];p.decided_at=args[1];}return {success:true};}
   if(sql.startsWith('UPDATE mayor_trendpost_posts SET draft=')){const p=posts.find(p=>p.id===args[1]&&p.tenant_id===args[2]);if(p&&(p.state==='pending'||p.state==='edited')){p.draft=args[0];p.state='edited';}return {success:true};}
   return {success:true};}
 })})};
 return {db:db as never,plans,posts,setPro:(v:boolean)=>{pro=v;}};
}
const actor={tenantId:TENANT,userId:USER};
const envOf=(db:never)=>({AGENT_DB:db,MAYOR_STRIPE_MODE:'live'} as never);

describe('trendpost plan generation',()=>{
 it('builds a 7-day plan with the money-loop summary and Monday week start',async()=>{
  const {db}=fakeDb();
  const plan=await generateTrendpostPlan(envOf(db),actor,NOW);
  expect(plan.posts).toHaveLength(7);
  expect(plan.weekStart).toBe('2026-10-12');
  expect(plan.summary).toContain('2 promos');
  expect(plan.summary).toContain('1 review ask');
  expect(plan.summary).toContain('1 reactivation');
  expect(plan.posts.map(p=>p.dayLabel)).toEqual(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
  expect(plan.posts.every(p=>p.draft.length>20&&!p.draft.includes('$'))).toBe(true);
  expect(plan.posts.every(p=>p.state==='pending')).toBe(true);
  expect(plan.source).toBe('generated');
 });
 it('free tenants get one sample plan, then the gate closes with a 402',async()=>{
  const {db}=fakeDb();
  const before=await trendpostAccessView(envOf(db),actor);
  expect(before).toMatchObject({planId:'free',included:false,sampleAvailable:true,canGenerate:true});
  await generateTrendpostPlan(envOf(db),actor,NOW);
  const after=await trendpostAccessView(envOf(db),actor);
  expect(after).toMatchObject({sampleAvailable:false,canGenerate:false});
  await expect(generateTrendpostPlan(envOf(db),actor,NOW)).rejects.toMatchObject({status:402});
 });
 it('pro tenants regenerate freely; the previous plan is archived',async()=>{
  const {db,plans,setPro}=fakeDb();
  setPro(true);
  const first=await generateTrendpostPlan(envOf(db),actor,NOW);
  const second=await generateTrendpostPlan(envOf(db),actor,NOW);
  expect(second.id).not.toBe(first.id);
  expect(plans.filter(p=>p.state==='active')).toHaveLength(1);
  expect(plans.find(p=>p.id===first.id)?.state).toBe('archived');
  const current=await getTrendpostPlan(envOf(db),actor);
  expect(current?.id).toBe(second.id);
  const access=await trendpostAccessView(envOf(db),actor);
  expect(access).toMatchObject({planId:'pro',included:true,canGenerate:true});
 });
});

describe('trendpost review gate',()=>{
 it('approve, edit, and skip move posts through the gate',async()=>{
  const {db}=fakeDb();
  const plan=await generateTrendpostPlan(envOf(db),actor,NOW);
  const [p0,p1,p2]=plan.posts;
  let view=await decideTrendpostPost(envOf(db),actor,p0.id,'approve');
  expect(view.posts[0].state).toBe('approved');
  view=await editTrendpostPost(envOf(db),actor,p1.id,'My own words for Tuesday.');
  expect(view.posts[1].state).toBe('edited');
  expect(view.posts[1].draft).toBe('My own words for Tuesday.');
  view=await decideTrendpostPost(envOf(db),actor,p1.id,'approve');
  expect(view.posts[1].state).toBe('approved');
  view=await decideTrendpostPost(envOf(db),actor,p2.id,'skip');
  expect(view.posts[2].state).toBe('skipped');
  // An approved post cannot be skipped afterwards (state guard).
  view=await decideTrendpostPost(envOf(db),actor,p0.id,'skip');
  expect(view.posts[0].state).toBe('approved');
 });
 it('unknown posts 404 and foreign tenants are shut out',async()=>{
  const {db}=fakeDb();
  const plan=await generateTrendpostPlan(envOf(db),actor,NOW);
  await expect(decideTrendpostPost(envOf(db),actor,'f'.repeat(32),'approve')).rejects.toMatchObject({status:404});
  await expect(getTrendpostPlan(envOf(db),{tenantId:'b'.repeat(32),userId:USER})).rejects.toMatchObject({status:404});
  expect(plan.posts).toHaveLength(7);
 });
});

describe('trendpost summary',()=>{
 it('phrases counts in owner language',()=>{
  expect(planSummary(['promo','promo','review_ask','reactivation','education','education','community']).text)
   .toBe("This week's posts: 2 promos, 1 review ask, 1 reactivation, 2 helpful posts, 1 community post.");
 });
});
