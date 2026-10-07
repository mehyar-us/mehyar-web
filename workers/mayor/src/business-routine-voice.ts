import type {BusinessRoutineBrief} from './business-routines';

/** Read the recorded timestamp and actual priorities, with the original coverage limits. */
export function businessBriefReadback(brief:Omit<BusinessRoutineBrief,'id'>){
 const priorities=brief.priorities.slice(0,3).map(item=>`${item.title}: ${item.detail}`).join(' ');
 return `Business brief recorded ${brief.generatedAt}. ${brief.summary}${priorities?` First priorities: ${priorities}`:''} ${brief.scope}`;
}
export function asksRoutineRun(text:string){
 return !/\b(?:do not|don't|never) (?:run|prepare|generate|create|review)\b/i.test(text)
  &&/\b(?:run|prepare|generate|create|review)\b/i.test(text)
  &&/\b(?:business (?:review|brief)|daily (?:review|brief)|workday|brief|playbook|routines?)\b/i.test(text);
}
export function asksRoutineSchedule(text:string,previous=''){
 if(/\b(?:do not|don't|never) (?:schedule|enable|automate|change|update|pause|stop|resume)\b/i.test(text))return false;
 return /\b(?:enable|disable|pause|stop|resume|schedule|automate|set up|change|update|save)\b/i.test(text)
  &&/\b(?:briefs?|routines?|playbook|business review|daily priorities)\b/i.test(text)
  ||/\b(?:briefs?|routines?|playbook)\b/i.test(previous)&&/\b(?:what|which)\b.{0,60}\b(?:time|frequency|zone|days|routines?|templates?)\b/i.test(previous);
}
export const routineVoiceTools=['readWorkdaySnapshot','readBusinessPlaybook','readDailyBrief','runBusinessReview','proposeBusinessRoutines'];
export const routineVoiceGuidance='For owner or manager business priorities, callbacks, preparation, retention, handoff or growth drafts, first use readWorkdaySnapshot with the relevant playbook IDs; it reads actual saved records even before automatic routines are configured. Ground your response in that snapshot and confirmed profile. Tailor draft language and priorities to the confirmed industry, services, locations, goals, bottlenecks, current tools and staff; ask for missing details rather than assuming a generic service business. Offer practical choices appropriate to shops, restaurants, trades, professional services and online businesses. Never invent sales, purchase history, contact consent, staffing, inbox/reviews or external-calendar coverage. Use readBusinessPlaybook for selected routines, catalog and schedule; readDailyBrief for the most recent recorded brief and its timestamp. A request to help plan today does not authorize a saved run or schedule. Use runBusinessReview only for an explicit request to run or generate a business brief/review and only after selected routines have been saved. For an explicit automatic brief setup/change/pause, use proposeBusinessRoutines with the selected catalog IDs and all supplied schedule details; read current config when needed, and ask one missing field. Daily or weekdays, local clock time in five-minute intervals, and an IANA time zone are required when enabled. The server supplies revision and exact confirmation readback; only the next separate yes saves it. These routines create in-app saved-record briefs; they send no outreach and monitor no inbox or reviews. Their schedule is distinct from profile/calendar account checks and email preferences.';
