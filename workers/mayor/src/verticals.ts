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
 /** Per-vertical detector tuning knobs. All optional so profiles keep working
  * for other consumers; defaults live in the detector runtime. */
 detectorParams?:{
  /** Days since last visit before a regular counts as lapsed. */
  lapsedRegularDays:number;
  /** Natural rebooking rhythm, in days, when the vertical has one (e.g. color cycle, cleaning cycle). */
  rebookingCycleDays?:number;
  /** Minimum quiet gap on a slow day before a fill suggestion fires. */
  slowDayMinGapMinutes?:number;
  /** Minutes an inbound lead can sit unanswered before escalation. */
  unansweredLeadMinutes?:number;
  /** Days back to look when flagging no-show patterns. */
  noShowLookbackDays?:number;
  /** Local-business after-hours window that triages to emergency handling (HH:MM). */
  afterHoursStart?:string;
  afterHoursEnd?:string;
 };
 /** Owner-facing KPI cards, highest value first. */
 kpis?:{key:string;label:string;hint:string}[];
 /** Vertical-specific onboarding interview, in order. Falls back to
  * ONBOARDING_QUESTIONS_FALLBACK when a profile doesn't define its own. */
 onboardingQuestions?:{field:string;question:string}[];
 /** Connector ids, highest value first. Real provider ids from this repo
  * (google, telnyx, twilio, stripe) come first; later entries are doc'd
  * one-click integrations from docs/verticals that are not yet built. */
 connectorPriority?:string[];
 /** One-line tone guidance for generated suggestions. */
 suggestionVoice?:string;
 /** Nouns for briefings and cards, so "3 appointments" reads "3 reservations". */
 briefingNouns?:{appointments:string;customers:string};
}

/** The current generic onboarding questions (onboarding.ts), used for 'other'. */
export const ONBOARDING_QUESTIONS_FALLBACK:{field:string;question:string}[]=[
 {field:'name',question:'What is your business called?'},
 {field:'industry',question:'What kind of business do you run?'},
 {field:'services',question:'What services or products do you offer?'},
 {field:'locations',question:'Where do you serve customers? You can describe a location, service area, or an online business.'},
 {field:'hours',question:'When is your business available to customers? You can describe your hours in your own words.'},
 {field:'timeZone',question:'What city or time zone should I use for your business hours?'},
 {field:'staff',question:'Who works with customers? If you work alone, you can just say so.'},
];

/** Onboarding questions for a vertical: the profile's own, or the generic fallback. */
export function onboardingQuestionsFor(vertical:string|undefined|null):{field:string;question:string}[]{
 const profile=verticalProfile(vertical);
 return profile.onboardingQuestions??ONBOARDING_QUESTIONS_FALLBACK;
}

const STOP='Reply STOP to opt out.';

export const VERTICAL_PROFILES:Record<Vertical,VerticalProfile>={
 salon:{vertical:'salon',label:'Hair salon / Barbershop',
  vocabulary:{customer:'client',booking:'appointment',staff:'stylist',service:'service'},
  placesHints:['hair salon','barber shop','beauty salon','nail salon'],
  textbackTemplate:'Hi, this is {business}. Sorry we missed your call! Want to book an appointment? Reply YES and we will find you a time. '+STOP,
  textbackConfirmTemplate:'Thanks! We will text you shortly with available times.',
  reminderTemplate:'Reminder: you have an appointment at {business} {when}. Reply CANCEL to cancel.',
  detectors:['rebooking_gap','missed_call','slow_day','lapsed_regular'],
  detectorParams:{lapsedRegularDays:56,rebookingCycleDays:42,slowDayMinGapMinutes:120,unansweredLeadMinutes:120,noShowLookbackDays:90},
  kpis:[
   {key:'rebooking_rate',label:'Rebooking rate',hint:'Share of clients who rebook within their service cycle'},
   {key:'chair_utilization',label:'Chair utilization',hint:'Booked chair-hours vs available chair-hours'},
   {key:'avg_ticket',label:'Average ticket',hint:'Average revenue per visit, per client'},
  ],
  onboardingQuestions:[
   {field:'services',question:'What services do you offer, and what do you charge? You can type it out or paste your menu.'},
   {field:'staff',question:'How many chairs do you have, and who staffs them? Who does cuts, color, nails — all of it?'},
   {field:'service_time',question:'How long does a typical service take, and how far ahead do clients usually book?'},
   {field:'dead_days',question:'Which days are dead? We fill those first.'},
   {field:'hours',question:'What are your hours, including weekend and evening exceptions?'},
  ],
  connectorPriority:['telnyx','twilio','google','google-business','square','stripe','vagaro','booksy','fresha'],
  suggestionVoice:'Warm, fast, a little fun — like the best receptionist.',
  briefingNouns:{appointments:'appointments',customers:'clients'}},
 restaurant:{vertical:'restaurant',label:'Restaurant',
  vocabulary:{customer:'guest',booking:'reservation',staff:'server',service:'table'},
  placesHints:['restaurant','pizzeria','cafe','diner'],
  textbackTemplate:'Hi, this is {business}. Sorry we missed your call! Want to book a table? Reply YES and we will find you a time. '+STOP,
  textbackConfirmTemplate:'Thanks! We will text you shortly with available times.',
  reminderTemplate:'Reminder: your reservation at {business} is {when}. Reply CANCEL to cancel.',
  detectors:['slow_night','missed_call','no_show_risk','unanswered_lead'],
  detectorParams:{lapsedRegularDays:45,slowDayMinGapMinutes:120,unansweredLeadMinutes:120,noShowLookbackDays:90},
  kpis:[
   {key:'covers',label:'Covers',hint:'Guests served tonight vs your usual pace'},
   {key:'slow_night_revenue',label:'Slow-night revenue',hint:'Revenue booked on your slowest nights this week'},
   {key:'reservation_no_show',label:'No-show rate',hint:'Share of reservations that never showed'},
  ],
  onboardingQuestions:[
   {field:'covers',question:'How many covers can you seat, and what party sizes do you take?'},
   {field:'reservation_rules',question:'How far ahead do you take reservations, and what is your large-party policy?'},
   {field:'slow_nights',question:'Which nights are dead? We fill those first.'},
   {field:'menu',question:'Menu highlights, and the dietary questions you always get?'},
   {field:'hours',question:'What are your hours, including kitchen close and exceptions?'},
  ],
  connectorPriority:['telnyx','twilio','google','google-business','opentable','resy','toast','square','stripe'],
  suggestionVoice:'Warm, quick, hospitable — like the best host. Short answers.',
  briefingNouns:{appointments:'reservations',customers:'guests'}},
 plumbing_hvac:{vertical:'plumbing_hvac',label:'Plumbing / HVAC',
  vocabulary:{customer:'customer',booking:'job',staff:'technician',service:'service'},
  placesHints:['plumber','hvac','heating contractor','electrician'],
  textbackTemplate:'Hi, this is {business}. Sorry we missed your call! Is this urgent? Reply YES and we will get you scheduled right away. '+STOP,
  textbackConfirmTemplate:'Got it — we will call you back within 15 minutes.',
  reminderTemplate:'Reminder: your service visit with {business} is {when}. Reply CANCEL to reschedule.',
  detectors:['after_hours_emergency','missed_call','unanswered_lead','slow_day'],
  detectorParams:{lapsedRegularDays:365,slowDayMinGapMinutes:120,unansweredLeadMinutes:120,noShowLookbackDays:90,afterHoursStart:'17:00',afterHoursEnd:'08:00'},
  kpis:[
   {key:'response_time',label:'Response time',hint:'Minutes from first contact to a scheduled visit'},
   {key:'quote_conversion',label:'Quote conversion',hint:'Share of quotes that turn into booked jobs'},
   {key:'after_hours_catch',label:'After-hours catch',hint:'After-hours calls answered vs missed this week'},
  ],
  onboardingQuestions:[
   {field:'service_area',question:'What service area do you cover — towns or zips?'},
   {field:'emergency_hours',question:'What counts as an emergency, and how do you handle after-hours calls?'},
   {field:'dispatch',question:'When an urgent job comes in, should I call you immediately or text you first?'},
   {field:'services',question:'What are your services and price ranges? The sheet you quote from.'},
   {field:'booking_rules',question:'Booking rules: job windows, how far ahead, buffer between jobs?'},
  ],
  connectorPriority:['telnyx','twilio','google','google-business','stripe','jobber','housecall-pro','servicetitan'],
  suggestionVoice:'Direct, capable, no fluff — straight answers for homeowners.',
  briefingNouns:{appointments:'jobs',customers:'customers'}},
 dental:{vertical:'dental',label:'Dental office',
  vocabulary:{customer:'patient',booking:'visit',staff:'hygienist',service:'treatment'},
  placesHints:['dentist','dental clinic','orthodontist'],
  textbackTemplate:'Hi, this is {business}. Sorry we missed your call! Want to book a visit? Reply YES and we will find you a time. '+STOP,
  textbackConfirmTemplate:'Thanks! We will text you shortly with available times.',
  reminderTemplate:'Reminder: your visit at {business} is {when}. Reply CANCEL to cancel.',
  detectors:['lapsed_regular','missed_call','no_show_risk','rebooking_gap'],
  detectorParams:{lapsedRegularDays:180,rebookingCycleDays:180,slowDayMinGapMinutes:120,unansweredLeadMinutes:120,noShowLookbackDays:90},
  kpis:[
   {key:'recare_rate',label:'Recare rate',hint:'Share of patients due for a cleaning who got rebooked'},
   {key:'hygiene_utilization',label:'Hygiene utilization',hint:'Booked hygiene chair-hours vs available'},
   {key:'treatment_acceptance',label:'Treatment acceptance',hint:'Share of presented treatment plans patients accept'},
  ],
  onboardingQuestions:[
   {field:'providers',question:'How many providers and chairs do you run?'},
   {field:'recare_cycle',question:'How often do you recall patients — every 6 months?'},
   {field:'insurance',question:'Which insurance plans do you take? This is the question we will answer all day.'},
   {field:'booking_rules',question:'Booking rules: new vs returning, how far ahead, buffer times?'},
   {field:'urgent',question:'What counts as urgent after hours, and where should we send it?'},
  ],
  connectorPriority:['telnyx','twilio','google','google-business','stripe','solutionreach','weave','doctible'],
  suggestionVoice:'Calm, clear, professional — patients are often anxious. Short sentences.',
  briefingNouns:{appointments:'visits',customers:'patients'}},
 auto_repair:{vertical:'auto_repair',label:'Auto repair',
  vocabulary:{customer:'customer',booking:'service appointment',staff:'technician',service:'repair'},
  placesHints:['auto repair','car repair','mechanic','tire shop'],
  textbackTemplate:'Hi, this is {business}. Sorry we missed your call! Want to schedule service? Reply YES and we will find you a time. '+STOP,
  textbackConfirmTemplate:'Thanks! We will text you shortly with available times.',
  reminderTemplate:'Reminder: your service appointment at {business} is {when}. Reply CANCEL to cancel.',
  detectors:['missed_call','lapsed_regular','slow_day','unanswered_lead'],
  detectorParams:{lapsedRegularDays:180,slowDayMinGapMinutes:120,unansweredLeadMinutes:120,noShowLookbackDays:90},
  kpis:[
   {key:'bay_utilization',label:'Bay utilization',hint:'Booked bay-hours vs available bay-hours'},
   {key:'ticket_close_rate',label:'Ticket close rate',hint:'Share of tickets closed within the quoted window'},
   {key:'repeat_customer_rate',label:'Repeat customers',hint:'Share of customers who come back for the next service'},
  ],
  onboardingQuestions:[
   {field:'bays',question:'How many bays do you run, and how long do jobs usually take?'},
   {field:'services',question:'What services do you offer — repair, tires, detailing — and your price ranges? The sheet you quote from.'},
   {field:'estimate_flow',question:'How do estimates work — quote on the spot, or send it and follow up?'},
   {field:'dropoff',question:'Drop-off vs wait — and do you offer a loaner?'},
   {field:'hours',question:'What are your hours, including Saturday?'},
  ],
  connectorPriority:['telnyx','twilio','google','google-business','stripe','shop-ware','tekmetric'],
  suggestionVoice:'Straight-talking, capable — car people smell nonsense fast.',
  briefingNouns:{appointments:'service appointments',customers:'customers'}},
 other:{vertical:'other',label:'Other local business',
  vocabulary:{customer:'customer',booking:'appointment',staff:'team member',service:'service'},
  placesHints:[],
  textbackTemplate:'Hi, this is {business}. Sorry we missed your call! Reply YES and we will get back to you shortly. '+STOP,
  textbackConfirmTemplate:'Thanks! We will be in touch shortly.',
  reminderTemplate:'Reminder: your appointment at {business} is {when}. Reply CANCEL to cancel.',
  detectors:['missed_call','unanswered_lead','slow_day'],
  detectorParams:{lapsedRegularDays:90,slowDayMinGapMinutes:120,unansweredLeadMinutes:120,noShowLookbackDays:90},
  kpis:[
   {key:'missed_call_catch',label:'Missed-call catch',hint:'Missed calls we texted back before the customer moved on'},
   {key:'booking_conversion',label:'Booking conversion',hint:'Share of inquiries that turned into bookings'},
   {key:'review_growth',label:'Review growth',hint:'New Google reviews this month'},
  ],
  onboardingQuestions:ONBOARDING_QUESTIONS_FALLBACK,
  connectorPriority:['telnyx','twilio','google','google-business','stripe'],
  suggestionVoice:'Warm, clear, helpful — like a great local business assistant.',
  briefingNouns:{appointments:'appointments',customers:'customers'}},
};

export function verticalProfile(vertical:string|undefined|null):VerticalProfile{
 const parsed=verticalSchema.safeParse(vertical);
 return VERTICAL_PROFILES[parsed.success?parsed.data:'other'];
}

/** Normalizes a Places category for hint matching: underscores/hyphens to spaces. */
function normalizeCategory(category:string):string{
 return category.toLowerCase().replace(/[_-]+/g,' ');
}

/** Light word-stemming so 'plumbing' matches the 'plumber' hint and
 * 'auto_repair_shop' matches 'auto repair'. Applied to both sides so
 * the comparison stays symmetric. */
function stemWord(word:string):string{
 return word.replace(/(ing|er|es|s)$/,'');
}
function stemmedWords(value:string):string{
 return normalizeCategory(value).split(/[^a-z0-9]+/).filter(Boolean).map(stemWord).join(' ');
}

/** Detect a vertical from a Google Places category string. Returns null when unsure. */
export function detectVerticalFromCategory(category:string|undefined|null):Vertical|null{
 if(!category)return null;
 const lower=normalizeCategory(category);
 const stemmed=stemmedWords(category);
 for(const profile of Object.values(VERTICAL_PROFILES)){
  if(profile.vertical==='other')continue;
  if(profile.placesHints.some(hint=>{
   const h=hint.toLowerCase();
   return lower.includes(h)||stemmed.includes(stemmedWords(hint));
  }))return profile.vertical;
 }
 return null;
}
