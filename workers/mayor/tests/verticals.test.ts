import {describe,it,expect} from 'vitest';
import {VERTICAL_PROFILES,verticalProfile,detectVerticalFromCategory,verticalSchema,ONBOARDING_QUESTIONS_FALLBACK,onboardingQuestionsFor} from '../src/verticals';

describe('vertical profiles',()=>{
 it('has 5 launch profiles plus other',()=>{
  expect(Object.keys(VERTICAL_PROFILES)).toEqual(['salon','restaurant','plumbing_hvac','dental','auto_repair','other']);
 });
 it('every profile has a text-back template with {business} and opt-out',()=>{
  for(const profile of Object.values(VERTICAL_PROFILES)){
   expect(profile.textbackTemplate).toContain('{business}');
   expect(profile.textbackTemplate).toContain('STOP');
   expect(profile.textbackTemplate.length).toBeLessThan(320);
  }
 });
 it('salon template is salon-aware',()=>{
  expect(VERTICAL_PROFILES.salon.textbackTemplate).toContain('appointment');
  expect(VERTICAL_PROFILES.salon.vocabulary.booking).toBe('appointment');
 });
 it('restaurant template is restaurant-aware',()=>{
  expect(VERTICAL_PROFILES.restaurant.textbackTemplate).toContain('table');
  expect(VERTICAL_PROFILES.restaurant.vocabulary.booking).toBe('reservation');
 });
 it('plumbing template asks about urgency',()=>{
  expect(VERTICAL_PROFILES.plumbing_hvac.textbackTemplate.toLowerCase()).toContain('urgent');
 });
 it('falls back to other for unknown vertical',()=>{
  expect(verticalProfile('nonsense').vertical).toBe('other');
  expect(verticalProfile(undefined).vertical).toBe('other');
  expect(verticalProfile(null).vertical).toBe('other');
 });
 it('detects vertical from Places category',()=>{
  expect(detectVerticalFromCategory('Hair Salon')).toBe('salon');
  expect(detectVerticalFromCategory('Barber Shop')).toBe('salon');
  expect(detectVerticalFromCategory('Italian Restaurant')).toBe('restaurant');
  expect(detectVerticalFromCategory('Plumber')).toBe('plumbing_hvac');
  expect(detectVerticalFromCategory('Dental Clinic')).toBe('dental');
  expect(detectVerticalFromCategory('Auto Repair Shop')).toBe('auto_repair');
  expect(detectVerticalFromCategory('Book Store')).toBeNull();
  expect(detectVerticalFromCategory(null)).toBeNull();
 });
 it('schema rejects unknown verticals',()=>{
  expect(verticalSchema.safeParse('salon').success).toBe(true);
  expect(verticalSchema.safeParse('spaceship').success).toBe(false);
 });
});

describe('crew4 enriched vertical profiles',()=>{
 it('every profile has all new fields populated',()=>{
  for(const profile of Object.values(VERTICAL_PROFILES)){
   expect(profile.detectorParams,'detectorParams '+profile.vertical).toBeDefined();
   expect(profile.detectorParams!.lapsedRegularDays).toBeGreaterThan(0);
   expect(profile.kpis!.length,'kpis '+profile.vertical).toBeGreaterThan(0);
   for(const kpi of profile.kpis!){
    expect(kpi.key.length).toBeGreaterThan(0);
    expect(kpi.label.length).toBeGreaterThan(0);
    expect(kpi.hint.length).toBeGreaterThan(0);
   }
   expect(profile.onboardingQuestions!.length,'onboardingQuestions '+profile.vertical).toBeGreaterThan(0);
   for(const q of profile.onboardingQuestions!){
    expect(q.field.length).toBeGreaterThan(0);
    expect(q.question.length).toBeGreaterThan(0);
   }
   expect(profile.connectorPriority!.length,'connectorPriority '+profile.vertical).toBeGreaterThan(0);
   for(const id of profile.connectorPriority!)expect(id.length).toBeGreaterThan(0);
   expect(profile.suggestionVoice!.length,'suggestionVoice '+profile.vertical).toBeGreaterThan(0);
   expect(profile.briefingNouns!.appointments.length).toBeGreaterThan(0);
   expect(profile.briefingNouns!.customers.length).toBeGreaterThan(0);
  }
 });
 it('detector params match vertical rhythms',()=>{
  expect(VERTICAL_PROFILES.salon.detectorParams).toMatchObject({lapsedRegularDays:56,rebookingCycleDays:42});
  expect(VERTICAL_PROFILES.restaurant.detectorParams).toMatchObject({lapsedRegularDays:45});
  expect(VERTICAL_PROFILES.restaurant.detectorParams!.rebookingCycleDays).toBeUndefined();
  expect(VERTICAL_PROFILES.plumbing_hvac.detectorParams).toMatchObject({lapsedRegularDays:365,afterHoursStart:'17:00',afterHoursEnd:'08:00'});
  expect(VERTICAL_PROFILES.dental.detectorParams).toMatchObject({lapsedRegularDays:180,rebookingCycleDays:180});
  expect(VERTICAL_PROFILES.auto_repair.detectorParams).toMatchObject({lapsedRegularDays:180});
 });
 it('briefing nouns read naturally per vertical',()=>{
  expect(VERTICAL_PROFILES.salon.briefingNouns).toEqual({appointments:'appointments',customers:'clients'});
  expect(VERTICAL_PROFILES.restaurant.briefingNouns).toEqual({appointments:'reservations',customers:'guests'});
  expect(VERTICAL_PROFILES.dental.briefingNouns).toEqual({appointments:'visits',customers:'patients'});
  expect(VERTICAL_PROFILES.plumbing_hvac.briefingNouns).toEqual({appointments:'jobs',customers:'customers'});
 });
 it('connector priority leads with real providers',()=>{
  expect(VERTICAL_PROFILES.salon.connectorPriority![0]).toBe('telnyx');
  expect(VERTICAL_PROFILES.salon.connectorPriority).toContain('google');
  expect(VERTICAL_PROFILES.restaurant.connectorPriority).toContain('opentable');
  expect(VERTICAL_PROFILES.plumbing_hvac.connectorPriority).toContain('telnyx');
 });
 it('detects vertical from Places category slugs',()=>{
  expect(detectVerticalFromCategory('hair_salon')).toBe('salon');
  expect(detectVerticalFromCategory('barber_shop')).toBe('salon');
  expect(detectVerticalFromCategory('plumbing')).toBe('plumbing_hvac');
  expect(detectVerticalFromCategory('dentist')).toBe('dental');
  expect(detectVerticalFromCategory('auto_repair_shop')).toBe('auto_repair');
  expect(detectVerticalFromCategory('restaurant')).toBe('restaurant');
  expect(detectVerticalFromCategory('pizzeria')).toBe('restaurant');
  expect(detectVerticalFromCategory('nail_salon')).toBe('salon');
 });
 it('fallback onboarding questions are the generic 7',()=>{
  expect(ONBOARDING_QUESTIONS_FALLBACK.length).toBe(7);
  expect(ONBOARDING_QUESTIONS_FALLBACK.map(q=>q.field)).toEqual(['name','industry','services','locations','hours','timeZone','staff']);
 });
 it('onboardingQuestionsFor returns profile questions or the fallback',()=>{
  const salon=onboardingQuestionsFor('salon');
  expect(salon.length).toBeGreaterThan(0);
  expect(salon[0].question.toLowerCase()).toContain('charge');
  const hvac=onboardingQuestionsFor('plumbing_hvac');
  expect(hvac.some(q=>q.field==='service_area')).toBe(true);
  const other=onboardingQuestionsFor('other');
  expect(other).toBe(ONBOARDING_QUESTIONS_FALLBACK);
  expect(onboardingQuestionsFor(undefined)).toBe(ONBOARDING_QUESTIONS_FALLBACK);
  expect(onboardingQuestionsFor('nonsense')).toBe(ONBOARDING_QUESTIONS_FALLBACK);
  expect(onboardingQuestionsFor(null)).toBe(ONBOARDING_QUESTIONS_FALLBACK);
 });
});
