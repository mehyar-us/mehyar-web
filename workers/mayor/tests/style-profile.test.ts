import {describe,it,expect} from 'vitest';
import {deriveStyleProfile,applyGreetingStyle,styleSourceDetail,type StyleProfile} from '../src/style-profile';

/* Harness slice 2a — the twin (2026-10-17): the deterministic
 * style profile + the greeting adoption rule. */
describe('deriveStyleProfile',()=>{
 it('measures lengths, greeting dominance and rates from the corpus',()=>{
  const p=deriveStyleProfile([
   'Hey Maria, running 10 late today — sorry! We will take care of you.',
   'Hey Tom, your appointment is confirmed for Friday!',
   'Hey Ana, thanks for coming in — see you next month.',
  ],'2026-10-17T00:00:00Z');
  expect(p.samples).toBe(3);
  expect(p.greeting?.toLowerCase()).toContain('hey');
  expect(p.greetingShare).toBe(1);
  expect(p.exclamationRate).toBeGreaterThan(0.6);
  expect(p.contractionRate).toBe(0); // 'will'/'see' — no contractions in these samples
  expect(p.medianWords).toBeGreaterThanOrEqual(8);
  expect(p.language).toBe('en');
  expect(p.exemplars).toHaveLength(3);
 });
 it('detects Spanish from marker-word share',()=>{
  const p=deriveStyleProfile(['Hola Maria, gracias por tu mensaje. Tu cita es el viernes.','Hola Juan, tu cita esta confirmada, gracias.'],'2026-10-17T00:00:00Z');
  expect(p.language).toBe('es');
  expect(p.greeting?.toLowerCase()).toContain('hola');
 });
 it('an empty corpus yields an empty profile, never invented facts',()=>{
  const p=deriveStyleProfile([],'2026-10-17T00:00:00Z');
  expect(p.samples).toBe(0);
  expect(p.greeting).toBeNull();
  expect(p.medianWords).toBeNull();
  expect(p.language).toBeNull();
 });
});

describe('applyGreetingStyle',()=>{
 const profile:StyleProfile={samples:5,medianWords:10,medianSentenceWords:6,greeting:'Hey there',greetingShare:0.8,emojiRate:0,exclamationRate:0.6,contractionRate:0.4,language:'en',exemplars:[],updatedAt:'2026-10-17T00:00:00Z'};
 it("swaps a template 'Hi' for the owner's dominant greeting",()=>{
  expect(applyGreetingStyle("Hi {name}, it's Glow Studio! We missed your call.",profile)).toBe("Hey {name}, it's Glow Studio! We missed your call.");
 });
 it('never swaps below the evidence bar',()=>{
  expect(applyGreetingStyle('Hi {name}, hi.',{...profile,samples:2})).toContain('Hi ');
  expect(applyGreetingStyle('Hi {name}, hi.',{...profile,greetingShare:0.4})).toContain('Hi ');
  expect(applyGreetingStyle('Hi {name}, hi.',null)).toContain('Hi ');
 });
 it('leaves non-greeting openings and matching greetings untouched',()=>{
  expect(applyGreetingStyle('Good news — a spot opened up.',profile)).toBe('Good news — a spot opened up.');
  expect(applyGreetingStyle('Hey {name}, hi.',profile)).toBe('Hey {name}, hi.');
 });
 it('the brief rendering states facts and quotes the owner, nothing else',()=>{
  const detail=styleSourceDetail({...profile,exemplars:['Hey Maria, running late!']});
  expect(detail).toContain('learned from 5 of their own messages');
  expect(detail).toContain('"Hey Maria, running late!"');
 });
});
