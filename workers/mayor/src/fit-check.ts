/**
 * Crew 6e — HONEST FIT CHECK.
 *
 * The Mayor is built for businesses that live on appointments and calls.
 * When the onboarding answers show it is a bad fit (walk-up only, no
 * appointments, no meaningful call volume — taco trucks, dry cleaners),
 * the product says so plainly INSTEAD of selling.
 *
 * Deterministic: pure functions, no model calls. Conservative by design —
 * 'poor' only when all three signals are explicit (no appointments AND a
 * walk-up/transient model AND low/no inbound call volume). Mixed or thin
 * signals → 'uncertain'. A borderline business is served, never turned
 * away on a hunch.
 */

export type FitVerdict = 'good' | 'uncertain' | 'poor';

export interface FitAnswers {
  industry?: string | null;
  services?: readonly (string | null | undefined)[] | null;
  description?: string | null;
  vertical?: string | null;
  /** Non-empty means appointments are offered. */
  appointmentTypes?: readonly (string | null | undefined)[] | null;
  schedulingRules?: string | null;
  hours?: string | null;
  /**
   * Free text about how customers book or reach the business — the booking
   * model and call volume live here (e.g. "walk-up only, order at the
   * window, no phone orders" or "customers call to book and reschedule").
   */
  bookingModel?: string | null;
  /** Google primary place type, e.g. "food_truck". Underscores normalized. */
  placeCategory?: string | null;
}

export interface FitResult {
  fit: FitVerdict;
  /** Plain-language reasons, safe to show the owner. */
  reasons: string[];
}

/** Stored on the profile (memory.ts) so the check runs exactly once. */
export interface FitAssessment extends FitResult {
  assessedAt: string;
  source: 'answers' | 'place-category';
}

/* ------------------------------------------------------------------ */
/* Signal lexicons. Matched case-insensitively against the owner's own  */
/* wording; nothing is inferred beyond what they said.                 */
/* ------------------------------------------------------------------ */

const WALK_UP_PHRASES = [
  'food truck', 'taco truck', 'ice cream truck', 'food cart', 'food stand',
  'hot dog stand', 'coffee cart',
  'market stall', 'farmers market', 'flea market', 'kiosk', 'newsstand', 'vending',
  'dry cleaner', 'dry cleaners', 'dry cleaning', 'laundromat', 'launderette', 'coin laundry',
  'car wash', 'convenience store', 'bodega',
  'walk-up', 'walk up', 'walk-in', 'walk in', 'walk-ins',
  'counter service', 'order at the window', 'order at the counter',
  'pickup only', 'pick up only', 'takeout only', 'take-out only',
  'drop off', 'drop-off',
];

const APPOINTMENT_PHRASES = [
  'appointment', 'book', 'booking', 'reservation', 'reserve',
  'schedule', 'scheduling', 'consultation', 'consult',
  'estimate', 'quote', 'book ahead', 'book online', 'book by phone',
];

const CALL_LOW_PHRASES = [
  'no phone', 'no calls', 'nobody calls', 'never calls', 'no one calls',
  'dont call', 'do not call',
  'walk-up only', 'walk up only', 'walk-ins only', 'walk ins only',
  'no reservations', 'no appointments',
  'order at the window', 'order at the counter', 'in person only', 'counter only',
  'barely rings', 'hardly rings', 'rarely rings',
];

const CALL_HIGH_PHRASES = [
  'call to', 'call ahead', 'call us', 'call me', 'phone orders', 'order by phone',
  'book by phone', 'people call', 'customers call', 'clients call',
  'calls come in', 'by phone', 'over the phone',
  'takeout orders', 'take-out orders', 'phone quotes', 'answer the phone',
];

/** Google primary place types that are walk-up / transient by nature. */
const PLACE_WALK_UP_CATEGORIES = new Set([
  'food truck', 'taco truck', 'ice cream truck', 'food cart', 'food stand',
  'hot dog stand', 'coffee cart',
  'kiosk', 'newsstand', 'vending machine',
  'market stall', 'farmers market', 'flea market',
  'laundry', 'laundromat', 'dry cleaner', 'dry cleaning',
  'car wash', 'convenience store',
]);

/**
 * Walk-up categories where inbound calls are effectively nil, so a clear
 * 'poor' can be declared from the Places path alone. Laundry / dry cleaner /
 * car wash are deliberately excluded: they do get "is my order ready" calls,
 * so the conversational answers decide for them (conservative).
 */
const PLACE_NO_CALL_CATEGORIES = new Set([
  'food truck', 'taco truck', 'ice cream truck', 'food cart', 'food stand',
  'hot dog stand', 'coffee cart',
  'kiosk', 'newsstand', 'vending machine',
  'market stall', 'farmers market', 'flea market',
]);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hasAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => new RegExp(`\\b${escapeRegExp(phrase)}\\b`).test(text));
}

export function normalizePlaceCategoryForFit(category: string | null | undefined): string {
  return (category ?? '').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Deterministic fit assessment over the onboarding answers. 'poor' requires
 * all three to hold: no appointments offered, a walk-up/transient model, and
 * low/no inbound call volume. Anything mixed or thin → 'uncertain'.
 */
export function assessFit(answers: FitAnswers): FitResult {
  const text = [answers.industry, answers.description, answers.bookingModel, answers.hours, ...(answers.services ?? [])]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join('\n')
    .toLowerCase();
  const placeCategory = normalizePlaceCategoryForFit(answers.placeCategory);

  const offersAppointments =
    (answers.appointmentTypes ?? []).some((t) => typeof t === 'string' && t.trim().length > 0) ||
    (typeof answers.schedulingRules === 'string' && answers.schedulingRules.trim().length > 0) ||
    hasAny(text, APPOINTMENT_PHRASES);

  const walkUp =
    hasAny(text, WALK_UP_PHRASES) ||
    (placeCategory !== '' && PLACE_WALK_UP_CATEGORIES.has(placeCategory));

  const callVolume: 'low' | 'medium' | 'unknown' =
    hasAny(text, CALL_LOW_PHRASES) ? 'low'
    : hasAny(text, CALL_HIGH_PHRASES) ? 'medium'
    : PLACE_NO_CALL_CATEGORIES.has(placeCategory) ? 'low'
    : 'unknown';

  if (!offersAppointments && walkUp && callVolume === 'low') {
    return {
      fit: 'poor',
      reasons: [
        'No appointments are offered — there are no bookings for missed calls to cost you.',
        'Walk-up, transient model — customers show up rather than booking ahead.',
        'Little or no inbound call volume — the phone is not where your money leaks.',
      ],
    };
  }

  if (offersAppointments || (callVolume === 'medium' && !walkUp)) {
    const reasons: string[] = [];
    if (offersAppointments) reasons.push('Appointments are offered — every missed call can be a lost booking.');
    if (callVolume === 'medium' && !walkUp) reasons.push('Meaningful inbound call volume — the phone is part of how customers reach you.');
    return { fit: 'good', reasons };
  }

  return {
    fit: 'uncertain',
    reasons: [
      'Mixed or thin signals on the booking model — giving the business the benefit of the doubt instead of turning it away.',
    ],
  };
}

/** Extract the fit signals from a confirmed profile. No new questions asked. */
export function fitAnswersFromProfile(
  profile: {
    industry?: string | null;
    services?: readonly (string | null | undefined)[] | null;
    description?: string | null;
    vertical?: string | null;
    appointmentTypes?: readonly (string | null | undefined)[] | null;
    schedulingRules?: string | null;
    hours?: string | null;
  },
  placeCategory?: string | null,
): FitAnswers {
  return {
    industry: profile.industry ?? null,
    services: profile.services ?? null,
    description: profile.description ?? null,
    vertical: profile.vertical ?? null,
    appointmentTypes: profile.appointmentTypes ?? null,
    schedulingRules: profile.schedulingRules ?? null,
    hours: profile.hours ?? null,
    bookingModel: null,
    placeCategory: placeCategory ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* The honest message. Anti-dark-pattern: plain, no guilt copy, and the  */
/* "continue anyway" path is genuinely frictionless (the stored flag     */
/* means the message never repeats).                                    */
/* ------------------------------------------------------------------ */

export const HONEST_FIT_KEY_SENTENCE = "I'd rather tell you than sell you.";

export function honestFitMessage(result: FitResult): string {
  const lines = [
    'The Mayor is built for businesses that live on appointments and calls. ' +
      `From what you've told me, that's not where your money leaks — ${HONEST_FIT_KEY_SENTENCE}`,
  ];
  for (const reason of result.reasons) lines.push(`• ${reason}`);
  lines.push(
    '',
    'If I\'ve got any of that wrong, say "continue anyway" and we\'ll set everything up like normal. ' +
      'Or say "not now" — no hard feelings either way.',
  );
  return lines.join('\n');
}
