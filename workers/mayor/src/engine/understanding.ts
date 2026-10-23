/**
 * engine/understanding.ts — Stage 3 (blueprint §1.1). Deterministic
 * parsers first: dates, numbers, "never", "always", the verbs that
 * carry acts. Anything the parsers cannot fully determine is flagged
 * in `ambiguities` and `deterministic:false` — it routes to Stage 5
 * or to prepare-and-ask, never to a guess. A generative model, when
 * one is wired, may only produce a structured Understanding object;
 * it never acts directly.
 */
import type {ActionClass,IntentClass,Understanding} from './types';
import {parseCashText} from '../cashtext/talk';

const lower = (s: string) => s.toLowerCase();

/** The never-grantable classes (§1.3.5), detected on grant language.
 * Each returns the one-sentence conversational decline. */
const NEVER_GRANTABLE: Array<{ pattern: RegExp; decline: string }> = [
 { pattern: /\brefund/i, decline: "I can't take standing authority for refunds — every refund stays your call, one at a time." },
 { pattern: /\b(charge|debit|run|swipe)\b[^.]{0,40}\b(card|anyone|them|customers?|clients?)\b/i, decline: "I can't take standing authority to charge anyone's card — money movement is always your tap, never a standing rule." },
 { pattern: /\bcharge\b[^.]{0,30}\bno-?show/i, decline: "I can't take standing authority to charge a no-show fee — money movement is always your tap, never a standing rule." },
 { pattern: /\b(discount|coupon)\w*|\bpercent off\b|\b% off\b|\bwaiv\w*\b|\bprice cut\b|\blower the price\b/i, decline: "I can't take standing authority to discount or waive prices — prices come from your catalog, and changing them is your call each time." },
 { pattern: /\bsign\b[^.]{0,40}\b(contract|agreement|lease|terms)\b|\baccept\b[^.]{0,30}\bterms\b[^.]{0,20}\b(for|behalf)\b|\bsign\b[^.]{0,50}\b(whatever|anything|everything)\b/i, decline: "I can't sign or accept contracts for you — that signature has to be yours, each time." },
 { pattern: /\b(delete|erase|wipe|purge|remove)\b[^.]{0,40}\b(records?|customer|client|data|files|history)\b/i, decline: "I can't take standing authority to delete records — deletion is a deliberate act we confirm one at a time." },
 { pattern: /\b(tell|give|share|show)\b[^.]{0,50}\b(what|how much|when)\b[^.]{0,30}\b(paid|booked|ordered)\b|\bshare\b[^.]{0,40}\b(info|details|number|email|address)\b[^.]{0,20}\b(with|to)\b/i, decline: "I can't share one customer's information with another person — not as a rule, not ever." },
 { pattern: /\b(post|publish|reply)\b[^.]{0,40}\b(reviews?|facebook|instagram|google|page|social)\b|\breply to reviews\b/i, decline: "I can't post publicly or reply to reviews on a standing rule — I'll draft them, and you post." },
 { pattern: /\b(legal advice|medical advice|diagnose|prescribe)\b|\btell (them|customers|people) (they|if they)\b[^.]{0,40}\b(legal|medical|lawsuit|liable)\b|\b(legally required|required by law|the law (says|requires|mandates))\b/i, decline: "I can't give definitive legal, medical, or financial advice to customers — I can prepare the facts for you instead." },
 { pattern: /\b(approve|sign|process)\b[^.]{0,40}\b(loan|financing|paperwork)\b|\b(loan|financing)\b[^.]{0,30}\b(approve|sign|paperwork)\b/i, decline: "I can't approve loans, financing, or contracts for you — those signatures and decisions stay yours, one at a time." },
 { pattern: /\bpay\b[^.]{0,40}\b(invoices?|bills?|supplier|vendor)\b/i, decline: "I can't take standing authority to pay invoices or bills — money movement is always your tap, never a standing rule." },
 { pattern: /\b(like i would|as you see fit|use your (own )?judgment|whatever you think is best|you know what i like)\b[^.]{0,60}\b(approv|decid|choos|handl|rule|authorit)\b|\bdecide for me\b[^.]{0,40}\b(approv|allow|authorit)\b/i, decline: "Authority only changes when you say the rule out loud and confirm it — I never widen my own authority by inference." },
 { pattern: /\b(approv|decid|authoriz)\w*\b[^.]{0,60}\blike i would\b|\bjust be me\b|\bdecide like i\b|\byou know what i like\b/i, decline: "Authority only changes when you say the rule out loud and confirm it — I never widen my own authority by inference." },
];

export function detectNeverGrantable(text: string): string | null {
 for (const entry of NEVER_GRANTABLE) if (entry.pattern.test(text)) return entry.decline;
 return null;
}

/* Purpose-first ordering: the class a rule is ABOUT (a review ask, a
 * reminder, a win-back) outranks the CHANNEL it travels on (text,
 * email) — "send a reminder text" is a reminder rule that happens to
 * travel by text. Stems match without a trailing boundary so noun
 * forms ("a reminder", "reviews", "slots") classify too. */
const ACT_VERBS: Array<{ pattern: RegExp; actionClass: ActionClass }> = [
 { pattern: /\bask\b[^.]{0,40}\breview|\brequest\b[^.]{0,30}\breview|\bleave\b[^.]{0,30}\breview/i, actionClass: 'request_review' },
 /* CashText send classes (spec §3.1/§3.3): named here so grant
  * language about them reaches the compiler — which REFUSES them
  * (NEVER_LIVE fence) — and so Stage 5 can classify free-form
  * invoice talk. The deterministic CashText parser itself lives in
  * src/cashtext/talk.ts and runs before these act verbs in
  * parseUnderstanding. */
 { pattern: /\bchase\b[^.]{0,40}\b(invoice|payment|bill|owes|overdue|balance)|\bchase\b\s+[A-Z]|\bremind\b[^.]{0,30}\b(invoice|payment|owes|overdue invoice)/i, actionClass: 'send_invoice_chase' },
 /* Invoice as the ACT (create + send a new bill) — NOT "invoice copy"
  * (an email-reply act the grant corpus pins as send_email_reply). */
 { pattern: /\binvoice\s+(?!copy\b)(?:anyone|everyone|anybody|customers?|clients?|people|[A-Z])|\b(?:send|issue|create)\b[^.]{0,20}\binvoice\b(?!\s*copy)|\bsend\b[^.]{0,20}\bbill\b|\bbill\b[^.]{0,30}\bfor\b/i, actionClass: 'send_invoice' },
 { pattern: /\bwin[ -]?backs?\b|\blapsed\b|\b(haven'?t|hasn'?t) (seen|booked|ordered|visited|been)|\bcome[- ]back\b[^.]{0,30}\b(message|text|email|invite)|\boverdue\b[^.]{0,40}\b(send|email|text|message|note)/i, actionClass: 'winback_message' },
 { pattern: /\bremind/i, actionClass: 'send_reminder' },
 { pattern: /\bfollow ?up\b|\bcheck\b[^.]{0,40}\b(happy|feeling|running|doing|went|okay)|\bsee how\b[^.]{0,40}\b(feeling|doing|went|is)\b/i, actionClass: 'send_followup' },
 { pattern: /\bupdate\b|\bchange\b[^.]{0,30}\b(record|chart|profile|address)\b/i, actionClass: 'update_record' },
 { pattern: /\b(create|make|add|open)\b[^.]{0,25}\btask\b/i, actionClass: 'create_task' },
 { pattern: /\banswer\b[^.]{0,30}\b(calls?|phone|it|them)\b|\bpick up\b[^.]{0,20}\bphone\b|\bphone rings\b/i, actionClass: 'answer_call' },
 { pattern: /\boffer/i, actionClass: 'offer_alternate_slot' },
 { pattern: /\bemail\b[^.]{0,20}\bback\b/i, actionClass: 'send_email_reply' },
 { pattern: /\b(text|message)\b[^.]{0,20}\bback\b/i, actionClass: 'send_sms_reply' },
 { pattern: /\breschedul/i, actionClass: 'reschedule' },
 { pattern: /\bmove\b[^.]{0,40}\b(appointments?|booking|visit|another day|to (thursday|friday|monday|tuesday|wednesday|saturday|sunday|tomorrow))\b/i, actionClass: 'reschedule' },
 { pattern: /\bcancel\b/i, actionClass: 'cancel_booking' },
 { pattern: /\bprioritize\b[^.]{0,50}\bappointments?\b/i, actionClass: 'schedule_new' },
 { pattern: /\bbook(ed|ing|s)?\b|\bschedule\b/i, actionClass: 'schedule_new' },
 { pattern: /\bemail\b/i, actionClass: 'send_email_reply' },
 { pattern: /\b(text|sms|message)\b/i, actionClass: 'send_sms_reply' },
 { pattern: /\bcalls?\b/i, actionClass: 'answer_call' },
];

export function actionClassFromText(text: string): ActionClass | null {
 for (const v of ACT_VERBS) if (v.pattern.test(text)) return v.actionClass;
 return null;
}

const REVOCATION_ACTION_WORDS: Array<{ pattern: RegExp; classes: ActionClass[] }> = [
 { pattern: /\b(text|texting|sms|messag)/i, classes: ['send_sms_reply', 'send_reminder', 'send_followup', 'winback_message'] },
 { pattern: /\b(email|emailing)/i, classes: ['send_email_reply'] },
 { pattern: /\b(call|calling|phone)/i, classes: ['answer_call'] },
 { pattern: /\b(book|booking|schedule)/i, classes: ['schedule_new'] },
 { pattern: /\b(reschedul|mov)/i, classes: ['reschedule'] },
 { pattern: /\bcancel/i, classes: ['cancel_booking'] },
];

/** Extract a person's name following a verb/preposition in an
 * instruction ("Text Dana…", "move it for Marcus") — capitalized in
 * the original where possible; a small stopword guard keeps verbs
 * and weekdays from becoming people. */
const NAME_STOPWORDS = new Set(['the','a','an','my','me','it','this','that','them','anyone','everyone','whoever','tomorrow','today','monday','tuesday','wednesday','thursday','friday','saturday','sunday','next','last','please']);
export function extractTargetPerson(text: string): string | null {
 const m = text.match(/\b(?:text|email|call|message|remind|book|schedule|move|reschedule|cancel|ask)\s+(?:it\s+)?(?:for\s+|to\s+)?([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/)
  ?? text.match(/^(?:Text|Email|Call|Message|Remind|Book|Schedule|Move|Reschedule|Cancel|Ask)\s+(?:it\s+)?(?:for\s+|to\s+)?([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/)
  ?? text.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(?:asked|wants|needs|said)\b/);
 if (!m) return null;
 const name = m[1].trim();
 if (NAME_STOPWORDS.has(lower(name.split(' ')[0]))) return null;
 return name;
}

export interface TurnContextFlags {
 mode: 'onboarding' | 'supervised' | 'talk';
 onboardingStage?: string;
 pendingScenario: boolean;
}

export function parseUnderstanding(rawText: string, flags: TurnContextFlags): Understanding {
 const text = rawText.trim();
 const t = lower(text);
 const base: Understanding = { intentClass: 'plain', deterministic: true, ambiguities: [], facts: {} };

 // Scenario rulings arrive as buttons; the text fallback is a bare
 // ruling word while a scenario is the current question.
 if (flags.pendingScenario && /^(allowed|block(ed)?|yes( that'?s right)?|no( block (it|that))?|right|wrong|correct|not right)\.?$/i.test(t)) {
  return { ...base, intentClass: 'scenario_ruling', ruling: /^(allowed|yes|right|correct)/i.test(t) ? 'allowed' : 'blocked' };
 }

 // Revocation — one sentence, mid-conversation (§1.3.3).
 if (/\b(stop|revoke|take back|cancel the rule|no more)\b/i.test(text) && (/\b(stop|revoke|take back)\b/i.test(text) || /\bon your own\b|\bwithout asking\b|\banymore\b/i.test(text))) {
  if (/\b(stop|revoke|take back|cancel|no more)\b/i.test(text) && (REVOCATION_ACTION_WORDS.some(w => w.pattern.test(text)) || /\brule/i.test(text) || /\bon your own\b/i.test(text))) {
   return { ...base, intentClass: 'revocation' };
  }
 }
 if (/^(never|don'?t)\b[^.]{0,50}\b(again|anymore)\b/i.test(text) && actionClassFromText(text)) {
  return { ...base, intentClass: 'revocation' };
 }

 // Audit questions — answered from the ActionLog, quoting the rule.
 if (/\bwhat did you do\b|\bwhat have you done\b|\bwhy did you (text|email|call|book|move|cancel|message|remind)\b|\bshow me what you/i.test(text)) {
  const person = extractTargetPerson(text);
  return { ...base, intentClass: 'audit_query', ...(person ? { targetPerson: person } : {}) };
 }

 // CashText (spec §3.1): the deterministic talk forms — invoice,
 // chase, who-owes, cash summary — settle HERE, before grant/act
 // parsing can claim the verbs. Ambiguity is carried on the intent
 // (a missing amount stays missing); the loop asks, never acts.
 const cashtext = parseCashText(text);
 if (cashtext) {
  return {
   ...base, intentClass: 'cashtext', deterministic: true, cashtext,
   ...(cashtext.kind === 'invoice' ? { actionClass: 'send_invoice' as ActionClass, targetPerson: cashtext.personName, facts: { personName: cashtext.personName, ...(cashtext.amountCents !== undefined ? { amountCents: cashtext.amountCents } : {}) } } : {}),
   ...(cashtext.kind === 'chase' ? { actionClass: 'send_invoice_chase' as ActionClass, targetPerson: cashtext.personName, facts: { personName: cashtext.personName } } : {}),
  };
 }

 // Connect the calendar, in conversation (§2.5 C-1).
 if (/\bconnect\b[^.]{0,30}\bcalendar\b|\buse my (google |microsoft |outlook )?calendar\b|\blink\b[^.]{0,20}\bcalendar\b/i.test(text)) {
  return { ...base, intentClass: 'connect_calendar' };
 }

 // "Everything needs my OK" — a first-class onboarding outcome.
 if (/\beverything needs my ok\b|\bask me (first|before)\b[^.]{0,20}\beverything\b|\bnothing without asking me\b/i.test(text)) {
  return { ...base, intentClass: 'onboarding_step', facts: {}, ambiguities: ['owner_declined_grant'] };
 }

 // Corrections — the owner's word versions memory in the same turn.
 if (/^(actually|no[,.—-]|correction\b|wait,)/i.test(text) || /\bwe (close|open) at\b|\bit'?s [^.]{1,40} not \b|\bnot \d{1,2}(:\d{2})?\s*(am|pm)?\s*[—–-]?\s*(we|it'?s)\b/i.test(text)) {
  return { ...base, intentClass: 'correction' };
 }

 // Grant statements — standing language about future acts.
 const grantLead = /\b(you can|go ahead|feel free|from now on|whenever|any ?time|always|just)\b/i.test(text) || /\banyone who asks\b/i.test(text);
 const grantVerb = actionClassFromText(text);
 // A direct instruction to ONE named person is an act, not a standing
 // rule — scope words (anyone/everyone/customers…) are what make a
 // sentence a rule. This check runs before the grant branch because
 // an imperative verb ("Text Marcus…") otherwise reads as one.
 const personEarly = extractTargetPerson(text);
 const scopeWordy = /\b(anyone|anybody|everyone|everybody|whoever|whomever|customers?|clients?|people|regulars|callers?|patients?|guests?)\b/i.test(text);
 if (grantVerb && personEarly && !scopeWordy && !/without (asking|checking with) me/i.test(text)) {
  return { ...base, intentClass: 'customer_act', actionClass: grantVerb, targetPerson: personEarly, facts: { personName: personEarly } };
 }
 if (grantVerb && (grantLead || /^(reschedule|book|schedule|cancel|text|email|remind|answer|offer|move)\b/i.test(text) || /\banyone\b|\beveryone\b|\bwhoever\b|\bregulars\b|\bcustomers\b|\bclients\b|\bpeople\b/i.test(text))) {
  return { ...base, intentClass: 'grant_statement', actionClass: grantVerb, grantText: text, deterministic: true };
 }

 // A specific act, now, aimed at a customer.
 const person = extractTargetPerson(text);
 if (grantVerb && person) {
  return { ...base, intentClass: 'customer_act', actionClass: grantVerb, targetPerson: person, facts: { personName: person, personKnown: undefined } };
 }
 if (/\b(asked|wants|needs) to (move|reschedule|cancel|book|change)\b/i.test(text) && person) {
  return { ...base, intentClass: 'customer_act', actionClass: actionClassFromText(text) ?? 'reschedule', targetPerson: person, facts: { personName: person } };
 }

 // Onboarding's first line: "Name, trade, Town" or a pasted link.
 if (flags.mode === 'onboarding' && (flags.onboardingStage === undefined || flags.onboardingStage === 'canvas')) {
  if (/https?:\/\/|www\./i.test(text) || (text.match(/,/g) ?? []).length >= 1 || /\b(barber|salon|dental|plumb|restaurant|cafe|auto|repair|groom|spa|clinic|bakery|gym|florist|law|account)/i.test(text)) {
   return { ...base, intentClass: 'shop_intro' };
  }
 }

 // Anything act-shaped we could not fully parse is NOT deterministic:
 // it goes to Stage 5 / prepare-and-ask, never to a guess.
 if (grantVerb || /\brule\b|\bpermission\b|\bauthority\b/i.test(text)) {
  return { ...base, intentClass: 'plain', deterministic: false, ambiguities: ['unparsed_act_language'], ...(grantVerb ? { actionClass: grantVerb } : {}) };
 }
 if (/^(handle|deal with|sort out|fix|take care of)\b/i.test(text)) {
  return { ...base, intentClass: 'plain', deterministic: false, ambiguities: ['vague_instruction'] };
 }
 return base;
}

/** The action classes a revocation sentence names (empty = the
 * sentence was general — "stop … on your own" — and every standing
 * class it plausibly covers is revoked; the reply names them). */
export function revocationClasses(text: string): ActionClass[] {
 const out: ActionClass[] = [];
 for (const w of REVOCATION_ACTION_WORDS) if (w.pattern.test(text)) out.push(...w.classes);
 return [...new Set(out)];
}
