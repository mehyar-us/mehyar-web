import {describe,it,expect} from 'vitest';
import {HttpError} from '../src/http';
import {
 AUTHORITY_ACTIONS,AUTHORITY_TIERS,DEFAULT_AUTHORITY_TIER,
 authorityTierSetSchema,
 getAuthorityTier,getExplicitAuthorityTier,setAuthorityTier,listAuthorityTiers,
 effectiveTier,autoSendAllowed,
 TIER_LABELS,ACTION_LABELS,TIER_DESCRIPTIONS,
 type AuthorityAction,type AuthorityTier,
} from '../src/authority-tiers';
import {
 AUTHORITY_QUESTIONS,parseAuthorityAnswer,authorityOnboardingStep,
 authorityQuestionFor,authoritySavedCopy,
} from '../src/onboarding';

/** P1 authority tiers. The DB is an in-memory mock of the mayor_authority_tiers
 * table; tenant isolation is verified by keeping two tenants in the store. */

interface TierRow{tenant_id:string;action:string;tier:string;updated_at:string}
function mockDb(){
 const rows:TierRow[]=[];
 const db={
  prepare(sql:string){
   let bound:unknown[]=[];
   const stmt={
    bind(...args:unknown[]){bound=args;return stmt;},
    async run(){
     if(sql.startsWith('INSERT INTO mayor_authority_tiers')){
      const [tenant_id,action,tier,updated_at]=bound as [string,string,string,string];
      const existing=rows.find(r=>r.tenant_id===tenant_id&&r.action===action);
      if(existing){existing.tier=tier;existing.updated_at=updated_at;}
      else rows.push({tenant_id,action,tier,updated_at});
      return {meta:{changes:1}};
     }
     return {meta:{changes:0}};
    },
    async first(){
     if(sql.includes('FROM mayor_authority_tiers WHERE tenant_id=? AND action=?')){
      const [tenant_id,action]=bound as [string,string];
      const row=rows.find(r=>r.tenant_id===tenant_id&&r.action===action);
      return row?{tier:row.tier}:null;
     }
     return null;
    },
    async all(){
     if(sql.includes('FROM mayor_authority_tiers WHERE tenant_id=?')){
      const [tenant_id]=bound as [string];
      return {results:rows.filter(r=>r.tenant_id===tenant_id).map(r=>({action:r.action,tier:r.tier}))};
     }
     return {results:[]};
    },
   };
   return stmt;
  },
 } as unknown as Parameters<typeof getAuthorityTier>[0];
 return {db,rows};
}

const T1='t1'.padEnd(32,'0');
const T2='t2'.padEnd(32,'0');

describe('get/set/defaults',()=>{
 it('defaults to draft when unset',async()=>{
  const {db}=mockDb();
  for(const action of AUTHORITY_ACTIONS)
   expect(await getAuthorityTier(db,T1,action)).toBe('draft');
  expect(DEFAULT_AUTHORITY_TIER).toBe('draft');
 });
 it('stores and reads back a tier',async()=>{
  const {db}=mockDb();
  await setAuthorityTier(db,T1,'booking','auto','owner');
  expect(await getAuthorityTier(db,T1,'booking')).toBe('auto');
  // Other actions and tenants are untouched (tenant isolation).
  expect(await getAuthorityTier(db,T1,'textback')).toBe('draft');
  expect(await getAuthorityTier(db,T2,'booking')).toBe('draft');
 });
 it('upserts: a later set overwrites',async()=>{
  const {db}=mockDb();
  await setAuthorityTier(db,T1,'call','auto','manager');
  await setAuthorityTier(db,T1,'call','readonly','owner');
  expect(await getAuthorityTier(db,T1,'call')).toBe('readonly');
  expect((await listAuthorityTiers(db,T1)).filter(t=>t.action==='call')).toHaveLength(1);
 });
 it('rejects unknown actions and tiers',async()=>{
  const {db}=mockDb();
  await expect(setAuthorityTier(db,T1,'email' as AuthorityAction,'auto','owner')).rejects.toThrow();
  await expect(setAuthorityTier(db,T1,'booking','turbo' as AuthorityTier,'owner')).rejects.toThrow();
  await expect(getAuthorityTier(db,T1,'email' as AuthorityAction)).rejects.toThrow();
 });
 it('role-gates: owner/manager only',async()=>{
  const {db}=mockDb();
  await setAuthorityTier(db,T1,'booking','auto','owner');
  await setAuthorityTier(db,T1,'booking','auto','manager');
  for(const role of ['staff','viewer','billing']){
   try{await setAuthorityTier(db,T1,'textback','auto',role);expect.unreachable(`role ${role} should be rejected`);}
   catch(error){expect(error).toBeInstanceOf(HttpError);expect((error as HttpError).status).toBe(403);}
  }
  // Rejected writes change nothing.
  expect(await getAuthorityTier(db,T1,'textback')).toBe('draft');
 });
});

describe('explicit vs effective tiers',()=>{
 it('getExplicitAuthorityTier is null when unset',async()=>{
  const {db}=mockDb();
  expect(await getExplicitAuthorityTier(db,T1,'booking')).toBeNull();
  await setAuthorityTier(db,T1,'booking','readonly','owner');
  expect(await getExplicitAuthorityTier(db,T1,'booking')).toBe('readonly');
 });
 it('explicit always wins over the legacy toggle',()=>{
  expect(effectiveTier('suggestion_send','draft',true)).toBe('draft');
  expect(effectiveTier('suggestion_send','readonly',true)).toBe('readonly');
  expect(effectiveTier('textback','draft',true)).toBe('draft');
 });
 it('unset tier + liveSms true reads as auto for the send family only',()=>{
  expect(effectiveTier('suggestion_send',null,true)).toBe('auto');
  expect(effectiveTier('textback',null,true)).toBe('auto');
  expect(effectiveTier('booking',null,true)).toBe('draft');
  expect(effectiveTier('call',null,true)).toBe('draft');
 });
 it('unset tier + liveSms false reads as draft everywhere',()=>{
  for(const action of AUTHORITY_ACTIONS)expect(effectiveTier(action,null,false)).toBe('draft');
 });
 it('autoSendAllowed only for an explicit auto',()=>{
  expect(autoSendAllowed('auto')).toBe(true);
  expect(autoSendAllowed('draft')).toBe(false);
  expect(autoSendAllowed('readonly')).toBe(false);
  expect(autoSendAllowed(null)).toBe(false);
 });
 it('listAuthorityTiers reports explicit flags',async()=>{
  const {db}=mockDb();
  await setAuthorityTier(db,T1,'booking','auto','owner');
  const list=await listAuthorityTiers(db,T1);
  expect(list).toHaveLength(4);
  const booking=list.find(t=>t.action==='booking')!;
  expect(booking).toMatchObject({tier:'auto',explicit:true});
  expect(list.find(t=>t.action==='call')).toMatchObject({tier:'draft',explicit:false});
 });
 it('set schema validates the API payload shape',()=>{
  expect(authorityTierSetSchema.parse({action:'booking',tier:'auto'})).toEqual({action:'booking',tier:'auto'});
  expect(()=>authorityTierSetSchema.parse({action:'booking',tier:'turbo'})).toThrow();
  expect(()=>authorityTierSetSchema.parse({action:'booking'})).toThrow();
 });
});

describe('tier contract',()=>{
 it('covers the four actions and three tiers',()=>{
  expect([...AUTHORITY_ACTIONS].sort()).toEqual(['booking','call','suggestion_send','textback']);
  expect([...AUTHORITY_TIERS].sort()).toEqual(['auto','draft','readonly']);
 });
 it('uses plain-language labels (no jargon)',()=>{
  expect(TIER_LABELS).toEqual({readonly:'Ask me first',draft:'Draft for my approval',auto:'Act automatically'});
  expect(ACTION_LABELS.booking).toBe('Booking appointments');
  expect(ACTION_LABELS.suggestion_send).toBe('Sending suggestion texts');
  // Every action × tier has an honest description.
  for(const action of AUTHORITY_ACTIONS)
   for(const tier of AUTHORITY_TIERS)
    expect(TIER_DESCRIPTIONS[action][tier].length).toBeGreaterThan(10);
 });
});

describe('onboarding "Set the rules"',()=>{
 it('asks the three questions in order',()=>{
  expect(AUTHORITY_QUESTIONS).toHaveLength(3);
  expect(AUTHORITY_QUESTIONS.map(q=>q.action)).toEqual(['booking','suggestion_send','textback']);
  expect(AUTHORITY_QUESTIONS[0].question).toMatch(/book it straight away/i);
 });
 it('parses auto answers',()=>{
  for(const text of ['Book it straight away','Yes, just do it','Go ahead automatically','I trust you — handle it'])
   expect(parseAuthorityAnswer(text)).toBe('auto');
 });
 it('parses draft answers',()=>{
  for(const text of ['Check with me first','Ask me first please','Run it by me','Draft it and wait for my approval','Let me review first'])
   expect(parseAuthorityAnswer(text)).toBe('draft');
 });
 it('parses readonly answers',()=>{
  for(const text of ['Never book anything','Do not send texts','No bookings, please'])
   expect(parseAuthorityAnswer(text)).toBe('readonly');
 });
 it('returns null instead of guessing',()=>{
  expect(parseAuthorityAnswer('')).toBeNull();
  expect(parseAuthorityAnswer('maybe later')).toBeNull();
  expect(parseAuthorityAnswer('sounds good')).toBeNull();
 });
 it('steps through unset actions only',()=>{
  expect(authorityOnboardingStep([])?.action).toBe('booking');
  expect(authorityOnboardingStep(['booking'])?.action).toBe('suggestion_send');
  expect(authorityOnboardingStep(['booking','suggestion_send'])?.action).toBe('textback');
  expect(authorityOnboardingStep(['booking','suggestion_send','textback'])).toBeNull();
 });
 it('saved copy is honest about what happens next',()=>{
  expect(authoritySavedCopy('booking','auto')).toMatch(/on my own/i);
  expect(authoritySavedCopy('booking','draft')).toMatch(/wait for your approval/i);
  expect(authoritySavedCopy('booking','readonly')).toMatch(/entirely to you/i);
  expect(authorityQuestionFor('booking')).toBe(AUTHORITY_QUESTIONS[0].question);
 });
});
