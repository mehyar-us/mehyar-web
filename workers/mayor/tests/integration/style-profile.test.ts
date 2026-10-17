import {env as testEnv} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {confirmProfile} from '../../src/memory';
import {runDetectors} from '../../src/proactive-detectors';
import {createSuggestionCard,editSuggestionCard} from '../../src/proactive';
import {readStyleProfile,getStyleState,saveOnboardingSamples,dismissStyleOnboarding} from '../../src/style-profile';

const env=testEnv as unknown as Env;
const TZ='America/New_York';
const NOW=Date.parse('2026-10-08T12:00:00Z');

async function fixture(){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)')
  .bind(actor.tenantId,'Twin fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')")
  .bind(actor.tenantId,actor.userId).run();
 await confirmProfile(env,actor,{name:'Twin Salon',vertical:'salon',timeZone:TZ},0);
 return actor;
}
async function addMissedCall(tenantId:string,caller:string){
 const id=crypto.randomUUID();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_missed_calls(id,tenant_id,caller_number,business_number,occurred_at,source,status,textback_sent_at)
  VALUES(?,?,?,?,?,'test','missed',NULL)`)
  .bind(id,tenantId,caller,'+17477772687',new Date(NOW-20*60000).toISOString()).run();
}
async function draftFor(actor:{tenantId:string;userId:string},caller:string){
 await addMissedCall(actor.tenantId,caller);
 const {context,created}=await runDetectors(env,actor.tenantId,NOW);
 const det=created.find(d=>d.detector==='missed_call_followup');
 expect(det).toBeDefined();
 const card=await createSuggestionCard(env,context,det!);
 expect(card).not.toBeNull();
 return card!;
}
async function sampleCount(tenantId:string){
 const row=await env.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM mayor_style_samples WHERE tenant_id=?').bind(tenantId).first<{n:number}>();
 return row?.n??0;
}

describe('twin corpus + profile (slice 2a)',()=>{
 it('card edits become samples; the profile learns the owner greeting; new drafts adopt it',async()=>{
  const actor=await fixture();
  const card=await draftFor(actor,'+17185550001');
  await editSuggestionCard(env,actor,card.id,'Hey there! Sorry we missed your call — want me to book you in?');
  await editSuggestionCard(env,actor,card.id,'Hey hey! Sorry we missed your call — want me to book you in?');
  await editSuggestionCard(env,actor,card.id,'Hey! Sorry we missed your call — want me to book you in?');
  expect(await sampleCount(actor.tenantId)).toBe(3);
  const profile=await readStyleProfile(env,actor.tenantId);
  expect(profile?.samples).toBe(3);
  expect(profile?.greeting?.toLowerCase()).toContain('hey');
  // A fresh card for this tenant now opens the owner's way.
  const next=await draftFor(actor,'+17185550002');
  expect(next.draft.message.startsWith('Hey')).toBe(true);
 });

 it('editing with the same words twice stores one sample',async()=>{
  const actor=await fixture();
  const card=await draftFor(actor,'+17185550003');
  await editSuggestionCard(env,actor,card.id,'Hey! Same words here.');
  await editSuggestionCard(env,actor,card.id,'Hey! Same words here.');
  expect(await sampleCount(actor.tenantId)).toBe(1);
 });

 it('onboarding capture (2b): samples land, the greeting is adopted, dismissal persists',async()=>{
  const actor=await fixture();
  expect(await getStyleState(env,actor)).toEqual({totalSamples:0,onboardingSamples:0,dismissed:false,greetingAdopted:false});
  const saved=await saveOnboardingSamples(env,actor,[
   'Hey! Sorry we missed your call — want me to book you in?',
   'Hey there! Just a reminder about tomorrow.',
   'Hey! Thanks so much for coming in.',
  ]);
  expect(saved.onboardingSamples).toBe(3);
  expect(saved.totalSamples).toBe(3);
  expect(saved.greetingAdopted).toBe(true);
  const dismissed=await dismissStyleOnboarding(env,actor);
  expect(dismissed.dismissed).toBe(true);
  expect((await getStyleState(env,actor)).dismissed).toBe(true);
 });

 it('onboarding endpoints reject non-members',async()=>{
  const actor=await fixture();
  const stranger={tenantId:actor.tenantId,userId:crypto.randomUUID()};
  await expect(getStyleState(env,stranger)).rejects.toThrow();
  await expect(saveOnboardingSamples(env,stranger,['Hey! A perfectly fine sample.'])).rejects.toThrow();
 });

 it("isolation: another tenant's corpus never leaks into this tenant's drafts",async()=>{
  const a=await fixture();
  const b=await fixture();
  const cardA=await draftFor(a,'+17185550004');
  for(const text of ['Hey one! Book you in?','Hey two! Book you in?','Hey three! Book you in?'])
   await editSuggestionCard(env,a,cardA.id,text);
  expect((await readStyleProfile(env,a.tenantId))?.greeting?.toLowerCase()).toContain('hey');
  expect(await readStyleProfile(env,b.tenantId)).toBeNull();
  const cardB=await draftFor(b,'+17185550005');
  expect(cardB.draft.message.startsWith('Hey')).toBe(false);
 });
});
