/**
 * engine/grant-compiler.ts — §1.3.2 step 2: an owner's sentence
 * compiles to a DRAFT rule. Deterministic predicates + scope +
 * never_lines. Negations, named people, and money/customer scope
 * compile as hard lines, never folded into a paraphrase.
 *
 * The compiler is conservative by law (§5 grant corpus): anything it
 * cannot parse with confidence produces `asks` and disposition
 * 'ask' — ask-don't-act. It NEVER silently widens scope: unspecified
 * who defaults to the narrower reading per class, and a sentence
 * whose NEVER target can't be pinned is an ask, not a guess.
 */
import type {ActionClass,GrantCondition,GrantScope} from './types';
import {actionClassFromText,detectNeverGrantable} from './understanding';

export interface CompileResult {
 disposition: 'ready' | 'ask' | 'decline';
 /** The one-sentence decline when disposition is 'decline'. */
 decline?: string;
 actionClass: ActionClass | null;
 scope?: GrantScope;
 conditions?: GrantCondition[];
 neverLines?: string[];
 /** Send permissions riding inside another rule (§2.5 C-3: parsed
  * and displayed as a SEPARATE permission line — nothing rides in
  * silently). */
 riders?: ActionClass[];
 impliesExpiry?: boolean;
 expiresAt?: string | null;
 /** Open questions when disposition is 'ask' (or notes on a ready
  * compile the probe must surface). */
 asks: string[];
 plainSummary?: string;
}

const CLASS_LABELS: Record<ActionClass, string> = {
 schedule_new: 'Book appointments', reschedule: 'Reschedule appointments', cancel_booking: 'Cancel appointments',
 send_sms_reply: 'Text customers back', send_email_reply: 'Email customers back', answer_call: 'Answer calls',
 offer_alternate_slot: 'Offer another time', send_reminder: 'Send reminders', send_followup: 'Send follow-ups',
 winback_message: 'Send win-back messages', request_review: 'Ask for reviews', update_record: 'Update records',
 create_task: 'Create tasks',
};
const SEND_CLASSES: ReadonlySet<ActionClass> = new Set(['send_sms_reply', 'send_email_reply', 'send_reminder', 'send_followup', 'winback_message', 'request_review']);
const DAYS: Record<string, string> = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun', mondays: 'Mon', tuesdays: 'Tue', wednesdays: 'Wed', thursdays: 'Thu', fridays: 'Fri', saturdays: 'Sat', sundays: 'Sun' };

/** Sarcasm is never compiled literally. A joke marker ⇒ ask. */
const SARCASM = /\b(oh sure|oh perfect|oh yeah|yeah right|lol|haha|ha ha|lmao|just kidding|obviously just|great plan|that'?ll be great|love that|i never sleep|lol no)\b|right\?\s*$/i;

/** Double negations and self-correcting negations are genuinely
 * ambiguous — the owner must restate the rule plainly (§1.3.2:
 * ambiguity on a negation ⇒ ask, don't act). */
const DOUBLE_NEGATION = /\bdon'?t never\b|\bnever don'?t\b|\bisn'?t not\b|\bdon'?t not\b|\bnot that you can'?t\b|\bcan'?t (cancel|book|reschedule|text|email|move) without\b|\bunless\b[^.]{0,50}\bdon'?t actually mean\b/i;

/** Authority by vibe — "something I'd allow", "you know the drill" —
 * is never compiled (§1.3.5's inference ban, ask form). */
const UNCERTAIN_AUTHORITY = /\bif it seems like\b|\bsomething i'?d allow\b|\bthe way i usually\b|\blike i usually\b|\byou know the drill\b|\btake care of\b|\bdo the usual\b/i;

const VAGUE_WHO = [
 { pattern: /\banyone (important|who matters|serious|worth it|special|who seems|who deserves|relevant)\b/i, why: 'who counts as that is not pinned down' },
 { pattern: /\banyone worth\b/i, why: 'who counts as worth it is not pinned down' },
 { pattern: /\b(good|best|top|favorite|favourite) customers\b/i, why: 'which customers those are is not pinned down' },
 { pattern: /\bmy (loyal|best|favorite|favourite) (ones|people|customers|clients|crowd)\b|\bbest people\b/i, why: 'who those people are is not pinned down' },
 { pattern: /\bpeople (i|we) like\b/i, why: 'who those people are is not pinned down' },
 { pattern: /\b(the|my) usual\b/i, why: 'who "the usual" are is not pinned down' },
];

const VAGUE_NEVER_TOKENS = new Set(['usual', 'suspects', 'stuff', 'things', 'whatever', 'ones', 'them', 'those', 'people', 'anyone', 'everyone']);

/** NEVER-clause fragments: from a negation trigger to the clause
 * boundary. Fragments keep the owner's words (gate guards are parsed
 * from them; the card renders them verbatim). */
export function extractNeverFragments(text: string): string[] {
 const fragments: string[] = [];
 const trigger = /(never|don'?t ever|except|but not|but never|unless|just not|don'?t (?:text|email|call|message))\b/gi;
 let m: RegExpExecArray | null;
 while ((m = trigger.exec(text))) {
  const start = m.index;
  const rest = text.slice(start);
  // Clause boundary — but a period after an honorific ("Mr. Ortiz")
  // is not a boundary; skip those and keep scanning.
  const after = rest.slice(m[0].length);
  const boundaryRe = /[,;]|\.\s|\sbut\s|\sand never\b|\s—\s|\s--\s/gi;
  let boundary = -1;
  let bm: RegExpExecArray | null;
  while ((bm = boundaryRe.exec(after))) {
   if (bm[0].startsWith('.')) {
    const wordBefore = after.slice(0, bm.index).match(/([A-Za-z]+)$/)?.[1]?.toLowerCase();
    if (wordBefore && ['mr', 'mrs', 'ms', 'dr', 'st'].includes(wordBefore)) continue;
   }
   boundary = bm.index;
   break;
  }
  const end = boundary === -1 ? rest.length : m[0].length + boundary;
  const fragment = rest.slice(0, end).trim().replace(/\.$/, '').replace(/^but\s+(?=never\b)/i, '');
  if (fragment.length > 3) fragments.push(fragment);
 }
 // "anyone but <Name>" — the bare-but form with a capitalized name.
 const butName = text.match(/\bbut\s+(the\s+)?([A-Z][a-z]+(?:s)?)\b/);
 if (butName && !fragments.some(f => f.toLowerCase().includes(butName[2].toLowerCase()))) {
  fragments.push(`but ${butName[1] ?? ''}${butName[2]}`.trim());
 }
 // Channel nevers in any verb frame: "don't follow up BY TEXT",
 // "no email blasts", "never in a text" — the protected thing is the
 // channel itself, whatever verb carries it.
 const chanNever = /\b(?:never|don'?t|no)\b[^.;,]{0,45}?\b(text|email|e-mail|phone|call)\b/gi;
 let cm: RegExpExecArray | null;
 while ((cm = chanNever.exec(text))) {
  const span = cm[0].trim();
  const channelWord = cm[1].toLowerCase();
  const triggerWord = span.split(/\s+/)[0].toLowerCase();
  if (!fragments.some(f => f.toLowerCase().includes(channelWord) && f.toLowerCase().includes(triggerWord))) fragments.push(span);
 }
 return fragments;
}

/** Guards parsed from a never fragment — what the gate machine-checks. */
export type NeverGuard =
 | { kind: 'day'; days: string[] }
 | { kind: 'hour_after'; hour: number }
 | { kind: 'hour_before'; hour: number }
 | { kind: 'channel'; channel: 'sms' | 'email' | 'phone' }
 | { kind: 'name'; tokens: string[] };

export function guardsFromFragment(fragment: string): NeverGuard[] {
 const f = fragment.toLowerCase();
 const guards: NeverGuard[] = [];
 const dayHits = Object.keys(DAYS).filter(d => new RegExp(`\\b${d}\\b`).test(f));
 if (/\bweekends?\b/.test(f)) dayHits.push('saturday', 'sunday');
 if (/\bweekdays?\b/.test(f) && /\bnever|except|but\b/.test(f)) dayHits.push('monday', 'tuesday', 'wednesday', 'thursday', 'friday');
 if (dayHits.length) guards.push({ kind: 'day', days: [...new Set(dayHits.map(d => DAYS[d]))] });
 const after = f.match(/after\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
 if (after) {
  let hour = parseInt(after[1], 10);
  if (after[3] === 'pm' && hour < 12) hour += 12;
  if (after[3] === 'am' && hour === 12) hour = 0;
  guards.push({ kind: 'hour_after', hour });
 }
 if (/\bat night\b|\bafter dark\b|\bovernight\b/.test(f)) guards.push({ kind: 'hour_after', hour: 21 });
 const chan = f.match(/\b(email|e-mail|text|sms|call|phone)\b/);
 if (chan && /\b(never|don'?t|except|but)\b/.test(f) && guards.length === 0) {
  guards.push({ kind: 'channel', channel: chan[1].startsWith('e') ? 'email' : chan[1] === 'call' || chan[1] === 'phone' ? 'phone' : 'sms' });
 }
 if (guards.length === 0) {
  // Name guard: what's left after triggers, articles, and verbs.
  const tokens = f.replace(/^(never|don'?t ever|except|but not|but never|but|don'?t|unless|just not|just)\s+/, '')
   .replace(/\b(mr|mrs|ms|dr|the|a|an)\b\.?/g, ' ')
   .replace(/\b(book|text|email|call|message|move|reschedule|cancel|schedule|answer|send|let|allow|have|any|on|in|at|for|to|it|its|with|them|they|their)\b/g, ' ')
   .split(/[^a-z']+/).filter(tok => tok.length > 1 && !VAGUE_NEVER_TOKENS.has(tok));
  if (tokens.length) guards.push({ kind: 'name', tokens });
 }
 return guards;
}

function parseWho(text: string, actionClass: ActionClass): { who: GrantScope['who']; whoNames?: string[]; ask?: string } {
 const t = text.toLowerCase();
 for (const v of VAGUE_WHO) if (v.pattern.test(text)) return { who: 'any_customer', ask: `Who exactly should this rule cover? (${v.why}.)` };
 if (/\banyone but\b|\beveryone except\b|\ball except\b|\banybody but\b|\beverybody except\b/.test(t)) {
  const frag = extractNeverFragments(text).find(fr => /but|except/i.test(fr));
  const guards = frag ? guardsFromFragment(frag) : [];
  const name = guards.find(g => g.kind === 'name') as Extract<NeverGuard, { kind: 'name' }> | undefined;
  return { who: 'not_named', whoNames: name?.tokens ?? [] };
 }
 const onlyNames = text.match(/\b[Oo]nly\s+([A-Z][a-z]+(?:\s*(?:,|and|&)\s*[A-Z][a-z]+)*)/) ?? text.match(/\bjust\s+([A-Z][a-z]+(?:\s*(?:,|and|&)\s*[A-Z][a-z]+)*)/);
 if (onlyNames) {
  const names = onlyNames[1].split(/\s*(?:,|and|&)\s*/).map(s => s.trim()).filter(Boolean);
  if (names.length) return { who: 'named', whoNames: names };
 }
 // "Anyone except X" — an exclusion scope. It is checked BEFORE the
 // VIP shortcut: "anyone except VIP clients" excludes VIPs; letting
 // the shortcut win would invert the rule into VIPs-only AND the
 // never line would then exclude them too — a grant that covers
 // nobody and a summary that lies about it.
 if (/\b(anyone|everyone|anybody|everybody)\s+except\b/.test(t)) {
  const frag = extractNeverFragments(text).find(fr => /except/i.test(fr));
  const guards = frag ? guardsFromFragment(frag) : [];
  const name = guards.find(g => g.kind === 'name') as Extract<NeverGuard, { kind: 'name' }> | undefined;
  return { who: 'not_named', whoNames: name?.tokens ?? [] };
 }
 if (/\bvips?\b/i.test(text)) return { who: 'named', whoNames: ['VIP'] };
 // "Nobody but X" means ONLY X.
 const nobodyBut = text.match(/\b[Nn]obody but\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/) ?? text.match(/\b[Nn]o one but\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
 if (nobodyBut) return { who: 'named', whoNames: [nobodyBut[1]] };
 // A named person as the act's target — MAIN CLAUSE ONLY (a name in
 // the never clause is the excluded party, never the scope):
 // possessive ("Tom Becker's"), a verb-adjacent name ("Text Dana
 // Whitfield"), a to/for/with list ("to Priya and Leo"), or a family
 // name ("the Nguyen twins").
 const mainOrig = text.slice(0, Math.max(0, (() => { const i = t.search(/\bnever\b|\bexcept\b/); return i === -1 ? text.length : i; })()));
 const NAME_STOP = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Google', 'VIP']);
 const possessive = mainOrig.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)'s\b/);
 if (possessive && !NAME_STOP.has(possessive[1])) return { who: 'named', whoNames: [possessive[1]] };
 const family = mainOrig.match(/\bthe\s+([A-Z][a-z]+)\s+(family|twins|brothers|sisters)\b/);
 if (family) return { who: 'named', whoNames: [family[1]] };
 const listed = mainOrig.match(/\b(?:to|for|with)\s+((?:Mrs?\.?\s+|Ms\.?\s+|Dr\.?\s+)?[A-Z][a-z]+(?:\s[A-Z][a-z]+)?(?:\s*(?:,|and)\s*(?:Mrs?\.?\s+|Ms\.?\s+|Dr\.?\s+)?[A-Z][a-z]+)?)\b/);
 if (listed) {
  const names = listed[1].split(/\s*(?:,|and)\s*/).map(s => s.replace(/^(Mrs?|Ms|Dr)\.?\s+/i, '').trim()).filter(s => s && !NAME_STOP.has(s));
  if (names.length) return { who: 'named', whoNames: names };
 }
 const adjacent = mainOrig.match(/(?:^|\b(?:text|email|call|message|remind|send to|book|cancel|reschedule|update|follow up with|Text|Email|Call|Message|Remind|Book|Cancel|Reschedule|Update))\s+((?:Mrs?\.?\s+|Ms\.?\s+|Dr\.?\s+)?[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/);
 if (adjacent) {
  const name = adjacent[1].replace(/^(Mrs?|Ms|Dr)\.?\s+/i, '').trim();
  if (name && !NAME_STOP.has(name) && !/^(the|a|an|my|our|your|their|any|every|this|that|anyone|everyone|them|they|people|customers|clients|patients)$/i.test(name)) return { who: 'named', whoNames: [name] };
 }
 /* Scope comes from the MAIN clause only — an "anyone" inside the
  * never clause ("never to anyone who left a one-star review") is an
  * exclusion target, not the covered population. */
 const main = (t.split(/\bnever\b|\bexcept\b/)[0] ?? t).replace(/,?\s*but\s*$/, '');
 // "Anyone WITH a booking" is an existing customer by definition.
 if (/\banyone\b[^.]{0,40}\b(booked|booking|appointment|scheduled)\b/.test(main)) return { who: 'existing_customers_only' };
 if (/\b(regulars?|existing customers|current customers|clients on file|people in the system|my customers|my clients|repeat customers|lapsed|clients|customers|patients|students|members|guests)\b/.test(main)) return { who: 'existing_customers_only' };
 if (/\b(anyone|everyone|anybody|everybody|whoever|any customer|any client|new customers)\b/.test(main)) return { who: 'any_customer' };
 // Unspecified: the narrower reading per class (blueprint: SMS-class
 // grants start scoped to existing customers until widened).
 return { who: SEND_CLASSES.has(actionClass) ? 'existing_customers_only' : 'any_customer' };
}

function parseConditions(text: string): GrantCondition[] {
 const conditions: GrantCondition[] = [];
 const t = text.toLowerCase();
 const under = t.match(/(?:under|below|less than|no more than|up to)\s*\$?([\d][\d,]*)/) ?? t.match(/\$([\d][\d,]*)\s*or less\b/);
 const over = t.match(/(?:over|above|more than)\s*\$?([\d][\d,]*)/);
 if (under) conditions.push({ kind: 'amount_lte_cents', value: parseInt(under[1].replace(/,/g, ''), 10) * 100, label: `under $${under[1]}` });
 else if (over && /(check|ask|confirm|okay|ok)\b[^.]{0,25}(me|with me|first)/.test(t)) conditions.push({ kind: 'amount_lte_cents', value: parseInt(over[1].replace(/,/g, ''), 10) * 100, label: `$${over[1]} and under` });
 const visits = t.match(/(?:at least|minimum of|min\.?)\s*(\d+)\s*(visits|times|appointments)/);
 if (visits) conditions.push({ kind: 'caller_visits_gte', value: parseInt(visits[1], 10), label: `caller has ${visits[1]}+ visits` });
 if (/\bweekdays only\b|\bmonday (to|through|-) friday\b/.test(t)) {
  conditions.push({ kind: 'day_not_in', value: 'Sat', label: 'weekdays only' }, { kind: 'day_not_in', value: 'Sun', label: 'weekdays only' });
 }
 return conditions;
}

function parseExpiry(text: string, now: Date): { expiresAt: string | null; impliesExpiry: boolean } {
 const t = text.toLowerCase();
 const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
 if (/\b(today|tonight) only\b|\bjust (for )?today\b|\bfor today\b/.test(t)) return { expiresAt: endOfDay(now).toISOString(), impliesExpiry: true };
 if (/\bthis week only\b|\bjust (for )?this week\b|\buntil the end of the week\b/.test(t)) return { expiresAt: new Date(now.getTime() + 7 * 86400_000).toISOString(), impliesExpiry: true };
 if (/\bthis month only\b|\bfor the rest of this month\b/.test(t)) return { expiresAt: new Date(now.getTime() + 30 * 86400_000).toISOString(), impliesExpiry: true };
 if (/\bjust this weekend\b|\bthis weekend only\b/.test(t)) { const d = new Date(now); const add = (7 - d.getDay()) % 7; return { expiresAt: endOfDay(new Date(now.getTime() + add * 86400_000)).toISOString(), impliesExpiry: true }; }
 const throughDay = t.match(/\bthrough (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
 if (throughDay) {
  const target = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(throughDay[1]);
  const d = new Date(now); let add = (target - d.getDay() + 7) % 7; if (add === 0) add = 7;
  return { expiresAt: endOfDay(new Date(now.getTime() + add * 86400_000)).toISOString(), impliesExpiry: true };
 }
 if (/\bon vacation\b|\bwhile i'?m away\b/.test(t)) return { expiresAt: new Date(now.getTime() + 14 * 86400_000).toISOString(), impliesExpiry: true };
 const nextDays = t.match(/for the next (\d+) days?/);
 if (nextDays) return { expiresAt: new Date(now.getTime() + parseInt(nextDays[1], 10) * 86400_000).toISOString(), impliesExpiry: true };
 const untilDay = t.match(/until (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
 if (untilDay) {
  const target = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(untilDay[1]);
  const d = new Date(now); let add = (target - d.getDay() + 7) % 7; if (add === 0) add = 7;
  return { expiresAt: endOfDay(new Date(now.getTime() + add * 86400_000)).toISOString(), impliesExpiry: true };
 }
 return { expiresAt: null, impliesExpiry: false };
}

export function compileGrant(utterance: string, now: Date = new Date()): CompileResult {
 const text = utterance.trim();
 const asks: string[] = [];

 const decline = detectNeverGrantable(text);
 if (decline) return { disposition: 'decline', decline, actionClass: null, asks: [] };

 if (SARCASM.test(text)) {
  return { disposition: 'ask', actionClass: actionClassFromText(text), asks: ['That sounded like a joke — I never take a rule literally when it might be one. Should this be a real rule? Say it plainly and tell me who it covers.'] };
 }

 if (DOUBLE_NEGATION.test(text)) {
  return { disposition: 'ask', actionClass: actionClassFromText(text), neverLines: extractNeverFragments(text), asks: ['That one folds back on itself — I can\'t tell if the rule allows this or blocks it. Say it once, plainly: who can I do this for, and who is off-limits?'] };
 }

 if (UNCERTAIN_AUTHORITY.test(text)) {
  return { disposition: 'ask', actionClass: actionClassFromText(text), asks: ['I can\'t run on "like you would" — my rules have to be your words, with the edges named. Say it as a rule: who it covers, and who it never does.'] };
 }

 /* The class comes from the MAIN clause when it speaks — a channel
  * named only inside the never clause ("text them, don't email
  * them") must not reclass the act. */
 const triggerIdx = text.search(/(never|don'?t ever|except|but not|but never|unless|don'?t (?:text|email|call|message))\b/i);
 const head = triggerIdx > 0 ? text.slice(0, triggerIdx) : text;
 const actionClass = actionClassFromText(head) ?? actionClassFromText(text);
 if (!actionClass) {
  return { disposition: 'ask', actionClass: null, asks: ['Which act should this rule cover — booking, rescheduling, cancelling, texting back, or something else?'] };
 }

 const neverLines = extractNeverFragments(text);
 for (const fragment of neverLines) {
  const guards = guardsFromFragment(fragment);
  if (guards.length === 0) {
   asks.push(`Your "never" line — "${fragment}" — has a target I can't pin down. Who or what exactly should it protect?`);
  }
 }

 const whoResult = parseWho(text, actionClass);
 if (whoResult.ask) asks.push(whoResult.ask);

 const conditions = parseConditions(text);
 // NEVER fragments with day/hour guards become machine conditions too
 // (the fragment stays the display + provenance truth).
 for (const fragment of neverLines) {
  for (const guard of guardsFromFragment(fragment)) {
   if (guard.kind === 'day') for (const day of guard.days) {
    if (!conditions.some(c => c.kind === 'day_not_in' && c.value === day)) conditions.push({ kind: 'day_not_in', value: day, label: `never on ${day}` });
   }
   if (guard.kind === 'hour_after') conditions.push({ kind: 'hour_after', value: guard.hour, label: `never after ${guard.hour}:00` });
   if (guard.kind === 'hour_before') conditions.push({ kind: 'hour_before', value: guard.hour, label: `never before ${guard.hour}:00` });
  }
 }

 const riders: ActionClass[] = [];
 const riderMatch = text.toLowerCase().match(/\b(?:and|then)\s+(?:also\s+)?(text|email|message)\b[^.]{0,20}\b(them|the customer|it over|the new time)\b/);
 if (riderMatch) {
  const riderClass: ActionClass = riderMatch[1] === 'email' ? 'send_email_reply' : 'send_sms_reply';
  if (riderClass !== actionClass && !riders.includes(riderClass)) riders.push(riderClass);
 }

 const { expiresAt, impliesExpiry } = parseExpiry(text, now);
 const when: GrantScope['when'] = /\b(business hours|working hours|office hours)\b/i.test(text) ? 'business_hours' : 'any_time';
 const channel: GrantScope['channel'] = actionClass === 'send_sms_reply' ? 'sms' : actionClass === 'send_email_reply' ? 'email' : actionClass === 'answer_call' ? 'phone' : 'any';

 const scope: GrantScope = {
  who: whoResult.who, ...(whoResult.whoNames ? { whoNames: whoResult.whoNames } : {}),
  what: 'any_service', when, channel,
  limits: { maxMessagesPerPersonPerDay: 1 },
 };

 const whoLabel = scope.who === 'any_customer' ? 'any customer' : scope.who === 'existing_customers_only' ? 'existing customers' : scope.who === 'named' ? `only ${(scope.whoNames ?? []).join(' and ')}` : `anyone except ${(scope.whoNames ?? []).join(', ')}`;
 const condLabel = conditions.length ? ` when ${[...new Set(conditions.map(c => c.label))].join(' and ')}` : '';
 const summary = `${CLASS_LABELS[actionClass]} for ${whoLabel}${condLabel}.${neverLines.length ? ` Never: ${neverLines.map(f => f.replace(/^never\s+/i, '')).join('; ')}.` : ''}`;

 if (asks.length) return { disposition: 'ask', actionClass, scope, conditions, neverLines, riders, impliesExpiry, expiresAt, asks, plainSummary: summary };
 return { disposition: 'ready', actionClass, scope, conditions, neverLines, riders, impliesExpiry, expiresAt, asks: [], plainSummary: summary };
}
