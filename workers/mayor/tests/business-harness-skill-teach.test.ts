import {describe,it,expect} from 'vitest';
import {asksHarnessRule,asksHarnessChange,inferHarnessSkillTools,harnessToolAvailable,harnessActionTools} from '../src/business-harness-voice';

describe('plain-language skill teaching',()=>{
 it('detects taught standing rules',()=>{
  for(const text of [
   'When a VIP customer calls, always confirm the booking type',
   'always confirm the booking type before quoting',
   'From now on, send a confirmation text for every booking',
   'Make it a rule: check open tasks before quoting',
   'Set this rule: always ask for the appointment type first',
   'Whenever a new customer books, send them a confirmation text',
   'Every time we get a bad review, flag it for me',
   'Never forget to log callbacks at the end of the day',
   'Remember to always greet regulars by name',
  ])expect(asksHarnessRule(text),text).toBe(true);
 });
 it('does not fire on negations, questions, lookups or advice',()=>{
  for(const text of [
   "Don't always do that",
   'Do not make it a rule to call customers',
   'Never make it a rule',
   'Should I always confirm bookings?',
   'What are my skills?',
   'Show my saved rules',
   'Yes',
   'It would help to always follow up',
   'Maybe we should always offer discounts',
   'I always come on Mondays',
   'Our hours are always 9 to 5',
   'always do it',
   'Help me grow my business',
  ])expect(asksHarnessRule(text),text).toBe(false);
 });
 it('routes taught rules to proposeAgentSkill through the normal gates',()=>{
  const text='When a VIP customer calls, always confirm the booking type';
  expect(asksHarnessChange('skill',text)).toBe(true);
  expect(asksHarnessChange('goal',text)).toBe(false);
  expect(asksHarnessChange('config',text)).toBe(false);
  expect(harnessToolAvailable('proposeAgentSkill',text)).toBe(true);
  expect(harnessToolAvailable('proposeAgentGoal',text)).toBe(false);
  expect(harnessActionTools(text)).toEqual(['reply','readBusinessAgent','proposeAgentSkill']);
 });
 it('keeps explicit skill-word requests working as before',()=>{
  expect(asksHarnessChange('skill','Create a skill for preparing a weekly handoff')).toBe(true);
  expect(asksHarnessChange('skill',"Don't restore this skill")).toBe(false);
 });
});

describe('deterministic allowed-tools inference',()=>{
 it('maps rule keywords to read tools',()=>{
  expect(inferHarnessSkillTools('always confirm the booking type')).toEqual(['bookings','calendar_openings']);
  expect(inferHarnessSkillTools('check open tasks before quoting')).toEqual(['tasks']);
  expect(inferHarnessSkillTools('when a customer calls mention their name')).toEqual(['customers']);
  expect(inferHarnessSkillTools('read my inbox for urgent mail')).toEqual(['gmail_unread']);
  expect(inferHarnessSkillTools('track my sales goals')).toEqual(['goals']);
  expect(inferHarnessSkillTools('review the business profile hours')).toEqual(['profile']);
 });
 it('defaults to the safest read pair',()=>{
  expect(inferHarnessSkillTools('always greet regulars by name')).toEqual(['profile','tasks']);
  expect(inferHarnessSkillTools('make it a rule')).toEqual(['profile','tasks']);
 });
 it('dedupes and stays within the schema bound',()=>{
  const tools=inferHarnessSkillTools('whenever a customer books an appointment check tasks and goals and inbox and profile and connectors and openings');
  expect(new Set(tools).size).toBe(tools.length);
  expect(tools.length).toBeLessThanOrEqual(8);
 });
});
