import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {encryptCredential} from '../src/auth/vault';
import {
 GBP_BUSINESS_SCOPE,GBP_API_ACCESS_BLOCKER,
 gbpReviewsAvailability,starRatingValue,parseGbpReview,parseGbpLocation,
 summarizeGbpReviews,gbpReviewsCanSucceed,getGbpReviews,refreshGbpReviews,
} from '../src/gbp-reviews';
import {deriveConductorState,buildHandoffSummary} from '../src/onboarding-conductor';

/** P6 GBP reviews. Ground truth under test: the CURRENT production Google
 * grant cannot read Business Profile data (no business.manage scope, the
 * capability is not enabled in prod config, and Google has not approved
 * Business Profile API access for the app). The read must therefore say
 * "not readable yet" with the exact blocker — and only ever show reviews
 * that came from a real (mocked here) provider response. */

const KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 32 zero bytes, base64
const T1='a'.repeat(32),T2='b'.repeat(32),U1='user-1',U2='user-2';

const baseEnv=(over:Record<string,unknown>={})=>({
 APP_ORIGIN:'https://mayor.mehyar.us',BETTER_AUTH_SECRET:'test-secret-at-least-32-characters-long',
 GOOGLE_CLIENT_ID:'gid',GOOGLE_CLIENT_SECRET:'gsecret',TOKEN_ENCRYPTION_KEY:KEY,
 GOOGLE_ENABLED_CAPABILITIES:'calendar_read,calendar_manage,gmail_read', // production today
 ...over,
}) as unknown as Env;

const enabledEnv=()=>baseEnv({GOOGLE_ENABLED_CAPABILITIES:'calendar_read,calendar_manage,business_reviews'});

interface GrantSpec{tenant:string;user:string;scopes:string[];selected:string[]}

function fakeDb(grants:GrantSpec[],roles:Record<string,string>){
 const cache=new Map<string,string>();
 const grantRows=grants.map((g,i)=>({
  id:`grant-${i}`,user_id:g.user,provider:'google',account_id:`acct-${i}`,tenant_scope:g.tenant,
  status:'authorized',key_version:1,authorization_revision:1,
  selected_capabilities:JSON.stringify(g.selected),granted_scopes:JSON.stringify(g.scopes),
  ciphertext:'', // filled by fixture builder when a live read is needed
 }));
 const db={
  prepare(sql:string){
   let bound:unknown[]=[];
   const stmt={
    bind(...args:unknown[]){bound=args;return stmt;},
    async first(){
     if(sql.includes('FROM agent_memberships')){
      const role=roles[`${bound[0]}:${bound[1]}`];
      return role?{tenant_id:bound[0],user_id:bound[1],role,status:'active',expires_at:null}:null;
     }
     if(sql.includes('FROM agent_tenants'))
      return roles[`${bound[0]}:${U1}`]||roles[`${bound[0]}:${U2}`]?{id:bound[0],name:'Biz',status:'active',created_at:'2026-01-01'}:null;
     if(sql.includes('SELECT * FROM auth_provider_grants'))
      return grantRows.find(g=>g.id===bound[0]&&g.tenant_scope===bound[1]&&g.provider===bound[2])??null;
     if(sql.includes('FROM mayor_gbp_snapshot')){
      const snapshot=cache.get(String(bound[0]));
      return snapshot?{snapshot_json:snapshot}:null;
     }
     return null;
    },
    async all(){
     if(sql.includes('FROM auth_provider_grants'))
      return {results:grantRows.filter(g=>g.tenant_scope===bound[0]&&g.user_id===bound[1]&&g.status!=='revoked')};
     return {results:[]};
    },
    async run(){
     if(sql.includes('INTO mayor_gbp_snapshot')){cache.set(String(bound[0]),String(bound[2]));return {meta:{changes:1}};}
     return {meta:{changes:0}};
    },
   };
   return stmt;
  },
 } as unknown as Env['AGENT_DB'];
 return {db,grantRows,cache};
}

async function liveGrantRow(rows:ReturnType<typeof fakeDb>['grantRows'],index:number,tenant:string,user:string){
 const row=rows[index];
 row.ciphertext=await encryptCredential({
  accountEmail:'owner@example.test',accessToken:'gbp-test-access-token',
  accessTokenExpiresAt:new Date(Date.now()+3600_000).toISOString(),
  grantedScopes:[GBP_BUSINESS_SCOPE],
 },{userId:user,provider:'google',accountId:row.account_id,tenantId:tenant},KEY);
 return row;
}

const roles={[`${T1}:${U1}`]:'owner',[`${T2}:${U2}`]:'owner',[`${T1}:staff-1`]:'staff'};

function providerTransport(status=200){
 const calls:string[]=[];
 const transport=(async(url:RequestInfo|URL)=>{
  const target=String(url);calls.push(target);
  if(status!==200)return new Response('{}',{status});
  if(target.includes('mybusinessaccountmanagement'))return Response.json({accounts:[{name:'accounts/123'}]});
  if(target.includes('mybusinessbusinessinformation'))return Response.json({locations:[{
   name:'locations/456',title:'Glow Studio',timeZone:'America/New_York',
   regularHours:{periods:[{openDay:'MONDAY',openTime:{hours:9,minutes:0},closeDay:'MONDAY',closeTime:{hours:17,minutes:30}},
    {openDay:'TUESDAY',openTime:{hours:9},closeDay:'TUESDAY',closeTime:{hours:17}}]},
  }]});
  if(target.includes('mybusiness.googleapis.com/v4/'))return Response.json({reviews:[
   {reviewer:{displayName:'Sam'},starRating:'FIVE',comment:'Great cut.',createTime:'2026-10-01T10:00:00Z',updateTime:'2026-10-02T10:00:00Z'},
   {reviewer:{displayName:'Jo'},starRating:'FOUR',comment:'Good.',createTime:'2026-10-03T10:00:00Z',updateTime:'2026-10-03T10:00:00Z'},
   {reviewer:{displayName:'Lee'},starRating:'THREE',comment:'Fine.',createTime:'2026-09-01T10:00:00Z',updateTime:'2026-09-01T10:00:00Z'},
  ]});
  throw new Error('unexpected url '+target);
 }) as typeof fetch;
 return {transport,calls};
}

describe('pure parsing + aggregation',()=>{
 it('maps star ratings and ignores unusable values',()=>{
  expect(starRatingValue('FIVE')).toBe(5);expect(starRatingValue('ONE')).toBe(1);
  expect(starRatingValue(4)).toBe(4);expect(starRatingValue('STAR_RATING_UNSPECIFIED')).toBeNull();
  expect(starRatingValue(0)).toBeNull();expect(starRatingValue('five')).toBeNull();
 });
 it('summarizes count, average and latest honestly',()=>{
  const reviews=[
   parseGbpReview({starRating:'FIVE',comment:'a',createTime:'2026-10-01T00:00:00Z',updateTime:'2026-10-01T00:00:00Z',reviewer:{displayName:'A'}})!,
   parseGbpReview({starRating:'FOUR',comment:'b',createTime:'2026-10-05T00:00:00Z',updateTime:'2026-10-05T00:00:00Z',reviewer:{displayName:'B'}})!,
   parseGbpReview({comment:'unrated',createTime:'2026-10-03T00:00:00Z',updateTime:'2026-10-03T00:00:00Z'})!,
  ];
  const s=summarizeGbpReviews(reviews);
  expect(s.count).toBe(3);
  expect(s.averageRating).toBe(4.5); // unrated review excluded from the average
  expect(s.latest?.comment).toBe('b');
  expect(summarizeGbpReviews([])).toEqual({count:0,averageRating:null,latest:null});
 });
 it('parses location hours from the businessinformation resource',()=>{
  const loc=parseGbpLocation({name:'locations/1',title:'Glow',timeZone:'America/New_York',
   regularHours:{periods:[{openDay:'MONDAY',openTime:{hours:9,minutes:5},closeTime:{hours:17}}]}});
  expect(loc).toMatchObject({name:'locations/1',title:'Glow',hours:[{day:'MONDAY',open:'09:05',close:'17:00'}]});
 });
});

describe('conductor honesty (P4 copy changes only when reads are really live)',()=>{
 const facts=(gbpReviewsLive:boolean)=>({
  profile:{name:'Glow Studio',industry:'Hair salon',vertical:'salon' as const,services:['Cuts'],locations:['Brooklyn'],hours:'Tue–Sat 9–6',timeZone:'America/New_York',staff:[],language:'en'},
  explicitRuleActions:[],tiers:[],connected:{calendar:true,phone:true,google_business:true},
  skippedConnections:[],rulesDecision:null,handoffAt:null,priority:['calendar','email','reviews'],gbpReviewsLive,
 });
 it('not live: P4 wording stands verbatim',()=>{
  const f=facts(false),state=deriveConductorState(f as never);
  expect(state.connections.find(c=>c.id==='google_business')?.unlocks).toMatch(/not live yet/);
  const summary=buildHandoffSummary(f as never,state);
  expect(summary.connections.find(c=>c.id==='google_business')?.note).toMatch(/not live yet/);
 });
 it('live only when the grant can succeed: copy flips, and only then',()=>{
  const f=facts(true),state=deriveConductorState(f as never);
  expect(state.connections.find(c=>c.id==='google_business')?.unlocks).toMatch(/read your reviews and hours/);
  const summary=buildHandoffSummary(f as never,state);
  expect(summary.connections.find(c=>c.id==='google_business')?.note).toMatch(/can read your Business Profile reviews and hours/);
  expect(summary.text).not.toMatch(/not live yet/);
 });
});

describe('availability ground truth',()=>{
 it('production config today: capability not enabled, exact blockers named',()=>{
  const a=gbpReviewsAvailability(baseEnv());
  expect(a.available).toBe(false);
  expect(a.reason).toBe('capability_not_enabled');
  expect(a.missing.join(' ')).toContain('business_reviews');
  expect(a.missing.join(' ')).toContain(GBP_BUSINESS_SCOPE);
  expect(a.missing).toContain(GBP_API_ACCESS_BLOCKER);
  expect(a.message).toMatch(/not readable yet/i);
 });
 it('no Google OAuth app: google_not_configured',()=>{
  const a=gbpReviewsAvailability(baseEnv({GOOGLE_CLIENT_ID:undefined,GOOGLE_CLIENT_SECRET:undefined}));
  expect(a.reason).toBe('google_not_configured');
  expect(a.missing).toContain('GOOGLE_CLIENT_ID');
 });
 it('enabled capability: config side available',()=>{
  expect(gbpReviewsAvailability(enabledEnv()).available).toBe(true);
 });
});

describe('refresh + status against mocked provider',()=>{
 it('prod-like env: refresh is an honest unavailable, never fabricated reviews',async()=>{
  const {db}=fakeDb([{tenant:T1,user:U1,scopes:['https://www.googleapis.com/auth/calendar.events'],selected:['calendar_manage']}],roles);
  const env={...baseEnv(),AGENT_DB:db} as Env;
  const r=await refreshGbpReviews(env,{tenantId:T1,userId:U1},providerTransport().transport);
  expect(r.live).toBe(false);
  expect(r.availability.reason).toBe('capability_not_enabled');
  expect(r.snapshot).toBeNull();
  const status=await getGbpReviews(env,{tenantId:T1,userId:U1});
  expect(status.live).toBe(false);expect(status.snapshot).toBeNull();expect(status.asOf).toBeNull();
  expect(await gbpReviewsCanSucceed(env,{tenantId:T1,userId:U1})).toBe(false);
 });
 it('enabled env but the grant lacks the business scope: scope_not_granted',async()=>{
  const {db}=fakeDb([{tenant:T1,user:U1,scopes:['https://www.googleapis.com/auth/calendar.events'],selected:['calendar_manage']}],roles);
  const env={...enabledEnv(),AGENT_DB:db} as Env;
  const r=await refreshGbpReviews(env,{tenantId:T1,userId:U1},providerTransport().transport);
  expect(r.live).toBe(false);
  expect(r.availability.reason).toBe('scope_not_granted');
  expect(r.availability.message).toMatch(/did not grant the Business Profile permission/i);
 });
 it('enabled + scoped grant + mocked APIs: real snapshot with reviews, hours, as-of',async()=>{
  const fixture=fakeDb([{tenant:T1,user:U1,scopes:[GBP_BUSINESS_SCOPE],selected:['business_reviews']}],roles);
  await liveGrantRow(fixture.grantRows,0,T1,U1);
  const env={...enabledEnv(),AGENT_DB:fixture.db} as Env;
  const actor={tenantId:T1,userId:U1};
  expect(await gbpReviewsCanSucceed(env,actor)).toBe(true);
  const {transport,calls}=providerTransport();
  const now=new Date('2026-10-12T15:00:00Z');
  const r=await refreshGbpReviews(env,actor,transport,now);
  expect(r.live).toBe(true);
  expect(r.asOf).toBe(now.toISOString());
  expect(r.snapshot?.reviews.count).toBe(3);
  expect(r.snapshot?.reviews.averageRating).toBe(4);
  expect(r.snapshot?.reviews.latest?.comment).toBe('Good.');
  expect(r.snapshot?.reviews.latest?.reviewerName).toBe('Jo');
  expect(r.snapshot?.locations[0]).toMatchObject({title:'Glow Studio',timeZone:'America/New_York'});
  expect(r.snapshot?.locations[0].hours[0]).toEqual({day:'MONDAY',open:'09:00',close:'17:30'});
  expect(calls.some(c=>c.includes('mybusiness.googleapis.com/v4/accounts/123/locations/456/reviews'))).toBe(true);
  expect(JSON.stringify(r)).not.toContain('gbp-test-access-token');
  // Cached read: served with the same as-of, no second provider call needed.
  const status=await getGbpReviews(env,actor);
  expect(status.live).toBe(true);
  expect(status.asOf).toBe(now.toISOString());
  expect(status.snapshot?.reviews.count).toBe(3);
 });
 it('tenant isolation: tenant B sees no snapshot and no grant from tenant A',async()=>{
  const fixture=fakeDb([{tenant:T1,user:U1,scopes:[GBP_BUSINESS_SCOPE],selected:['business_reviews']}],roles);
  await liveGrantRow(fixture.grantRows,0,T1,U1);
  const env={...enabledEnv(),AGENT_DB:fixture.db} as Env;
  await refreshGbpReviews(env,{tenantId:T1,userId:U1},providerTransport().transport);
  const other=await getGbpReviews(env,{tenantId:T2,userId:U2});
  expect(other.snapshot).toBeNull();
  expect(other.live).toBe(false);
  expect(other.availability.reason).toBe('grant_missing');
 });
 it('Google API 403 (access not approved): honest blocker, nothing cached',async()=>{
  const fixture=fakeDb([{tenant:T1,user:U1,scopes:[GBP_BUSINESS_SCOPE],selected:['business_reviews']}],roles);
  await liveGrantRow(fixture.grantRows,0,T1,U1);
  const env={...enabledEnv(),AGENT_DB:fixture.db} as Env;
  const r=await refreshGbpReviews(env,{tenantId:T1,userId:U1},providerTransport(403).transport);
  expect(r.live).toBe(false);
  expect(r.availability.reason).toBe('api_not_enabled_or_access_not_approved');
  expect(r.availability.missing).toContain(GBP_API_ACCESS_BLOCKER);
  expect(fixture.cache.size).toBe(0);
 });
 it('role gate: staff cannot refresh or read reviews',async()=>{
  const {db}=fakeDb([],roles);
  const env={...enabledEnv(),AGENT_DB:db} as Env;
  await expect(refreshGbpReviews(env,{tenantId:T1,userId:'staff-1'},providerTransport().transport)).rejects.toMatchObject({status:403});
  await expect(getGbpReviews(env,{tenantId:T1,userId:'staff-1'})).rejects.toMatchObject({status:403});
 });
});
