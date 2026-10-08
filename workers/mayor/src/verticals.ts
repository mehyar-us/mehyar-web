import {z} from 'zod';

/** Runtime vertical profiles. The 41 docs in docs/verticals/ are the content source;
 * these 5 ship first. One `vertical` field on the business profile selects the profile.
 * Everything downstream — templates, vocabulary, detectors — keys off this. */
export const verticalSchema=z.enum(['salon','restaurant','plumbing_hvac','dental','auto_repair','other']);
export type Vertical=z.infer<typeof verticalSchema>;

export interface VerticalProfile{
 vertical:Vertical;
 label:string;
 /** Words the business uses. Shapes prompts, cards, and templates. */
 vocabulary:{customer:string;booking:string;staff:string;service:string};
 /** Places category hints for detection. */
 placesHints:string[];
 /** SMS text-back template. {business} is replaced with the business name. */
 textbackTemplate:string;
 /** Follow-up when the customer replies YES. */
 textbackConfirmTemplate:string;
 /** Reminder template. {when} is replaced with the appointment time. */
 reminderTemplate:string;
 /** What the proactive detectors watch for this vertical. */
 detectors:string[];
}

const STOP='Reply STOP to opt out.';

export const VERTICAL_PROFILES:Record<Vertical,VerticalProfile>={
 salon:{vertical:'salon',label:'Hair salon / Barbershop',
  vocabulary:{customer:'client',booking:'appointment',staff:'stylist',service:'service'},
  placesHints:['hair salon','barber shop','beauty salon','nail salon'],
  textbackTemplate:'Hi, this is {business}. Sorry we missed your call! Want to book an appointment? Reply YES and we will find you a time. '+STOP,
  textbackConfirmTemplate:'Thanks! We will text you shortly with available times.',
  reminderTemplate:'Reminder: you have an appointment at {business} {when}. Reply CANCEL to cancel.',
  detectors:['rebooking_gap','missed_call','slow_day','lapsed_regular']},
 restaurant:{vertical:'restaurant',label:'Restaurant',
  vocabulary:{customer:'guest',booking:'reservation',staff:'server',service:'table'},
  placesHints:['restaurant','pizzeria','cafe','diner'],
  textbackTemplate:'Hi, this is {business}. Sorry we missed your call! Want to book a table? Reply YES and we will find you a time. '+STOP,
  textbackConfirmTemplate:'Thanks! We will text you shortly with available times.',
  reminderTemplate:'Reminder: your reservation at {business} is {when}. Reply CANCEL to cancel.',
  detectors:['slow_night','missed_call','no_show_risk','unanswered_lead']},
 plumbing_hvac:{vertical:'plumbing_hvac',label:'Plumbing / HVAC',
  vocabulary:{customer:'customer',booking:'job',staff:'technician',service:'service'},
  placesHints:['plumber','hvac','heating contractor','electrician'],
  textbackTemplate:'Hi, this is {business}. Sorry we missed your call! Is this urgent? Reply YES and we will get you scheduled right away. '+STOP,
  textbackConfirmTemplate:'Got it — we will call you back within 15 minutes.',
  reminderTemplate:'Reminder: your service visit with {business} is {when}. Reply CANCEL to reschedule.',
  detectors:['after_hours_emergency','missed_call','unanswered_lead','slow_day']},
 dental:{vertical:'dental',label:'Dental office',
  vocabulary:{customer:'patient',booking:'visit',staff:'hygienist',service:'treatment'},
  placesHints:['dentist','dental clinic','orthodontist'],
  textbackTemplate:'Hi, this is {business}. Sorry we missed your call! Want to book a visit? Reply YES and we will find you a time. '+STOP,
  textbackConfirmTemplate:'Thanks! We will text you shortly with available times.',
  reminderTemplate:'Reminder: your visit at {business} is {when}. Reply CANCEL to cancel.',
  detectors:['lapsed_regular','missed_call','no_show_risk','rebooking_gap']},
 auto_repair:{vertical:'auto_repair',label:'Auto repair',
  vocabulary:{customer:'customer',booking:'service appointment',staff:'technician',service:'repair'},
  placesHints:['auto repair','car repair','mechanic','tire shop'],
  textbackTemplate:'Hi, this is {business}. Sorry we missed your call! Want to schedule service? Reply YES and we will find you a time. '+STOP,
  textbackConfirmTemplate:'Thanks! We will text you shortly with available times.',
  reminderTemplate:'Reminder: your service appointment at {business} is {when}. Reply CANCEL to cancel.',
  detectors:['missed_call','lapsed_regular','slow_day','unanswered_lead']},
 other:{vertical:'other',label:'Other local business',
  vocabulary:{customer:'customer',booking:'appointment',staff:'team member',service:'service'},
  placesHints:[],
  textbackTemplate:'Hi, this is {business}. Sorry we missed your call! Reply YES and we will get back to you shortly. '+STOP,
  textbackConfirmTemplate:'Thanks! We will be in touch shortly.',
  reminderTemplate:'Reminder: your appointment at {business} is {when}. Reply CANCEL to cancel.',
  detectors:['missed_call','unanswered_lead','slow_day']},
};

export function verticalProfile(vertical:string|undefined|null):VerticalProfile{
 const parsed=verticalSchema.safeParse(vertical);
 return VERTICAL_PROFILES[parsed.success?parsed.data:'other'];
}

/** Detect a vertical from a Google Places category string. Returns null when unsure. */
export function detectVerticalFromCategory(category:string|undefined|null):Vertical|null{
 if(!category)return null;
 const lower=category.toLowerCase();
 for(const profile of Object.values(VERTICAL_PROFILES)){
  if(profile.vertical==='other')continue;
  if(profile.placesHints.some(hint=>lower.includes(hint)))return profile.vertical;
 }
 return null;
}
