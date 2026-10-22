import {describe,it,expect} from 'vitest';
import {VERTICAL_PROFILES,verticalProfile,detectVerticalFromCategory,verticalSchema} from '../src/verticals';
import {growthMetricsInstruction} from '../src/assistant-persona';

describe('crew6a: new verticals ship',()=>{
 it('schema accepts pet_grooming and med_spa, still rejects unknowns',()=>{
  expect(verticalSchema.safeParse('pet_grooming').success).toBe(true);
  expect(verticalSchema.safeParse('med_spa').success).toBe(true);
  expect(verticalSchema.safeParse('spaceship').success).toBe(false);
  expect(Object.keys(VERTICAL_PROFILES)).toEqual(['salon','restaurant','plumbing_hvac','dental','auto_repair','pet_grooming','med_spa','other']);
 });
 it('verticalProfile resolves the new values',()=>{
  expect(verticalProfile('pet_grooming').label).toBe('Pet grooming salon');
  expect(verticalProfile('med_spa').label).toBe('Med spa');
 });
});

describe('crew6a: pet_grooming profile',()=>{
 const p=()=>VERTICAL_PROFILES.pet_grooming;
 it('uses grooming vocabulary',()=>{
  expect(p().vocabulary).toEqual({customer:'client',booking:'appointment',staff:'groomer',service:'service'});
  expect(p().briefingNouns).toEqual({appointments:'appointments',customers:'clients'});
 });
 it('carries grooming-tuned detector params',()=>{
  expect(p().detectorParams).toMatchObject({lapsedRegularDays:70,rebookingCycleDays:49,noShowLookbackDays:90});
 });
 it('carries grooming KPIs',()=>{
  expect(p().kpis!.map(k=>k.key)).toEqual(['rebooking_rate','table_utilization','avg_ticket']);
  expect(p().kpis![1].label).toBe('Table utilization');
 });
 it('SMS templates have business placeholder, opt-out, and fit in a text',()=>{
  for(const t of [p().textbackTemplate,p().reminderTemplate]){
   expect(t).toContain('{business}');
   expect(t.length).toBeLessThan(320);
  }
  expect(p().textbackTemplate).toContain('STOP');
  expect(p().textbackTemplate).toContain('grooming');
  expect(p().textbackConfirmTemplate.length).toBeGreaterThan(0);
 });
 it('connector priority leads with real providers then grooming books',()=>{
  expect(p().connectorPriority!.slice(0,4)).toEqual(['telnyx','twilio','google','google-business']);
  expect(p().connectorPriority).toContain('moego');
  expect(p().connectorPriority).toContain('groomore');
  expect(p().connectorPriority).toContain('123pet');
 });
 it('onboarding asks about services, staff, breed/size pricing, dead days, hours',()=>{
  const fields=p().onboardingQuestions!.map(q=>q.field);
  expect(fields).toEqual(['services','staff','pricing_rules','dead_days','hours']);
  expect(p().onboardingQuestions![2].question.toLowerCase()).toContain('breed');
 });
 it('suggestion voice is warm',()=>{
  expect(p().suggestionVoice!.toLowerCase()).toContain('warm');
 });
});

describe('crew6a: med_spa profile',()=>{
 const p=()=>VERTICAL_PROFILES.med_spa;
 it('uses med-spa vocabulary',()=>{
  expect(p().vocabulary).toEqual({customer:'client',booking:'appointment',staff:'provider',service:'treatment'});
  expect(p().briefingNouns).toEqual({appointments:'appointments',customers:'clients'});
 });
 it('carries no-show-tuned detector params',()=>{
  expect(p().detectorParams).toMatchObject({lapsedRegularDays:120,rebookingCycleDays:90,noShowLookbackDays:90});
 });
 it('no-show KPI has teeth about the dollar cost',()=>{
  const noShow=p().kpis!.find(k=>k.key==='no_show_rate');
  expect(noShow).toBeDefined();
  expect(noShow!.hint).toContain('$400');
  expect(p().kpis!.map(k=>k.key)).toEqual(['rebooking_rate','room_utilization','avg_ticket','no_show_rate']);
 });
 it('SMS templates are polished, never chirpy',()=>{
  for(const t of [p().textbackTemplate,p().textbackConfirmTemplate,p().reminderTemplate]){
   expect(t.length).toBeGreaterThan(0);
   expect(t.length).toBeLessThan(320);
  }
  expect(p().textbackTemplate).toContain('{business}');
  expect(p().textbackTemplate).toContain('STOP');
  expect(p().textbackTemplate.toLowerCase()).not.toContain('!');
  expect(p().reminderTemplate).toContain('treatment');
 });
 it('connector priority leads with real providers then med-spa books',()=>{
  expect(p().connectorPriority!.slice(0,4)).toEqual(['telnyx','twilio','google','google-business']);
  expect(p().connectorPriority).toContain('zenoti');
  expect(p().connectorPriority).toContain('boulevard');
  expect(p().connectorPriority).toContain('mangomint');
 });
 it('onboarding covers treatments, providers, memberships, no-show policy, hours',()=>{
  expect(p().onboardingQuestions!.map(q=>q.field)).toEqual(['treatments','staff','memberships','no_show_policy','hours']);
  expect(p().onboardingQuestions![3].question.toLowerCase()).toContain('no-show');
 });
 it('suggestion voice is calm premium, never chirpy',()=>{
  expect(p().suggestionVoice!.toLowerCase()).toContain('calm');
  expect(p().suggestionVoice!.toLowerCase()).toContain('chirpy');
 });
});

describe('crew6a: Places detection for the new verticals',()=>{
 it('maps grooming categories',()=>{
  expect(detectVerticalFromCategory('Pet Groomer')).toBe('pet_grooming');
  expect(detectVerticalFromCategory('dog grooming')).toBe('pet_grooming');
  expect(detectVerticalFromCategory('pet_salon')).toBe('pet_grooming');
  expect(detectVerticalFromCategory('Pet Grooming')).toBe('pet_grooming');
 });
 it('maps med-spa categories',()=>{
  expect(detectVerticalFromCategory('Med Spa')).toBe('med_spa');
  expect(detectVerticalFromCategory('medical spa')).toBe('med_spa');
  expect(detectVerticalFromCategory('Botox Clinic')).toBe('med_spa');
  expect(detectVerticalFromCategory('laser hair removal')).toBe('med_spa');
 });
 it('existing verticals keep winning their own categories',()=>{
  expect(detectVerticalFromCategory('Hair Salon')).toBe('salon');
  // nail salon routes through the honest suggestion now (loop-1 fix)
  expect(detectVerticalFromCategory('nail salon')).toBeNull();
  expect(detectVerticalFromCategory('Pet Grooming')).not.toBe('salon');
 });
});

describe('crew6a: growthMetricsInstruction names the new metrics',()=>{
 it('pet_grooming growth question names rebooking rate, table utilization, average ticket',()=>{
  const instruction=growthMetricsInstruction({vertical:'pet_grooming'},'how do we grow the business this quarter?');
  expect(instruction).not.toBeNull();
  expect(instruction!).toContain('Rebooking rate');
  expect(instruction!).toContain('Table utilization');
  expect(instruction!).toContain('Average ticket');
  expect(instruction!).toContain('groomer');
 });
 it('med_spa growth question names the no-show KPI with its teeth',()=>{
  const instruction=growthMetricsInstruction({vertical:'med_spa'},'what should we track and measure?');
  expect(instruction).not.toBeNull();
  expect(instruction!).toContain('No-show rate');
  expect(instruction!).toContain('$400');
  expect(instruction!).toContain('Rebooking rate');
  expect(instruction!).toContain('Room utilization');
  expect(instruction!).toContain('provider');
 });
 it('still returns null for non-growth messages and unset verticals',()=>{
  expect(growthMetricsInstruction({vertical:'pet_grooming'},'what time do we open?')).toBeNull();
  expect(growthMetricsInstruction({vertical:'other'},'how do we grow?')).toBeNull();
  expect(growthMetricsInstruction({},'how do we grow?')).toBeNull();
 });
});
