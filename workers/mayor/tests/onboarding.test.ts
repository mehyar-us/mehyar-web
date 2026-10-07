import {it,expect} from 'vitest';
import {onboardingProgress,asksToResumeOnboarding,hoursExplicitlyUnknown,profileSavedReadback} from '../src/onboarding';
it('recognizes simple resume commands without swallowing mixed facts, negation or scheduling requests',()=>{
 for(const text of ['Continue onboarding','Please resume my onboarding.','Resume onboarding from my confirmed details. Ask one missing question.'])expect(asksToResumeOnboarding(text)).toBe(true);
 for(const text of ['Do not start onboarding','Continue onboarding, my name is Acme','Resume scheduling setup','What does onboarding mean?'])expect(asksToResumeOnboarding(text)).toBe(false);
});
it('starts without requiring a website or provider account',()=>{
 const result=onboardingProgress({});
 expect(result.nextQuestion).toBe('What is your business called?');
 expect(result.missing).not.toContain('website');expect(result.readback).toContain('website is optional');
});
it('defers explicitly unknown hours after saving without marking incomplete basics complete',()=>{
 const profile={name:'Studio',industry:'Design',services:['Design'],locations:['Online'],timeZone:'America/New_York',staff:[]};
 for(const text of ["I don't know our hours yet.",'Our hours are still unknown.'])expect(hoursExplicitlyUnknown(text)).toBe(true);
 expect(hoursExplicitlyUnknown('I know our hours: Monday nine to five.')).toBe(false);
 const result=profileSavedReadback(profile,true);
 expect(result).toContain('fill in your hours later');expect(result).not.toContain('available');expect(result).not.toContain('complete');
 expect(onboardingProgress(profile,['hours']).basicsComplete).toBe(false);
 expect(onboardingProgress(profile).missing).toEqual(['hours']);
 expect(profileSavedReadback({...profile,timeZone:undefined},true)).toContain('city or time zone');
 expect(profileSavedReadback({...profile,hours:'By appointment'},true)).toContain('details are complete');
});
it('resumes only confirmed populated facts and preserves unknowns',()=>{
 const result=onboardingProgress({name:'Agency',industry:'Consulting',services:['  '],locations:[]});
 expect(result.missing[0]).toBe('services');
 expect(result.missing).toContain('locations');expect(result.missing).not.toContain('name');
});
it('accepts an explicitly empty staff list and never equates profile basics with scheduling readiness',()=>{
 const profile={name:'Agency',industry:'Consulting',services:['Advice'],locations:['Online'],hours:'By appointment',timeZone:'America/New_York',staff:[]};
 const result=onboardingProgress(profile);
 expect(result.basicsComplete).toBe(true);expect(result.nextQuestion).toBeNull();
 expect(result.readback).toContain('Appointment rules and service connections are separate');
 expect(onboardingProgress({...profile,staff:undefined}).missing).toEqual(['staff']);
});
