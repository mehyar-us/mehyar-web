import type {Profile} from './memory';

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
