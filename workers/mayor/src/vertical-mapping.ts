import type {Vertical} from './verticals';

/**
 * Crew 6b — adjacent-vertical mapping.
 *
 * When a business doesn't match a real vertical, we suggest the nearest fit
 * EXPLICITLY and honestly — never a silent mismatch. The stored vertical is
 * always the mapped (real) one; the original trade rides along in
 * profile.verticalMappedFrom so every surface can say "using X mode".
 *
 * Only trades we'd defend to the owner belong in ADJACENT_VERTICAL_MAP.
 * Deliberately unmapped (no honest fit): house cleaning (recurring visits —
 * neither chair-appointments nor dispatch), bakery (retail counter, not
 * dine-in), food truck / taco truck (mobile, no fixed location), florist /
 * gift shop (retail), real estate / law / accounting (office services).
 */

/** One adjacent-trade entry: closest real vertical + the honest,
 * owner-facing one-line reason. Every reason must contain "Closest" or
 * "don't have" — the honesty marker the tests enforce. */
export interface AdjacentVerticalEntry{
 match:Vertical;
 reason:string;
}

export const ADJACENT_VERTICAL_MAP:Record<string,AdjacentVerticalEntry>={
 electrician:{match:'plumbing_hvac',
  reason:"Closest fit — dispatched service visits, emergency triage, and quote follow-up work just like plumbing/HVAC. We don't have a dedicated electrician mode yet."},
 barber:{match:'salon',
  reason:'Closest fit — chairs, appointments, and rebooking work exactly like a salon.'},
 nail_salon:{match:'salon',
  reason:'Closest fit — appointment-based services with rebooking, just like a salon.'},
 tattoo:{match:'salon',
  reason:"Closest fit — appointment-based bookings with reminders, like a salon. We don't have a tattoo mode yet."},
 massage:{match:'salon',
  reason:"Closest fit — appointment-based sessions with rebooking, like a salon. We don't have a massage mode yet."},
 spa:{match:'salon',
  reason:"Closest fit — appointment-based treatments with rebooking, like a salon. We don't have a spa mode yet."},
 pizza:{match:'restaurant',
  reason:'Closest fit — reservations and table booking, like a restaurant. We don\'t have a dedicated pizza mode yet.'},
 food_delivery:{match:'restaurant',
  reason:"Closest fit — restaurant mode covers takeout and delivery orders. We don't have a delivery-only mode yet."},
 car_detailing:{match:'auto_repair',
  reason:"Closest fit — bay scheduling and service appointments, like auto repair. We don't have a detailing mode yet."},
 lawn_care:{match:'plumbing_hvac',
  reason:"Closest fit — dispatched route work with quotes and seasonal visits, like plumbing/HVAC. We don't have a lawn care mode yet."},
 locksmith:{match:'plumbing_hvac',
  reason:"Closest fit — emergency dispatch and quote follow-up, like plumbing/HVAC. We don't have a locksmith mode yet."},
 pest_control:{match:'plumbing_hvac',
  reason:"Closest fit — recurring route visits and dispatch, like plumbing/HVAC. We don't have a pest control mode yet."},
 house_painter:{match:'plumbing_hvac',
  reason:"Closest fit — quote-based jobs and crew scheduling, like plumbing/HVAC. We don't have a painter mode yet."},
 carpet_cleaning:{match:'plumbing_hvac',
  reason:"Closest fit — scheduled service visits and dispatch, like plumbing/HVAC. We don't have a carpet cleaning mode yet."},
 appliance_repair:{match:'plumbing_hvac',
  reason:'Closest fit — dispatched home service visits and quotes, like plumbing/HVAC.'},
 handyman:{match:'plumbing_hvac',
  reason:"Closest fit — quote-based jobs and dispatch, like plumbing/HVAC. We don't have a handyman mode yet."},
 roofing:{match:'plumbing_hvac',
  reason:"Closest fit — quote follow-up and job scheduling, like plumbing/HVAC. We don't have a roofing mode yet."},
 veterinary:{match:'dental',
  reason:"Closest fit — appointment-based care with recall reminders, like a dental office. We don't have a vet mode yet."},
 chiropractor:{match:'dental',
  reason:"Closest fit — appointment-based care with recall visits, like a dental office. We don't have a chiropractor mode yet."},
};

/** Display names for trades whose slug doesn't read naturally in UI copy. */
const TRADE_DISPLAY:Record<string,string>={
 veterinary:'veterinary clinic',
};
/** Extra phrases that resolve to a map key (stemmed on both sides, so one
 * base form covers plurals and -er/-ing variants). */
const TRADE_ALIASES:Record<string,string[]>={
 electrician:['electrical contractor','electrical'],
 barber:['barbershop','barber shop'],
 nail_salon:['nail tech','nails'],
 tattoo:['tattoo shop','tattoo parlor','tattoo studio'],
 massage:['massage therapy','massage therapist'],
 spa:['day spa'],
 pizza:['pizzeria','pizza shop','pizza delivery'],
 food_delivery:['meal delivery','takeout'],
 car_detailing:['auto detailing','detailer','car detail'],
 lawn_care:['landscaping','lawn service','yard work'],
 pest_control:['exterminator'],
 house_painter:['painter','painting contractor'],
 carpet_cleaning:['carpet cleaner'],
 roofing:['roofer','roofing contractor'],
 veterinary:['veterinarian','vet clinic','animal hospital'],
 chiropractor:['chiropractic'],
};

/** Short mode names for honest UI copy, e.g. "Use plumbing/HVAC mode?" */
export const MODE_LABELS:Record<Exclude<Vertical,'other'>,string>={
 salon:'salon',
 restaurant:'restaurant',
 plumbing_hvac:'plumbing/HVAC',
 dental:'dental office',
 auto_repair:'auto repair',
 pet_grooming:'pet grooming',
 med_spa:'med spa',
};

/* Small normalize/stem helpers in the style of verticals.ts (copied, not
 * imported — verticals.ts is owned by a sibling workstream). One deliberate
 * deviation: the stemmer runs to a fixpoint so 'painters' and 'painter' both
 * reach 'paint' — single-pass stemming is asymmetric ('painters'->'painter'
 * but 'painter'->'paint') and would miss plural inputs. */
function normalizeTrade(value:string):string{
 return value.toLowerCase().replace(/[_-]+/g,' ');
}
function stemWord(word:string):string{
 let stemmed=word;
 for(;;){
  const next=stemmed.replace(/(ing|er|es|s)$/,'');
  if(next===stemmed)return stemmed;
  stemmed=next;
 }
}
function stemmedWordSet(value:string):Set<string>{
 return new Set(normalizeTrade(value).split(/[^a-z0-9]+/).filter(Boolean).map(stemWord));
}

export interface VerticalSuggestion{
 /** Canonical trade name, e.g. "car detailing". */
 trade:string;
 vertical:Vertical;
 reason:string;
}

/**
 * Resolve a Places category string ("electrician", "car_detailing") or an
 * owner free-text description ("I'm an electrician") to the closest real
 * vertical via the adjacent map. Returns null when nothing maps honestly.
 * An alias matches when ALL of its stemmed words appear in the input, so
 * "We do lawn care and landscaping" hits lawn_care but "taco truck" and
 * "flower delivery" match nothing.
 */
export function suggestVertical(descriptionOrCategory:string|undefined|null):VerticalSuggestion|null{
 if(!descriptionOrCategory)return null;
 const words=stemmedWordSet(descriptionOrCategory);
 if(!words.size)return null;
 for(const [key,entry] of Object.entries(ADJACENT_VERTICAL_MAP)){
  const phrases=[key,...(TRADE_ALIASES[key]??[])];
  for(const phrase of phrases){
   const needed=stemmedWordSet(phrase);
   if(needed.size&&[...needed].every(w=>words.has(w))){
    return {trade:TRADE_DISPLAY[key]??key.replace(/_/g,' '),vertical:entry.match,reason:entry.reason};
   }
  }
 }
 return null;
}

/** Owner-facing honest framing for the vertical-choice step, e.g.
 * `We don't have "electrician" yet — Closest fit — dispatched service
 * visits … like plumbing/HVAC. Use plumbing/HVAC mode?` */
export function verticalSuggestionFraming(suggestion:VerticalSuggestion):string{
 const mode=MODE_LABELS[suggestion.vertical as Exclude<Vertical,'other'>]??suggestion.vertical;
 const reason=suggestion.reason.replace(/We don't have a dedicated \S+ mode yet\.?\s*/,'');
 return `We don't have "${suggestion.trade}" yet — ${reason} Use ${mode} mode?`;
}

/** "Using X mode" note for anywhere the stored vertical surfaces (settings
 * pill, onboarding summary). Null when the vertical wasn't mapped — or when
 * it is 'other' — so mapped mode is never shown silently and unmapped
 * verticals never claim a mapping. */
export function verticalMappingNote(profile:{vertical?:string|null;verticalMappedFrom?:string|null}):string|null{
 const mappedFrom=profile.verticalMappedFrom?.trim();
 if(!mappedFrom||!profile.vertical||profile.vertical==='other')return null;
 const label=MODE_LABELS[profile.vertical as Exclude<Vertical,'other'>];
 if(!label)return null;
 return `Using ${label} mode — mapped from "${mappedFrom}". We don't have a dedicated mode for it yet.`;
}
