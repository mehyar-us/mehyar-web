/**
 * engine-understanding.test.ts — Stage 3 deterministic parsers
 * (Slice 2, blueprint §1.1). The parsers settle what they can and
 * FLAG the rest — a turn they cannot fully determine comes back
 * deterministic:false, never guessed.
 */
import {describe,expect,it} from 'vitest';
import {parseUnderstanding,detectNeverGrantable,revocationClasses} from '../src/engine/understanding';

const talk = {mode:'talk' as const,pendingScenario:false};
const onboarding = {mode:'onboarding' as const,onboardingStage:'canvas',pendingScenario:false};

describe('Stage 3 — classification',()=>{
 it('classifies a standing rule as a grant statement',()=>{
  const u=parseUnderstanding('You can reschedule anyone who asks',talk);
  expect(u.intentClass).toBe('grant_statement');
  expect(u.actionClass).toBe('reschedule');
 });
 it('classifies the C-3 chip sentence as a grant statement',()=>{
  expect(parseUnderstanding('Reschedule anyone who asks',talk).intentClass).toBe('grant_statement');
 });
 it('classifies a one-sentence revocation',()=>{
  const u=parseUnderstanding('Stop texting people on your own',talk);
  expect(u.intentClass).toBe('revocation');
  expect(revocationClasses('Stop texting people on your own')).toContain('send_sms_reply');
 });
 it('classifies "never … again" as revocation',()=>{
  expect(parseUnderstanding('Never book anyone again without asking me',talk).intentClass).toBe('revocation');
 });
 it('does not mistake a NEVER line for a revocation',()=>{
  const u=parseUnderstanding('You can reschedule anyone, but never Mr. Ortiz',talk);
  expect(u.intentClass).toBe('grant_statement');
 });
 it('classifies audit questions',()=>{
  expect(parseUnderstanding('What did you do today?',talk).intentClass).toBe('audit_query');
  const why=parseUnderstanding('Why did you text Dana?',talk);
  expect(why.intentClass).toBe('audit_query');
  expect(why.targetPerson).toBe('Dana');
 });
 it('classifies connect-calendar',()=>{
  expect(parseUnderstanding('Connect my calendar',talk).intentClass).toBe('connect_calendar');
 });
 it('classifies corrections',()=>{
  expect(parseUnderstanding('Actually, we close at 6, not 7',talk).intentClass).toBe('correction');
 });
 it('classifies a relayed customer request as a customer act',()=>{
  const u=parseUnderstanding('Dana asked to move her appointment to Thursday',talk);
  expect(u.intentClass).toBe('customer_act');
  expect(u.actionClass).toBe('reschedule');
  expect(u.targetPerson).toBe('Dana');
 });
 it('classifies a direct instruction to one customer',()=>{
  const u=parseUnderstanding('Text Marcus that we are running late',talk);
  expect(u.intentClass).toBe('customer_act');
  expect(u.targetPerson).toBe('Marcus');
 });
 it('classifies the onboarding first line',()=>{
  expect(parseUnderstanding('Fresh Fade, barbershop, Bay Ridge',onboarding).intentClass).toBe('shop_intro');
 });
 it('classifies "everything needs my OK" as a first-class decline',()=>{
  const u=parseUnderstanding('Everything needs my OK for now',talk);
  expect(u.intentClass).toBe('onboarding_step');
  expect(u.ambiguities).toContain('owner_declined_grant');
 });
 it('flags unparseable act language as non-deterministic',()=>{
  const u=parseUnderstanding('Handle the thing with Dana like we discussed',talk);
  expect(u.deterministic).toBe(false);
 });
 it('resolves a bare ruling word only while a scenario is pending',()=>{
  const withPending=parseUnderstanding('Blocked',{mode:'talk',pendingScenario:true});
  expect(withPending.intentClass).toBe('scenario_ruling');
  expect(withPending.ruling).toBe('blocked');
  expect(parseUnderstanding('Blocked',talk).intentClass).not.toBe('scenario_ruling');
 });
});

describe('§1.3.5 — never-grantable detection',()=>{
 const cases:Array<[string,string]> = [
  ["Refund anyone who's unhappy",'refund'],
  ['Charge their card if they no-show','charge'],
  ['Give regulars 20% off without asking me','discount'],
  ['Sign whatever the landlord sends over','sign'],
  ['Delete old customer records every month','delete'],
  ['Reply to our Google reviews for me','post'],
 ];
 for(const [text] of cases){
  it(`declines: "${text}"`,()=>{
   const decline=detectNeverGrantable(text);
   expect(decline).toBeTruthy();
   expect(decline!.endsWith('.')).toBe(true);
   expect(decline!.split('. ').length).toBeLessThanOrEqual(2); // one sentence, maybe two clauses
  });
 }
 it('does not decline ordinary rules',()=>{
  expect(detectNeverGrantable('Reschedule anyone who asks')).toBeNull();
  expect(detectNeverGrantable('Text customers when their appointment changes')).toBeNull();
 });
});
