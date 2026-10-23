/**
 * engine/loop.ts — the 11-stage loop, live for owner conversation
 * (blueprint §1.1, §5 Slice 2). Stages 0–7 + 10–11 run here; Stage 8
 * execution of customer-facing acts DOES NOT EXIST in this slice —
 * covered acts render as SHADOW ("Would have sent") cards and
 * everything else is prepare-and-ask. There is no send call anywhere
 * in this file: in supervised mode the strongest thing the engine
 * can do to a customer is show the owner exactly what it would have
 * done, with the rule and the predicate that fired.
 */
import type {Actor} from '../env';
import type {ActionClass,Grant,OwnerSurface,ScenarioFacts,Understanding} from './types';
import {isNeverLiveActionClass} from './types';
import type {BillingEnv,StripeClient} from '../billing/stripe';
import {extractLooseInvoiceFacts,getCustomerById,money,resolveCustomers} from '../cashtext/talk';
import {applyCashTextEdit,cashSummary,displayStatus,listInvoices,prepareChaseDraft,prepareInvoiceDraft,reapproveInvoice,voidInvoiceForAction} from '../cashtext/drafts';
import {executeCashTextSend} from '../cashtext/executor';
import {admitEnvelope,cancelPreparedByGrant,getEngineState,getPreparedAction,getSuggestion,insertGrant,insertMemoryObject,insertPreparedAction,listActionLog,listGrants,listScenarios,markSuggestionProposed,recordSuggestionApproval,recordSuggestionProposal,saveEnvelopeResult,saveEngineState,saveGrantVersion,setPreparedStatus,updatePreparedActionPayload,writeActionLog} from './store';
import {parseUnderstanding,detectNeverGrantable,revocationClasses,actionClassFromText} from './understanding';
import {compileGrant} from './grant-compiler';
import {createProbeSet,applyScenarioRuling} from './grant-prober';
import {evaluateCoverage} from './grant-gate';
import {consultDecision,unavailableDecideProvider,type DecideProvider} from './decide';
import {applyOwnerCorrection,getBusinessFact,rememberBusinessFact,findPerson,listPeopleNames,upsertPerson,addVoiceExemplar,getVoiceExemplars,inspectMemory} from './memory';
import {beliefRows,ob,onboardingComplete,parseIntroLine,stage1Preview,tradeDefaults,type OnboardingState} from './onboarding';
import {actionCardIntent,grantCardIntent,lineIntent,scenarioCardIntent,shadowCardIntent} from './surface';
import {fenceFor,meterCost,DEFAULT_COST_CEILING_MICROCENTS} from './cost';
import {emitEngineEvent} from '../engine-events';

export interface CalendarProbeResult { connected: boolean; detail: string; }
export interface EngineDeps {
 db: D1Database;
 decideProvider: DecideProvider;
 calendarProbe: (actor: Actor) => Promise<CalendarProbeResult>;
 now?: () => Date;
 /* CashText executor wiring (Phase 3): the billing env the executor
  * builds its Stripe client from, plus an optional injected client
  * for tests. Absent billingEnv, a CashText approval is recorded but
  * sends nothing (the hook says so plainly). */
 billingEnv?: BillingEnv;
 stripeClient?: StripeClient;
}

const uuid = () => crypto.randomUUID();
const CLASS_PHRASE: Record<ActionClass, string> = {
 schedule_new: 'book appointments', reschedule: 'reschedule appointments', cancel_booking: 'cancel appointments',
 send_sms_reply: 'text customers back', send_email_reply: 'email customers back', answer_call: 'answer calls',
 offer_alternate_slot: 'offer another time', send_reminder: 'send reminders', send_followup: 'follow up',
 winback_message: 'send win-back messages', request_review: 'ask for reviews', update_record: 'update records', create_task: 'create tasks',
 send_invoice: 'send invoices', send_invoice_chase: 'send invoice reminders',
};

function factsFromText(text: string, now: Date): ScenarioFacts {
 const facts: ScenarioFacts = {};
 const day = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b/i);
 if (day) {
  if (/tomorrow/i.test(day[1])) facts.dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][(now.getDay() + 1) % 7];
  else facts.dayOfWeek = day[1].slice(0, 3)[0].toUpperCase() + day[1].slice(1, 3).toLowerCase();
 }
 const time = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
 if (time) { let h = parseInt(time[1], 10); if (time[3].toLowerCase() === 'pm' && h < 12) h += 12; if (time[3].toLowerCase() === 'am' && h === 12) h = 0; facts.hourLocal = h; }
 const amount = text.match(/\$([\d][\d,]*)/);
 if (amount) facts.amountCents = parseInt(amount[1].replace(/,/g, ''), 10) * 100;
 if (/\btest booking|my own booking|my test\b/i.test(text)) facts.isOwnerTestBooking = true;
 return facts;
}

function whenSuffix(text: string): string {
 const m = text.match(/\b((?:to|on|at)\s+(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day|tomorrow|today|\d{1,2}(?::\d{2})?\s*(?:am|pm)))/i);
 return m ? ` ${m[1]}` : '';
}

function draftForAct(actionClass: ActionClass, facts: ScenarioFacts, ownerText: string): string {
 const name = facts.personName ?? 'there';
 const when = whenSuffix(ownerText);
 const quoted = ownerText.match(/[""]([^""]+)[""]|"([^"]{3,})"/);
 if (quoted) return quoted[1] ?? quoted[2];
 switch (actionClass) {
  case 'reschedule': return `Hi ${name} — we've moved your appointment${when}. Does that still work for you?`;
  case 'schedule_new': return `Hi ${name}, you're booked${when}. See you then!`;
  case 'cancel_booking': return `Hi ${name}, we need to cancel your appointment${when}. Sorry for the change — want me to find another time?`;
  case 'send_reminder': return `Hi ${name}, a reminder about your appointment${when}. Reply if you need to change it.`;
  case 'offer_alternate_slot': return `Hi ${name}, that time is taken — would another time${when} work?`;
  case 'send_followup': return `Hi ${name}, following up${when ? ` about ${when.trim()}` : ''} — anything you need from us?`;
  default: return `Hi ${name}, a note from us${when}.`;
 }
}

async function hashPayload(value: unknown): Promise<string> {
 const bytes = new TextEncoder().encode(JSON.stringify(value));
 const digest = await crypto.subtle.digest('SHA-256', bytes);
 return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

export async function runOwnerTurn(deps: EngineDeps, actor: Actor, input: { text: string; channel?: 'owner_text' | 'owner_voice'; idempotencyKey?: string }): Promise<OwnerSurface> {
 const db = deps.db;
 const tenantId = actor.tenantId;
 const now = (deps.now ?? (() => new Date()))();
 const runId = uuid();
 const text = input.text.trim();

 /* Stage 0 — Admission: the route authenticated the session and the
  * tenant binding; a turn whose tenant disagrees with the actor is
  * dropped + security-logged, never processed. (The route layer
  * enforces this; the loop re-asserts it as its own invariant.) */

 /* Stage 1 — Envelope + idempotency: a replayed turn returns the
  * original surface instead of re-running the loop. */
 const idem = input.idempotencyKey ?? await hashPayload({ tenantId, text, at: now.toISOString().slice(0, 16) });
 const { envelopeId, replay } = await admitEnvelope(db, { tenantId, idempotencyKey: idem, channel: input.channel ?? 'owner_text', actorKind: 'owner' });
 if (replay) { try { return { ...(JSON.parse(replay) as OwnerSurface), runId }; } catch { /* fall through and re-run */ } }

 const surface: OwnerSurface = { lines: [], intents: [], readiness: 'holding', runId };
 const finish = async (): Promise<OwnerSurface> => {
  await saveEnvelopeResult(db, tenantId, envelopeId, JSON.stringify(surface));
  return surface;
 };
 const line = (t: string, tone?: 'plain' | 'muted') => { surface.lines.push(t); surface.intents.push(lineIntent(uuid(), t, tone)); };

 /* Stage 2 — Context Assembly: engine state, the Grant Book, open
  * commitments, memory. Grants and availability are read live from
  * their tables on every turn — never cached across turns. */
 const state = await getEngineState(db, tenantId, { costCeilingMicrocents: DEFAULT_COST_CEILING_MICROCENTS });
 const obs: OnboardingState = ob(state);
 const grants = await listGrants(db, tenantId);
 const fence = fenceFor(state);

 /* Stage 3 — Understanding (deterministic parsers first). */
 let u: Understanding = parseUnderstanding(text, { mode: state.mode, onboardingStage: obs.stage, pendingScenario: !!obs.currentScenarioId });

 /* Stage 5 (early, only when Stage 3 could not settle the turn):
  * decide() — with the fence at 100% the provider is treated as
  * unavailable and the fallback is the same: prepare-and-ask. */
 if (!u.deterministic && u.intentClass === 'plain') {
  const decision = await consultDecision(db, {
   tenantId, runId, profile: 'mayor_intent', provider: fence.deterministicOnly ? unavailableDecideProvider : deps.decideProvider,
   state: { text, mode: state.mode, stage: obs.stage ?? null, grants: grants.filter(g => g.status === 'shadow').length },
   questions: [{ id: 'intent_class', kind: 'classify', prompt: 'What is the owner asking for in this turn?' }],
  });
  if (decision.costMicrocents) await meterCost(db, tenantId, decision.costMicrocents);
  const guessed = decision.answers['intent_class'];
  if (decision.band === 'auto' && guessed === 'grant_statement' && actionClassFromText(text)) {
   u = { ...u, intentClass: 'grant_statement', actionClass: actionClassFromText(text)!, grantText: text, deterministic: true };
  } else if (decision.band === 'auto' && (guessed === 'cashtext' || guessed === 'send_invoice' || guessed === 'invoice')) {
   /* Free-form invoice talk (§3.1's fallthrough): decide settled the
    * CLASS with the mayor_intent profile; the facts are extracted
    * loosely and whatever is missing (amount, a resolvable name)
    * becomes an ask in the CashText branch — never a guess. */
   const loose = extractLooseInvoiceFacts(text);
   if (loose) u = { ...u, intentClass: 'cashtext', deterministic: true, actionClass: 'send_invoice', targetPerson: loose.personName, facts: { personName: loose.personName, ...(loose.amountCents !== undefined ? { amountCents: loose.amountCents } : {}) }, cashtext: { kind: 'invoice', ...loose } };
   else { line('I want to be careful with that one. Say it plainly — "invoice Maria $400" — and I\'ll draft it for your approval.'); return finish(); }
  } else {
   line('I want to be careful with that one. Say it as a rule ("you can…"), as an instruction for one customer, or ask me what I\'ve done today.');
   return finish();
  }
 }

 const saveObs = async (patch: Partial<OnboardingState>) => {
  Object.assign(obs, patch);
  state.onboarding = obs as unknown as Record<string, unknown>;
  await saveEngineState(db, state);
 };
 const maybeComplete = async () => {
  const shadowed = (await listGrants(db, tenantId, ['shadow'])).length > 0;
  if (state.mode === 'onboarding' && onboardingComplete(obs, shadowed || !!obs.grantId)) {
   state.mode = 'supervised';
   state.onboarding = obs as unknown as Record<string, unknown>;
   await saveEngineState(db, state);
   line('You\'re set up in supervised mode: I draft and ask first, and any rule you gave me runs in shadow — you\'ll see exactly what it would have done before it can do anything for real.');
  }
 };

 /* ---- dispatch by intent class (stages 4, 6, 7, 10, 11) ---- */
 switch (u.intentClass) {
  case 'scenario_ruling': {
   const scenarioId = obs.currentScenarioId!;
   const all = obs.currentProbeSetId ? await listScenarios(db, tenantId, obs.currentProbeSetId) : [];
   const scenario = all.find(s => s.id === scenarioId);
   if (!scenario) { await saveObs({ currentScenarioId: undefined, currentProbeSetId: undefined }); line('That check is already settled — nothing is waiting on it.'); return finish(); }
   const result = await applyScenarioRuling(db, tenantId, scenario, u.ruling!);
   if (result.flipped) line(`You flipped that one — so the rule changed: ${result.diff.join(' ')}`);
   else line('Noted — that matches the rule as written.');
   const grant = result.grant;
   if (result.advancedToShadow) {
    await emitEngineEvent({ AGENT_DB: db }, { tenantId, actorId: actor.userId, type: 'grant_created', resourceId: grant.id, consentGranted: false });
    /* The Rule memory object — the hearable twin of the Grant (§1.4):
     * only the Grant executes; this is what "what are my rules?"
     * reads back. */
    await insertMemoryObject(db, { tenantId, type: 'Rule', status: 'active', payload: { grantId: grant.id, summary: grant.plainSummary }, confidenceTier: 'owner_confirmed', provenance: { sourceKind: 'owner_statement', quote: grant.sourceUtterance }, decayClass: 'permanent' }).catch(() => undefined);
    await saveObs({ grantId: grant.id, currentScenarioId: undefined, currentProbeSetId: undefined, ...(obs.stage === 'grant' ? { stage: 'review' as const } : {}) });
    line(`Your rule is recorded and now runs in shadow: "${grant.sourceUtterance}" — for the next stretch, every act it covers shows up here as a "Would have sent" card instead of going out.`);
    surface.intents.push(grantCardIntent(grant, 0));
    if (obs.stage === 'review' || obs.stage === 'grant') line('Last thing: how do you want to review my work — listen first, read first, or is your thumb fine?');
    await maybeComplete();
   } else {
    const remaining = (await listScenarios(db, tenantId, scenario.probeSetId)).filter(s => s.ownerRuling === null);
    const next = remaining[0];
    if (next) { await saveObs({ currentScenarioId: next.id }); surface.intents.push(scenarioCardIntent(next, grant.id)); }
    else await saveObs({ currentScenarioId: undefined, currentProbeSetId: undefined });
   }
   surface.readiness = 'acted';
   return finish();
  }

  case 'revocation': {
   const classes = revocationClasses(text);
   const active = grants.filter(g => (g.status === 'shadow' || g.status === 'live' || g.status === 'narrowed') && (classes.length === 0 || classes.includes(g.actionClass)));
   /* The version bump commits BEFORE the confirming reply is
    * composed (§1.3.3) — everything below happens after the writes,
    * and queued unexecuted actions under the revoked scope cancel
    * in the same breath. */
   const stopped: string[] = [];
   for (const g of active) {
    await cancelPreparedByGrant(db, tenantId, g.id);
    const revoked = await saveGrantVersion(db, { ...g, status: 'revoked' });
    await writeActionLog(db, { tenantId, actionKey: `revoke:${g.id}:v${revoked.version}`, kind: 'note', actionClass: g.actionClass, payloadSummary: `Rule revoked by the owner: "${g.sourceUtterance}"`, grantId: g.id, grantVersion: revoked.version, sourceUtterance: g.sourceUtterance });
    stopped.push(CLASS_PHRASE[g.actionClass]);
    surface.intents.push(grantCardIntent(revoked, 0));
   }
   line(stopped.length ? `Stopped — I won't ${[...new Set(stopped)].join(' or ')} on my own anymore. I'll prepare and ask first, every time.` : 'There\'s no standing rule like that to stop — I\'m already asking before everything.');
   surface.readiness = 'acted';
   return finish();
  }

  case 'grant_statement': {
   const compiled = compileGrant(u.grantText ?? text, now);
   if (compiled.disposition === 'decline') { line(compiled.decline!); return finish(); }
   if (compiled.disposition === 'ask') {
    await insertGrant(db, {
     tenantId, status: 'proposed', actionClass: compiled.actionClass ?? 'reschedule',
     scope: compiled.scope ?? { who: 'existing_customers_only', what: 'any_service', when: 'any_time', channel: 'any', limits: { maxMessagesPerPersonPerDay: 1 } },
     conditions: compiled.conditions ?? [], neverLines: compiled.neverLines ?? [], sourceUtterance: text,
     plainSummary: compiled.plainSummary ?? 'A rule you\'re still shaping.', origin: 'owner_stated', capabilityState: 'present',
     probeSetId: null, sessionScope: state.mode === 'onboarding' ? 'owner_test' : 'standard', asks: compiled.asks,
     confirmedAt: null, expiresAt: compiled.expiresAt ?? null, supersedesId: null,
    });
    for (const ask of compiled.asks) line(ask);
    surface.readiness = 'needs-eye';
    return finish();
   }
   /* ready → draft recorded → PROBE (never straight to shadow). */
   let grant = await insertGrant(db, {
    tenantId, status: 'proposed', actionClass: compiled.actionClass!, scope: compiled.scope!, conditions: compiled.conditions ?? [],
    neverLines: compiled.neverLines ?? [], sourceUtterance: text, plainSummary: compiled.plainSummary!, origin: 'owner_stated',
    capabilityState: 'present', probeSetId: null, sessionScope: state.mode === 'onboarding' ? 'owner_test' : 'standard',
    asks: [], confirmedAt: null, expiresAt: compiled.expiresAt ?? null, supersedesId: null,
   });
   const { probeSetId, scenarios } = await createProbeSet(db, grant, await listPeopleNames(db, tenantId));
   grant = await saveGrantVersion(db, { ...grant, status: 'probed', probeSetId });
   line(`Here's your rule in your words: "${text}"`);
   line(`As I understand it: ${grant.plainSummary} Before it can cover anything, rule on these cases — they're drawn from the edges of what you said.`);
   if (compiled.riders?.length) line(`One part rides separately: ${compiled.riders.map(r => CLASS_PHRASE[r]).join(', ')} is its own permission — I'll set it up as its own rule right after this one, so nothing sneaks in.`);
   surface.intents.push(grantCardIntent(grant, 0));
   const first = scenarios[0];
   if (first) { await saveObs({ currentProbeSetId: probeSetId, currentScenarioId: first.id }); surface.intents.push(scenarioCardIntent(first, grant.id)); }
   surface.readiness = 'needs-eye';
   return finish();
  }

  case 'correction': {
   const close = text.match(/(?:close|closes|closing)[^.]{0,20}?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
   const open = text.match(/(?:open|opens|opening)[^.]{0,20}?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
   const price = text.match(/(.+?)\s+(?:is|costs)\s+\$(\d+(?:\.\d{2})?)\s*,?\s*not\s+\$/i);
   let applied: string | null = null;
   if (close) { await applyOwnerCorrection(db, { tenantId, key: 'hours.close', value: close[1].replace(/\s+/g, ''), quote: text }); applied = `closing time is now ${close[1]}`; }
   else if (open) { await applyOwnerCorrection(db, { tenantId, key: 'hours.open', value: open[1].replace(/\s+/g, ''), quote: text }); applied = `opening time is now ${open[1]}`; }
   else if (price) { const service = price[1].replace(/^(actually|no|well)[,.\s]+/i, '').trim().toLowerCase(); await applyOwnerCorrection(db, { tenantId, key: `price:${service}`, value: `$${price[2]}`, quote: text }); applied = `${service} is $${price[2]}`; }
   if (applied) {
    line(`Noted — ${applied}. That's the version I'll use from this moment, in this conversation and everywhere else.`);
    if (obs.stage === 'belief') { /* belief rows re-render from memory on the next Desk read */ }
   } else line('Say the correction plainly — "we close at 6, not 7" — and I\'ll update my memory on the spot.');
   surface.readiness = 'acted';
   return finish();
  }

  case 'audit_query': {
   const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
   const rows = await listActionLog(db, tenantId, { since: u.targetPerson ? undefined : startOfDay.toISOString(), person: u.targetPerson, limit: 20 });
   if (!rows.length) { line(u.targetPerson ? `I haven't done anything involving ${u.targetPerson}.` : 'Nothing yet today — no acts, no drafts, nothing sent in shadow or otherwise.'); return finish(); }
   for (const row of rows.slice(0, 5)) {
    const when = new Date(row.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (row.kind === 'shadow') line(`${when} — I would have: ${row.payloadSummary}${row.sourceUtterance ? ` Under your rule: "${row.sourceUtterance}"` : ''}`);
    else if (row.kind === 'prepared') line(`${when} — I prepared: ${row.payloadSummary} (waiting on you)`);
    else line(`${when} — ${row.payloadSummary}`);
   }
   surface.readiness = 'acted';
   return finish();
  }

  case 'connect_calendar': {
   const probe = await deps.calendarProbe(actor);
   if (probe.connected) {
    await saveObs({ calendarConnected: true, calendarDetail: probe.detail, stage: obs.stage === 'connect' || obs.stage === 'style' || obs.stage === 'canvas' ? 'grant' : obs.stage });
    line(`Connected — ${probe.detail}`);
    line('One thing before we test. Tell me, in your words, one thing I can just do without checking with you first — like "reschedule anyone who asks." Or say "everything needs my OK for now" and I\'ll draft and ask first, always.');
   } else {
    line(`Your calendar isn't connected yet — ${probe.detail} Until it is, I'll work from what you tell me, and I'll say so plainly rather than pretend. You can also say "use Mayor's calendar for now" and we'll keep going.`);
   }
   surface.readiness = 'acted';
   return finish();
  }

  case 'onboarding_step': {
   if (u.ambiguities.includes('owner_declined_grant')) {
    await saveObs({ grantDeclined: true, stage: obs.stage === 'grant' ? 'review' : obs.stage });
    line('Understood — everything needs your OK. I\'ll prepare and ask first, every time; that\'s a perfectly good way to run.');
    if (obs.stage === 'grant') line('How do you want to review my work — listen first, read first, or is your thumb fine?');
    await maybeComplete();
    return finish();
   }
   line('Tell me a little more and I\'ll take it from there.');
   return finish();
  }

  case 'cashtext': {
   /* CashText (spec §3.1–3.3): deterministic talk forms land here.
    * Drafts are prepared actions (kind ask, NEVER_LIVE classes) —
    * this branch writes NO Stripe object; sending is the executor's
    * job on approval only. Ambiguity asks, never acts. */
   const ct = u.cashtext!;
   if (ct.kind === 'who_owes') {
    const open = (await listInvoices(db, tenantId)).filter(i => ['sent', 'overdue'].includes(displayStatus(i, now)));
    if (!open.length) line('Nobody owes you right now — no unpaid invoices are out.');
    else {
     for (const inv of open.slice(0, 10)) {
      const c = await getCustomerById(db, tenantId, inv.customerId);
      const status = displayStatus(inv, now);
      line(`${c?.name ?? 'A customer'} owes ${money(inv.amountCents)}${inv.description ? ` for ${inv.description}` : ''} — ${status === 'overdue' ? `overdue (was due ${inv.dueDate})` : `sent${inv.dueDate ? `, due ${inv.dueDate}` : ''}`}.`);
     }
     line(`Total still out: ${money(open.reduce((s, i) => s + i.amountCents, 0))} across ${open.length} invoice${open.length === 1 ? '' : 's'}.`);
    }
    surface.readiness = 'acted';
    return finish();
   }
   if (ct.kind === 'cash_summary') {
    const s = await cashSummary(db, tenantId, now);
    line(`Cash summary — collected ${money(s.collectedThisWeekCents)} this week (${s.collectedThisWeekCount} paid). Still out: ${money(s.stillOutCents)} across ${s.stillOutCount} open invoice${s.stillOutCount === 1 ? '' : 's'}. ${s.draftsWaiting} draft${s.draftsWaiting === 1 ? '' : 's'} waiting, ${s.chasesWaiting} chase${s.chasesWaiting === 1 ? '' : 's'} waiting on your approval.`);
    surface.readiness = 'acted';
    return finish();
   }
   const matches = await resolveCustomers(db, tenantId, ct.personName);
   if (!matches.length) { line(`I don't have a customer named ${ct.personName} in your book — add them (name and email) and I'll draft it. I never guess contact details.`); surface.readiness = 'needs-eye'; return finish(); }
   if (matches.length > 1) { line(`I found ${matches.length} customers matching ${ct.personName}: ${matches.map(m => m.name).join(', ')}. Which one did you mean?`); surface.readiness = 'needs-eye'; return finish(); }
   const customer = matches[0];
   if (ct.kind === 'chase') {
    const open = (await listInvoices(db, tenantId)).filter(i => i.customerId === customer.id && ['sent', 'overdue'].includes(displayStatus(i, now)));
    if (!open.length) { line(`${customer.name} has no open invoice to chase — nothing is outstanding for them.`); surface.readiness = 'acted'; return finish(); }
    if (open.length > 1) { line(`${customer.name} has ${open.length} open invoices: ${open.map(i => `${money(i.amountCents)}${i.description ? ` for ${i.description}` : ''}`).join('; ')}. Which one should I chase?`); surface.readiness = 'needs-eye'; return finish(); }
    const { action, existing } = await prepareChaseDraft(db, { tenantId, customer, invoice: open[0], now });
    if (!existing) await writeActionLog(db, { tenantId, actionKey: `ask:${await hashPayload({ runId })}`, kind: 'prepared', actionClass: 'send_invoice_chase', targetPerson: customer.name, channel: 'email', payloadSummary: action.payloadSummary, preparedActionId: action.id });
    surface.intents.push(actionCardIntent(action));
    line(existing ? 'That chase is already drafted and waiting on you — nothing sent yet.' : 'I\'ve drafted the chase — nothing sent yet. Approve the card and Stripe re-sends the invoice from your account.');
    surface.readiness = 'needs-eye';
    return finish();
   }
   /* kind === 'invoice': a resolved customer WITHOUT an email stops
    * the draft (§3.1) — the email is asked for, never guessed. */
   if (!customer.email) { line(`${customer.name} doesn't have an email on file — what's their email? Once it's saved I'll draft the invoice. I won't guess it.`); surface.readiness = 'needs-eye'; return finish(); }
   if (ct.amountCents === undefined) { line(`How much should I invoice ${customer.name} for${ct.description ? ` — the ${ct.description}` : ''}?`); surface.readiness = 'needs-eye'; return finish(); }
   const { action } = await prepareInvoiceDraft(db, { tenantId, customer, amountCents: ct.amountCents, description: ct.description, now });
   await writeActionLog(db, { tenantId, actionKey: `ask:${await hashPayload({ runId })}`, kind: 'prepared', actionClass: 'send_invoice', targetPerson: customer.name, channel: 'email', payloadSummary: action.payloadSummary, preparedActionId: action.id });
   surface.intents.push(actionCardIntent(action));
   line('I\'ve drafted it — nothing sent yet. Approve the card and I\'ll send it through Stripe from your own account.');
   surface.readiness = 'needs-eye';
   return finish();
  }

  case 'customer_act': {
   const facts: ScenarioFacts = { ...factsFromText(text, now), personName: u.targetPerson, ...(u.facts ?? {}) };
   if (u.targetPerson) {
    const person = await findPerson(db, tenantId, u.targetPerson);
    facts.personKnown = person ? true : (u.actionClass === 'schedule_new' ? false : undefined);
    if (person) facts.callerVisits = (person.payload.visits as number) ?? undefined;
    await upsertPerson(db, { tenantId, name: u.targetPerson });
   }
   const act = { actionClass: u.actionClass!, facts, channel: u.actionClass === 'send_email_reply' ? 'email' : u.actionClass === 'answer_call' ? 'phone' : 'sms' };
   /* Stage 4 — the deterministic gate. */
   const coverage = evaluateCoverage(grants, act);
   if (coverage.narrowedGrantId && coverage.grant) {
    const older = grants.find(g => g.id === coverage.narrowedGrantId);
    if (older && u.targetPerson) {
     await saveGrantVersion(db, { ...older, status: 'narrowed', neverLines: [...older.neverLines, `never ${u.targetPerson}`] });
     await writeActionLog(db, { tenantId, actionKey: `conflict:${older.id}:${runId}`, kind: 'note', payloadSummary: coverage.conflictNote ?? 'Grant conflict resolved; older rule narrowed.', grantId: older.id, grantVersion: older.version });
    }
   }
   const draftText = draftForAct(u.actionClass!, facts, text);
   const payloadSummary = `${CLASS_PHRASE[u.actionClass!]}${u.targetPerson ? ` for ${u.targetPerson}` : ''}${whenSuffix(text)}`;
   if (coverage.outcome === 'covered' && coverage.grant) {
    /* Stage 7 — SHADOW: the act is rendered, logged, and shown.
     * Nothing leaves the building. */
    const action = await insertPreparedAction(db, {
     tenantId, kind: 'shadow', actionClass: u.actionClass!, targetPerson: u.targetPerson ?? null, channel: act.channel,
     payload: { text: draftText }, payloadSummary, grantId: coverage.grant.id, grantVersion: coverage.grant.version,
     predicateFired: coverage.predicate ?? null, decisionId: null, nearBoundary: !!coverage.nearBoundary,
     reversibility: { undoWindowMinutes: 60, inverse: 'prepare a correction for owner approval' },
     expiresAt: new Date(now.getTime() + 24 * 3600_000).toISOString(),
    });
    await writeActionLog(db, {
     tenantId, actionKey: `shadow:${await hashPayload({ runId })}`, kind: 'shadow', actionClass: u.actionClass!,
     targetPerson: u.targetPerson, channel: act.channel, payloadSummary, grantId: coverage.grant.id,
     grantVersion: coverage.grant.version, sourceUtterance: coverage.grant.sourceUtterance, preparedActionId: action.id,
    });
    surface.intents.push(shadowCardIntent(action, coverage.grant));
    line(`Under your rule ("${coverage.grant.sourceUtterance}"), I would have done this — in shadow, so it shows here instead of going out.`);
    surface.readiness = coverage.nearBoundary ? 'needs-eye' : 'acted';
    return finish();
   }
   /* Not covered or ambiguous ⇒ prepare-and-ask (Stage 7's fork). */
   const action = await insertPreparedAction(db, {
    tenantId, kind: 'ask', actionClass: u.actionClass!, targetPerson: u.targetPerson ?? null, channel: act.channel,
    payload: { text: draftText }, payloadSummary, grantId: null, grantVersion: null, predicateFired: null,
    decisionId: null, nearBoundary: false, reversibility: null, expiresAt: new Date(now.getTime() + 24 * 3600_000).toISOString(),
   });
   await writeActionLog(db, { tenantId, actionKey: `ask:${await hashPayload({ runId })}`, kind: 'prepared', actionClass: u.actionClass!, targetPerson: u.targetPerson, channel: act.channel, payloadSummary, preparedActionId: action.id });
   surface.intents.push(actionCardIntent(action, coverage.ask));
   line(coverage.outcome === 'ambiguous' && coverage.ask ? `${coverage.ask} I've drafted it either way — your call.` : 'I\'ve prepared this — it isn\'t covered by any rule, so it waits for your thumb.');
   surface.readiness = 'needs-eye';
   return finish();
  }

  case 'shop_intro': {
   const intro = parseIntroLine(text);
   const defaults = tradeDefaults(intro.trade ?? text);
   if (intro.name) await rememberBusinessFact(db, { tenantId, key: 'shop.name', value: intro.name, tier: 'owner_confirmed', sourceKind: 'owner_statement', quote: text });
   if (intro.trade) await rememberBusinessFact(db, { tenantId, key: 'shop.trade', value: intro.trade, tier: 'owner_confirmed', sourceKind: 'owner_statement', quote: text });
   if (intro.town) await rememberBusinessFact(db, { tenantId, key: 'shop.town', value: intro.town, tier: 'owner_confirmed', sourceKind: 'owner_statement', quote: text });
   await saveObs({ shopName: intro.name ?? obs.shopName, trade: intro.trade ?? obs.trade, town: intro.town ?? obs.town, url: intro.url ?? obs.url, stage: 'belief' });
   const facts: Record<string, string> = {};
   if (defaults) { facts['hours.text'] = defaults.defaultHours; facts['hours.source'] = 'guess'; }
   line(`Hey — I'm Mayor. I run the front: I answer your phone, book your calendar, and talk to your customers like you would. Here's what I believe about your shop — tap what's wrong.`);
   for (const row of beliefRows({ ...obs, shopName: intro.name ?? obs.shopName, trade: intro.trade ?? obs.trade, town: intro.town ?? obs.town }, facts)) {
    surface.intents.push({ type: 'fact', id: uuid(), version: 1, summary: `${row.label}: ${row.value}`, label: row.label, value: row.value, qualifier: row.source === 'you' ? 'from you' : 'a guess — tell me if yours differ' });
   }
   line('If that\'s you, say "that\'s us" and I\'ll show you how I\'d answer your phone.');
   surface.readiness = 'needs-eye';
   return finish();
  }

  default: {
   /* Plain turns: onboarding guidance by stage; the style-capture
    * paste; the evidence-mode pick; otherwise a careful holding. */
   if (obs.proposalPendingClass) {
    const pendingClass = obs.proposalPendingClass as ActionClass;
    if (/^\s*(no|nope|not now|later)\b/i.test(text)) {
     await recordSuggestionProposal(db, tenantId, pendingClass, true);
     await saveObs({ proposalPendingClass: undefined });
     line('Okay — I won\'t suggest that one again for a while. Nothing changed about how I work: I still ask first.');
     return finish();
    }
    if (/^\s*(yes|sure|ok|okay)\b/i.test(text)) {
     await saveObs({ proposalPendingClass: undefined });
     line(`Good — say the rule in your own words (like "you can ${CLASS_PHRASE[pendingClass]} when…") and I'll set it up with a few quick checks.`);
     return finish();
    }
   }
   if (state.mode === 'onboarding') {
    if (obs.stage === 'belief' && /\b(that'?s us|looks right|keep going|yes|right)\b/i.test(text)) {
     const facts: Record<string, string> = {};
     const hours = await getBusinessFact(db, tenantId, 'hours.text');
     const closeFact = await getBusinessFact(db, tenantId, 'hours.close');
     if (hours) { facts['hours.text'] = hours.payload.value as string; facts['hours.source'] = 'owner'; }
     else if (closeFact) { facts['hours.text'] = `open till ${closeFact.payload.value as string}`; facts['hours.source'] = 'owner'; }
     else { const d = tradeDefaults(obs.trade); if (d) { facts['hours.text'] = d.defaultHours; facts['hours.source'] = 'guess'; } }
     const exemplars = await getVoiceExemplars(db, tenantId, 'customers');
     const preview = stage1Preview(obs, facts, { learned: exemplars.length > 0 });
     await saveObs({ beliefConfirmed: true, previewShown: true, stage: 'style' });
     line('Here\'s me, answering like your front desk. This is a draft — nothing sends anywhere without you.');
     line(`"${preview.draft}"`);
     line(preview.voiceLabel);
     for (const gap of preview.gaps) line(gap);
     line('Want me to sound more like you? Paste one message you\'ve actually sent a customer — any one. (If you\'d rather say it out loud: I keep the words, like a typed message — the audio itself isn\'t stored.) Or say "skip" and we\'ll connect your calendar.');
     surface.readiness = 'needs-eye';
     return finish();
    }
    if (obs.stage === 'style') {
     if (/\bskip\b/i.test(text)) { await saveObs({ stage: 'connect' }); line('No problem — I\'ll use a neutral shop voice and label it until I\'ve heard yours. Say "connect my calendar" when you\'re ready, and I\'ll watch for double-bookings from the real thing.'); return finish(); }
     if (text.length >= 12) {
      await addVoiceExemplar(db, { tenantId, audience: 'customers', text, source: 'owner' });
      await saveObs({ stage: 'connect', voiceConsentGiven: true });
      line('Got it — that\'s enough for me to start sounding like you. Say "connect my calendar" and I\'ll put bookings straight into the real thing.');
      surface.readiness = 'acted';
      return finish();
     }
    }
    if (obs.stage === 'connect' && /\buse mayor'?s calendar\b|\bmayor'?s calendar for now\b/i.test(text)) {
     await saveObs({ calendarConnected: false, calendarDetail: 'in-app calendar as stand-in', stage: 'grant' });
     line('Done — Mayor\'s calendar is your book of record for now, and I\'ll say "this is only in Mayor" on bookings until yours connects. One thing before we test: tell me one thing I can just do in your words — or say "everything needs my OK for now."');
     return finish();
    }
    if (obs.stage === 'review' || obs.stage === 'grant') {
     const mode = /\blisten\b/i.test(text) ? 'listen' : /\bread\b/i.test(text) ? 'read' : /\bthumb\b/i.test(text) ? 'thumb' : null;
     if (mode) {
      await saveObs({ evidenceMode: mode });
      line(mode === 'listen' ? 'Listen first it is — you\'ll hear the call before anything with your name on it goes out.' : mode === 'read' ? 'Read first it is — full threads on every card before you approve.' : 'Thumb is fine — quick approvals, with the evidence one tap away on every card.');
      await maybeComplete();
      surface.readiness = 'acted';
      return finish();
    }
    }
    line('Tell me your shop in one line — name, what you do, town. Or paste your website or Google link and I\'ll do the reading.');
    return finish();
   }
   if (/\bwhat do you remember about\b/i.test(text)) {
    const q = text.replace(/.*what do you remember about\s+/i, '').replace(/\?$/, '');
    const hits = await inspectMemory(db, tenantId, q);
    if (!hits.length) line(`I don't have anything noted about ${q} yet.`);
    for (const hit of hits.slice(0, 5)) line(`${hit.summary} — ${hit.provenanceLine}`);
    surface.readiness = 'acted';
    return finish();
   }
   const decline = detectNeverGrantable(text);
   if (decline && actionClassFromText(text) === null && /\b(refund|charge|discount|delete|sign|post)\b/i.test(text)) { line(decline); return finish(); }
   line('I\'m listening. Give me a rule in your words, an instruction for one customer, or ask what I\'ve done today.');
   return finish();
  }
 }
}

/* ---------------- Desk card verbs + route-level acts ---------------- */

export async function applyActionVerb(deps: EngineDeps, actor: Actor, actionId: string, verb: 'approve' | 'dismiss' | 'edit', editText?: string): Promise<OwnerSurface> {
 const db = deps.db; const tenantId = actor.tenantId; const runId = uuid();
 const surface: OwnerSurface = { lines: [], intents: [], readiness: 'acted', runId };
 const line = (t: string) => { surface.lines.push(t); surface.intents.push(lineIntent(uuid(), t)); };
 const action = await getPreparedAction(db, tenantId, actionId);
 if (!action || action.status !== 'prepared') { line('That card is already settled — nothing left to decide on it.'); return surface; }
 const isCashText = isNeverLiveActionClass(action.actionClass);
 if (verb === 'edit' && isCashText) {
  /* CashText edits are FIELD edits, not wording swaps (§3.3): the
   * diff is recorded on the payload and a customer/amount/description
   * change sets the invoice's draft_error flag (§10 instrument). */
  if (!editText || !editText.trim()) { line('Tell me the change as field: value — for example "amount: 450" or "description: Water heater install".'); return surface; }
  const result = await applyCashTextEdit(db, tenantId, action, editText);
  if (!result) { line('I couldn\'t apply that edit — check the fields (amount, description, customer_id, days_until_due) and try again. Nothing changed.'); return surface; }
  line(result.changedFields.length ? `Edited — changed: ${result.changedFields.join(', ')}. The draft now reads: ${result.summary}` : 'That edit didn\'t change anything — the draft already reads that way.');
  return surface;
 }
 if (verb === 'edit') {
  if (editText && editText.trim()) {
   await updatePreparedActionPayload(db, tenantId, actionId, { ...action.payload, text: editText.trim() });
   /* Edit-and-send deltas are voice evidence (§1.4 rule 2): the
    * owner's own rewritten words enter the voice store — from the
    * owner, never from a customer. */
   await addVoiceExemplar(db, { tenantId, audience: 'customers', text: editText.trim(), source: 'owner' });
   line('Edited — and noted: your wording is how I\'ll draft it next time.');
  } else line('Tap the draft and type your version — your words replace mine.');
  return surface;
 }
 if (verb === 'dismiss') {
  await setPreparedStatus(db, tenantId, actionId, 'dismissed');
  if (isCashText) {
   /* Dismiss voids a draft invoice (§3.3); a dismissed chase voids
    * nothing — the invoice stays open. Zero Stripe calls either way. */
   await voidInvoiceForAction(db, tenantId, action);
   line(action.actionClass === 'send_invoice' ? 'Dismissed — that invoice draft is voided and will never be sent.' : 'Dismissed — that chase won\'t go out. The invoice itself stays open.');
   return surface;
  }
  line('Dismissed. That\'s training data, not a dead end — I\'ll draft differently next time.');
  return surface;
 }
 /* approve */
 await setPreparedStatus(db, tenantId, actionId, 'approved');
 await recordSuggestionApproval(db, tenantId, action.actionClass);
 if (isCashText) {
  /* THE FENCED HOOK (§3.3): the one place an approval can reach an
   * external send — and only for the NEVER_LIVE CashText classes,
   * only through the executor, exactly once (its action-log claim
   * is the fence against replays). recordSuggestionApproval above
   * is store-guarded to never count these classes, and the grant
   * gate/compiler fences mean no grant can ever cover this — every
   * send is this owner's tap on this card, forever. */
  if (!deps.billingEnv) { line('Approved — but sending isn\'t wired in this context, so nothing went out.'); surface.readiness = 'needs-eye'; return surface; }
  const result = await executeCashTextSend({ db, env: deps.billingEnv, tenantId, action, injected: deps.stripeClient, now: (deps.now ?? (() => new Date()))() });
  line(result.ownerLine);
  if (result.copyPasteDraft) line(result.copyPasteDraft);
  if (result.hostedInvoiceUrl) line(`Invoice link: ${result.hostedInvoiceUrl}`);
  surface.intents.push({ type: 'receipt', id: uuid(), version: 1, summary: `${result.outcome === 'sent' ? 'Sent' : 'Approved'}: ${action.payloadSummary}`, text: `${result.outcome === 'sent' ? 'Sent' : 'Approved'} — ${action.payloadSummary}` });
  surface.readiness = result.outcome === 'sent' ? 'acted' : 'needs-eye';
  return surface;
 }
 if (action.kind === 'shadow') line('Noted as right — under your rule, that\'s exactly what would have gone out.');
 else line('Yours to send — the draft stays on the card, word for word.');
 surface.intents.push({ type: 'receipt', id: uuid(), version: 1, summary: `Approved: ${action.payloadSummary}`, text: `Approved — ${action.payloadSummary}` });
 /* The assistant-proposal discipline (§1.3.2 step 1): after ≥3
  * manual approvals of a class with no live/shadow grant, propose
  * the rule ONCE; a "no" suppresses the class for 30 days. */
 const suggestion = await getSuggestion(db, tenantId, action.actionClass);
 const hasGrant = (await listGrants(db, tenantId, ['shadow', 'live', 'probed'])).some(g => g.actionClass === action.actionClass);
 if (suggestion && suggestion.approvals >= 3 && suggestion.proposedCount === 0 && !hasGrant && (!suggestion.suppressedUntil || suggestion.suppressedUntil < new Date().toISOString())) {
  await markSuggestionProposed(db, tenantId, action.actionClass);
  const state = await getEngineState(db, tenantId, { costCeilingMicrocents: DEFAULT_COST_CEILING_MICROCENTS });
  const o = ob(state); o.proposalPendingClass = action.actionClass; state.onboarding = o as unknown as Record<string, unknown>;
  await saveEngineState(db, state);
  line(`You've approved ${CLASS_PHRASE[action.actionClass]} three times now. Want it as a rule, so I can do it under your words without asking each time? Say yes and tell me the rule in your words — or no, and I won't bring it up again for a while.`);
 }
 return surface;
}

/** CashText re-approval (§3.3): an expired card — or a send that
 * failed — leaves the invoice listed (draft, or approved-but-unsent);
 * this mints its FRESH prepared action. A retry is always a new
 * card, never a silent re-send. Same state machine on talk/Desk. */
export async function applyCashTextReapprove(deps: EngineDeps, actor: Actor, invoiceId: string): Promise<OwnerSurface> {
 const db = deps.db; const tenantId = actor.tenantId; const runId = uuid();
 const surface: OwnerSurface = { lines: [], intents: [], readiness: 'acted', runId };
 const line = (t: string) => { surface.lines.push(t); surface.intents.push(lineIntent(uuid(), t)); };
 const result = await reapproveInvoice(db, tenantId, invoiceId, (deps.now ?? (() => new Date()))());
 if (!result) { line('That invoice isn\'t waiting to be sent — it may already be sent, paid, or voided.'); return surface; }
 surface.intents.push(actionCardIntent(result.action));
 line('Here\'s the draft again — nothing has gone out yet. Approve the card and I\'ll send it.');
 surface.readiness = 'needs-eye';
 return surface;
}

export async function applyScenarioRulingSurface(deps: EngineDeps, actor: Actor, scenarioId: string, ruling: 'allowed' | 'blocked'): Promise<OwnerSurface> {
 const db = deps.db; const tenantId = actor.tenantId; const runId = uuid();
 const surface: OwnerSurface = { lines: [], intents: [], readiness: 'acted', runId };
 const line = (t: string) => { surface.lines.push(t); surface.intents.push(lineIntent(uuid(), t)); };
 const state = await getEngineState(db, tenantId, { costCeilingMicrocents: DEFAULT_COST_CEILING_MICROCENTS });
 const obs = ob(state);
 const probeSetId = obs.currentProbeSetId;
 if (!probeSetId) { line('No rule check is waiting right now.'); return surface; }
 const scenarios = await listScenarios(db, tenantId, probeSetId);
 const scenario = scenarios.find(s => s.id === scenarioId);
 if (!scenario || scenario.ownerRuling !== null) { line('That check is already settled — nothing is waiting on it.'); return surface; }
 const result = await applyScenarioRuling(db, tenantId, scenario, ruling);
 if (result.flipped) line(`You flipped that one — so the rule changed: ${result.diff.join(' ')}`);
 else line('Noted — that matches the rule as written.');
 const grant = result.grant;
 if (result.advancedToShadow) {
  await emitEngineEvent({ AGENT_DB: db }, { tenantId, actorId: actor.userId, type: 'grant_created', resourceId: grant.id, consentGranted: false });
  await insertMemoryObject(db, { tenantId, type: 'Rule', status: 'active', payload: { grantId: grant.id, summary: grant.plainSummary }, confidenceTier: 'owner_confirmed', provenance: { sourceKind: 'owner_statement', quote: grant.sourceUtterance }, decayClass: 'permanent' }).catch(() => undefined);
  obs.currentScenarioId = undefined; obs.currentProbeSetId = undefined; obs.grantId = grant.id;
  if (obs.stage === 'grant') obs.stage = 'review';
  state.onboarding = obs as unknown as Record<string, unknown>; await saveEngineState(db, state);
  line(`Your rule is recorded and now runs in shadow: "${grant.sourceUtterance}"`);
  surface.intents.push(grantCardIntent(grant, 0));
 } else {
  const remaining = (await listScenarios(db, tenantId, probeSetId)).filter(s => s.ownerRuling === null);
  const next = remaining[0];
  if (next) { obs.currentScenarioId = next.id; state.onboarding = obs as unknown as Record<string, unknown>; await saveEngineState(db, state); surface.intents.push(scenarioCardIntent(next, grant.id)); }
 }
 return surface;
}

export async function revokeGrantById(deps: EngineDeps, actor: Actor, grantId: string): Promise<OwnerSurface> {
 const db = deps.db; const tenantId = actor.tenantId; const runId = uuid();
 const surface: OwnerSurface = { lines: [], intents: [], readiness: 'acted', runId };
 const grants = await listGrants(db, tenantId);
 const grant = grants.find(g => g.id === grantId);
 if (!grant || grant.status === 'revoked') { surface.lines.push('That rule is already off.'); return surface; }
 await cancelPreparedByGrant(db, tenantId, grant.id);
 const revoked = await saveGrantVersion(db, { ...grant, status: 'revoked' });
 await writeActionLog(db, { tenantId, actionKey: `revoke:${grant.id}:v${revoked.version}`, kind: 'note', actionClass: grant.actionClass, payloadSummary: `Rule revoked by the owner: "${grant.sourceUtterance}"`, grantId: grant.id, grantVersion: revoked.version, sourceUtterance: grant.sourceUtterance });
 surface.lines.push(`Stopped — the rule "${grant.sourceUtterance}" is off. I'll ask first, every time.`);
 surface.intents.push(grantCardIntent(revoked, 0));
 return surface;
}
