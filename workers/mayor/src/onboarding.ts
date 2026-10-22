import type {Profile} from './memory';
import {confirmProfile} from './memory';
import type {Actor,Env} from './env';
import {detectVerticalFromCategory} from './verticals';
import * as verticals from './verticals';
import type {Vertical} from './verticals';
import type {PlaceCard} from './places';
import {assessFit,fitAnswersFromProfile,honestFitMessage,type FitAssessment} from './fit-check';

/** Only unambiguous commands; mixed requests still go through the conversation model. */
export function asksToResumeOnboarding(text:string){
 const normalized=text.trim().toLowerCase().replace(/[.!?]+$/,'');
 return /^(?:please )?(?:start|continue|resume)(?: my| business)? onboarding$/.test(normalized)
  || normalized==='resume onboarding from my confirmed details. ask one missing question';
}

const questions = [
 ['name','What is your business called?'],
 ['industry','What kind of business do you run?'],
 ['services','What services or products do you offer?'],
 ['locations','Where do you serve customers? You can describe a location, service area, or an online business.'],
 ['hours','When is your business available to customers? You can describe your hours in your own words.'],
 ['timeZone','What city or time zone should I use for your business hours?'],
 ['staff','Who works with customers? If you work alone, you can just say so.'],
] as const;

/** Resume from confirmed facts only; website and provider connections are optional. */
export function onboardingProgress(profile:Partial<Profile>,deferred:readonly string[]=[]){
 const missing=questions.filter(([field])=>{
  const value=profile[field];
  if(Array.isArray(value))return field==='staff'?value.some(v=>!v.trim()):!value.some(v=>v.trim());
  return typeof value!=='string'||!value.trim();
 }).map(([field])=>field);
 const next=questions.find(([field])=>missing.includes(field)&&!deferred.includes(field));
 return {
  missing,basicsComplete:missing.length===0,
  nextQuestion:next?.[1]??null,
  readback:next?`We can build your profile by talking; a website is optional. ${next[1]}`:missing.length?'We can return to the missing details later. What would you like help with next?':'Your basic business details are saved. Appointment rules and service connections are separate; what would you like to set up next?',
 };
}

/** Conversational deferral only: never writes placeholder hours or activates rules. */
export function hoursExplicitlyUnknown(text:string){
 return /\b(?:don['’]t|do not) know (?:our |my |the )?(?:business )?hours\b|\bhours (?:are |is )?(?:still )?unknown\b/i.test(text);
}

export function profileSavedReadback(profile:Partial<Profile>,deferHours=false){
 const progress=onboardingProgress(profile,deferHours?['hours']:[]);
 const intro=deferHours&&progress.missing.includes('hours')?'Saved. We can fill in your hours later.':'Saved.';
 if(progress.nextQuestion)return `${intro} ${progress.nextQuestion}`;
 return progress.basicsComplete?`${intro} Your basic business details are complete. Would you like to set up appointment rules or connect a calendar next?`:`${intro} What would you like help with next?`;
}

/* ------------------------------------------------------------------ */
/* Crew 4 — Google Places onboarding: "Is this you?" step + vertical   */
/* follow-ups. Pure functions; the worker routes in index.ts do the I/O.*/
/* ------------------------------------------------------------------ */

export interface PlaceConfirmCardData{
 title:'Is this you?';
 placeId:string;
 name:string;
 photoUrl:string;
 address:string;
 /** Newline-joined weekday hours for the card. */
 hoursSummary:string;
 phone:string;
}

/** Card data for the "Is this you?" confirmation card. */
export function buildPlaceConfirmCard(place:PlaceCard):PlaceConfirmCardData{
 return {
  title:'Is this you?',
  placeId:place.placeId,
  name:place.name,
  photoUrl:place.photoUrl,
  address:place.address,
  hoursSummary:place.hours.join('\n'),
  phone:place.phone,
 };
}

const VERTICAL_CONFIRM_LABELS:Record<Exclude<Vertical,'other'>,string>={
 salon:'hair salon',
 restaurant:'restaurant',
 plumbing_hvac:'plumbing/HVAC shop',
 dental:'dental office',
 auto_repair:'auto repair shop',
 pet_grooming:'pet grooming salon',
 med_spa:'med spa',
};

export const VERTICAL_CONFIRM_FOLLOWUPS:Record<Exclude<Vertical,'other'>,string>={
 salon:'cuts, color, or both?',
 restaurant:'dine-in, takeout, or both?',
 plumbing_hvac:'residential, commercial, or both?',
 dental:'general, cosmetic, or both?',
 auto_repair:'repairs, maintenance, or both?',
 pet_grooming:'dogs, cats, or both?',
 med_spa:'tox, laser, or both?',
};

export interface PlaceConfirmPatch{
 name:string;
 address:string;
 phone:string;
 /** Newline-joined weekday hours — fits profile.hours (a single string). */
 hours:string;
 vertical:Vertical|null;
 /** Set when a vertical was detected, e.g. "So you're a hair salon — cuts, color, or both?" */
 followUpQuestion:string|null;
}

/** Google primary types use underscores ("hair_salon"); the vertical hints in
 * verticals.ts use spaces ("hair salon"). Normalize before detection. */
export function normalizePlaceCategory(category:string|undefined|null):string{
 return (category??'').toLowerCase().replace(/_/g,' ').trim();
}

const verticalArticle=(label:string)=>/^[aeiou]/i.test(label)?'an':'a';

/**
 * Build the profile patch from a confirmed Place. Vertical comes from
 * detectVerticalFromCategory(normalized place.category); unknown categories
 * → null and no follow-up question, so the generic question flow takes over.
 */
export function confirmPlace(profile:Partial<Profile>,place:PlaceCard):PlaceConfirmPatch{
 const vertical=detectVerticalFromCategory(normalizePlaceCategory(place.category));
 const followUpQuestion=vertical&&vertical!=='other'
  ?`So you're ${verticalArticle(VERTICAL_CONFIRM_LABELS[vertical])} ${VERTICAL_CONFIRM_LABELS[vertical]} — ${VERTICAL_CONFIRM_FOLLOWUPS[vertical]}`
  :null;
 return {
  name:place.name||profile.name||'',
  address:place.address,
  phone:place.phone,
  hours:place.hours.join('\n'),
  vertical,
  followUpQuestion,
 };
}

/* ------------------------------------------------------------------ */
/* Vertical-aware question sets for post-places onboarding.            */
/* ------------------------------------------------------------------ */

type QuestionSet=readonly (readonly [field:string,question:string])[];

const VERTICAL_ONBOARDING_QUESTIONS:Record<string,QuestionSet>={
 salon:[
  ['services','What services do you offer — cuts, color, treatments?'],
  ['staff','Who are your stylists? First names are fine — or just say it is only you.'],
  ['hours','When is the salon open for clients?'],
  ['locations','Where is the salon? A street or neighborhood is enough.'],
  ['timeZone','What city or time zone should I use for your hours?'],
  ['appointmentTypes','How long is a typical appointment — 30 minutes, an hour?'],
 ],
 restaurant:[
  ['services','What do you serve — what is the cuisine or specialty?'],
  ['staff','Who works the floor? First names are fine — or just say it is only you.'],
  ['hours','When are you open for guests?'],
  ['locations','Where is the restaurant? A street or neighborhood is enough.'],
  ['timeZone','What city or time zone should I use for your hours?'],
  ['appointmentTypes','How long does a typical table turn take?'],
 ],
 plumbing_hvac:[
  ['services','What jobs do you take — repairs, installs, maintenance plans?'],
  ['staff','Who are your technicians? Or is it just you?'],
  ['locations','What areas do you serve?'],
  ['hours','When are you available — and do you take emergency calls?'],
  ['timeZone','What city or time zone should I use for your hours?'],
  ['appointmentTypes','How long does a typical job take?'],
 ],
 dental:[
  ['services','What treatments do you offer — cleanings, cosmetic, orthodontics?'],
  ['staff','Who are your dentists or hygienists? First names are fine.'],
  ['hours','When is the office open for patients?'],
  ['locations','Where is the office?'],
  ['timeZone','What city or time zone should I use for your hours?'],
  ['appointmentTypes','How long is a typical visit?'],
 ],
 auto_repair:[
  ['services','What work do you do — repairs, maintenance, inspections?'],
  ['staff','Who are your technicians? Or is it just you?'],
  ['hours','When is the shop open?'],
  ['locations','Where is the shop?'],
  ['timeZone','What city or time zone should I use for your hours?'],
  ['appointmentTypes','How long does a typical service take?'],
 ],
};

function isQuestionSet(value:unknown):value is QuestionSet{
 return Array.isArray(value)&&value.length>0
  &&value.every(entry=>Array.isArray(entry)&&entry.length===2&&typeof entry[0]==='string'&&typeof entry[1]==='string');
}

/**
 * Vertical-specific questions for the post-places onboarding flow. A parallel
 * crew may export onboardingQuestionsFor(vertical) from verticals.ts — it wins
 * when present; otherwise these local sets; otherwise the generic 7 questions.
 */
export function onboardingQuestionsForVertical(vertical:string|undefined|null):QuestionSet{
 const fromVerticals=(verticals as {onboardingQuestionsFor?:(v:string)=>unknown}).onboardingQuestionsFor;
 if(typeof fromVerticals==='function'&&vertical){
  try{
   const candidate=fromVerticals(vertical);
   if(isQuestionSet(candidate))return candidate;
  }catch{/* fall through to the local sets */}
 }
 if(vertical){
  const local=VERTICAL_ONBOARDING_QUESTIONS[vertical];
  if(local)return local;
 }
 return questions;
}

/** Same shape as onboardingProgress, but driven by the vertical question set. */
export function onboardingProgressForVertical(profile:Partial<Profile>,vertical:string|undefined|null,deferred:readonly string[]=[]){
 const set=onboardingQuestionsForVertical(vertical);
 const fields=profile as Record<string,unknown>;
 const missing=set.filter(([field])=>{
  const value=fields[field];
  if(Array.isArray(value))return field==='staff'?value.some(v=>!String(v).trim()):!value.some(v=>String(v).trim());
  return typeof value!=='string'||!value.trim();
 }).map(([field])=>field);
 const next=set.find(([field])=>missing.includes(field)&&!deferred.includes(field));
 return {
  missing,basicsComplete:missing.length===0,total:set.length,
  nextQuestion:next?.[1]??null,
  readback:next?`We can build your profile by talking; a website is optional. ${next[1]}`:missing.length?'We can return to the missing details later. What would you like help with next?':'Your basic business details are saved. Appointment rules and service connections are separate; what would you like to set up next?',
 };
}

/* ------------------------------------------------------------------ */
/* Crew 6e - honest fit check. Runs once, after the core onboarding     */
/* questions are answered. A 'poor' verdict stores the assessment and   */
/* returns the plain-spoken message for the assistant to deliver        */
/* instead of selling. The stored flag means we never nag about it      */
/* again, so "continue anyway" is frictionless by construction.          */
/* ------------------------------------------------------------------ */

/**
 * Pure trigger: null when an assessment is already stored (never nag
 * again) or the core questions are not complete yet; otherwise the fresh
 * assessment plus the honest message only on a 'poor' verdict.
 */
export function honestFitStep(profile:Partial<Profile>):{assessment:FitAssessment;message:string|null}|null{
 if(profile.fitAssessment)return null;
 const vertical=typeof profile.vertical==='string'?profile.vertical:undefined;
 const complete=onboardingProgressForVertical(profile,vertical).basicsComplete
  ||onboardingProgress(profile).basicsComplete;
 if(!complete)return null;
 const result=assessFit(fitAnswersFromProfile(profile));
 const assessment:FitAssessment={
  fit:result.fit,reasons:result.reasons,
  assessedAt:new Date().toISOString(),source:'answers',
 };
 return {assessment,message:result.fit==='poor'?honestFitMessage(result):null};
}

/**
 * Server-side wrapper: computes the fit once via honestFitStep, persists
 * it through the revision-checked profile flow, and hands back the message
 * to deliver (null unless the verdict is 'poor').
 */
export async function runHonestFitCheck(env:Env,actor:Actor,profile:Profile,revision:number)
 :Promise<{profile:Profile;revision:number;message:string|null}>{
 const step=honestFitStep(profile);
 if(!step)return {profile,revision,message:null};
 const saved=await confirmProfile(env,actor,{fitAssessment:step.assessment},revision);
 return {profile:saved.profile,revision:saved.revision,message:step.message};
}
