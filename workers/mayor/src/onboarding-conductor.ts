import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError} from './http';
import {OPERATORS,requireMembership} from './permissions';
import {readMemory,type Profile} from './memory';
import {onboardingProgress,onboardingProgressForVertical,AUTHORITY_QUESTIONS} from './onboarding';
import {listAuthorityTiers,ACTION_LABELS,TIER_LABELS,type AuthorityAction,type AuthorityTier} from './authority-tiers';
import {connectionStatus,connectorPriorityFor} from './connections';
import {selectedCalendar} from './calendars';
import {phoneConnections} from './phone-connections';
import {assistantName} from './assistant-persona';
import {gbpReviewsCanSucceed} from './gbp-reviews';
import {verticalProfile,type Vertical} from './verticals';
import {MODE_LABELS} from './vertical-mapping';

/** P4 — Chief of Staff onboarding conductor (vision: docs/verticals/chief-of-staff.md).
 *
 * The five phases — Identify → Learn the place → Connect → Set the rules →
 * Hand off — are orchestrated here over the existing primitives (conversational
 * profile Q&A + Places, connector cards/grants, P1 authority tiers). This module
 * owns NO new fact store for the business itself: phase completion is DERIVED
 * from ground truth on every read —
 *   identify ⇔ profile carries a name and a trade/vertical,
 *   learn    ⇔ the core profile questions are answered (onboardingProgress),
 *   connect  ⇔ every presented connection is really connected (live grants /
 *              selections) or explicitly skipped by the owner,
 *   rules    ⇔ every "Set the rules" action has an explicit tier, or the owner
 *              chose the defaults,
 *   handoff  ⇔ the hand-off summary was delivered (handoff_at).
 * Derivation is the resume mechanism: an owner who drops mid-onboarding returns
 * to the first incomplete phase, never to the start. The mayor_onboarding_state
 * row stores only what cannot be derived (skip decisions, the defaults
 * decision, the missing-vertical signal, handoff_at) — never a claim that a
 * connection exists. Status precedence is connected > skipped > pending: a
 * skip never creates a connection, and a real connection is never hidden by
 * an older skip (e.g. the owner skips the Google Business Profile card, then
 * connects Google for their calendar — that same sign-in is the GBP link).
 * Every query is tenant-scoped; owner/manager only.
 */

export const ONBOARDING_PHASES=['identify','learn','connect','rules','handoff'] as const;
export type OnboardingPhase=typeof ONBOARDING_PHASES[number];
export type ConductorPhase=OnboardingPhase|'done';
export const conductorPhaseSchema=z.enum([...ONBOARDING_PHASES,'done']);

export const ONBOARDING_CONNECTION_IDS=['calendar','phone','google_business'] as const;
export type OnboardingConnectionId=typeof ONBOARDING_CONNECTION_IDS[number];
export const onboardingConnectionIdSchema=z.enum(ONBOARDING_CONNECTION_IDS);
export const skipConnectionSchema=z.object({connection:onboardingConnectionIdSchema}).strict();

export type OnboardingConnectionStatus='connected'|'skipped'|'pending';
export interface OnboardingConnection{
 id:OnboardingConnectionId;
 name:string;
 /** One line: what connecting unlocks. Honest — no capability that is not real. */
 unlocks:string;
 status:OnboardingConnectionStatus;
}

/** The Connect catalog. Capped at three by the vision ("never presents more
 * than three connections at once"); ordered per vertical by priority tags. */
const CONNECTION_CATALOG:ReadonlyArray<{id:OnboardingConnectionId;name:string;unlocks:string;tags:readonly string[]}>=[
 {id:'calendar',name:'Your calendar',unlocks:'so I can book without double-booking you',tags:['calendar']},
 {id:'phone',name:'Your business phone',unlocks:'so I can answer when you can’t and text back missed calls',tags:['phone']},
 {id:'google_business',name:'Google Business Profile',unlocks:'link the Google account that manages your listing — reviews and hours reads are not live yet',tags:['reviews','google_business']},
];

/** Order the catalog by a vertical's connector priority (highest value first).
 * A priority entry matches a connection's id or one of its semantic tags;
 * unmatched connections keep catalog order at the end. Stable, max 3. */
export function orderOnboardingConnections(priority:readonly string[]):typeof CONNECTION_CATALOG{
 const rank=(entry:(typeof CONNECTION_CATALOG)[number])=>{
  const tokens=[entry.id,...entry.tags];
  let best=Infinity;
  for(const t of tokens){const i=priority.indexOf(t);if(i!==-1&&i<best)best=i;}
  return best;
 };
 return CONNECTION_CATALOG.map((entry,i)=>({entry,i})).sort((a,b)=>rank(a.entry)-rank(b.entry)||a.i-b.i).map(x=>x.entry);
}

/* ------------------------------ facts ------------------------------ */

export interface ConductorFacts{
 profile:Partial<Profile>;
 /** Actions with an explicitly stored authority tier. */
 explicitRuleActions:readonly AuthorityAction[];
 /** Full tier list (explicit flag per action) for the hand-off summary. */
 tiers:ReadonlyArray<{action:AuthorityAction;tier:AuthorityTier;explicit:boolean}>;
 /** connectionId → truly connected right now, derived from real grants /
  * selections server-side. Never an owner claim, never a stored flag. */
 connected:Partial<Record<OnboardingConnectionId,boolean>>;
 /** P6: GBP reviews/hours reads can actually succeed for this tenant right
  * now (capability enabled AND an authorized grant carries the
  * business.manage scope — see gbp-reviews.ts). Copy about reviews may say
  * "live" ONLY when this is true; otherwise the P4 wording stands. */
 gbpReviewsLive?:boolean;
 skippedConnections:readonly OnboardingConnectionId[];
 rulesDecision:'defaults'|null;
 handoffAt:string|null;
 /** The vertical's connector priority (connections.ts), for card order. */
 priority:readonly string[];
}

export interface ConductorState{
 phase:ConductorPhase;
 complete:boolean;
 phases:Record<OnboardingPhase,{complete:boolean}>;
 connections:OnboardingConnection[];
 /** First connection still awaiting a decision (connect phase prompt). */
 nextConnection:OnboardingConnection|null;
 /** Owner named a trade with no matching vertical mode and no honest mapping —
  * the vision's "flag the missing vertical" signal. Null otherwise. */
 missingVertical:string|null;
 progress:{completed:number;total:number};
}

const nonEmpty=(value:unknown):boolean=>typeof value==='string'&&value.trim().length>0;
const hasItems=(value:unknown):boolean=>Array.isArray(value)&&value.some(v=>typeof v==='string'&&v.trim());

/** Identify is done when we know what the business is called and what it does:
 * a name plus a vertical or a free-text trade. Places confirm sets name +
 * vertical; the chat Q&A sets name + industry. Either path counts. */
export function identifyComplete(profile:Partial<Profile>):boolean{
 return nonEmpty(profile.name)&&(nonEmpty(profile.industry)||nonEmpty(profile.vertical));
}

/** Learn is done when the core place facts are answered — the same bar the
 * honest fit check uses (vertical question set, generic set as fallback). */
export function learnComplete(profile:Partial<Profile>):boolean{
 const vertical=typeof profile.vertical==='string'?profile.vertical:undefined;
 return onboardingProgressForVertical(profile,vertical).basicsComplete||onboardingProgress(profile).basicsComplete;
}

/** The missing-vertical signal: the owner named a trade, no vertical mode was
 * matched, and no adjacent mapping was accepted. Recorded so the definition
 * can be written later; onboarding continues on the general profile. */
export function missingVerticalSignal(profile:Partial<Profile>):string|null{
 if(!nonEmpty(profile.industry))return null;
 if(nonEmpty(profile.verticalMappedFrom))return null;
 if(profile.vertical&&profile.vertical!=='other')return null;
 return (profile.industry as string).trim();
}

/** Pure derivation of the full conductor state from ground-truth facts. */
export function deriveConductorState(facts:ConductorFacts):ConductorState{
 const catalog=orderOnboardingConnections(facts.priority);
 const connections:OnboardingConnection[]=catalog.map(entry=>({
  id:entry.id,name:entry.name,
  unlocks:entry.id==='google_business'&&facts.gbpReviewsLive
   ?'link the Google account that manages your listing — I can read your reviews and hours from it'
   :entry.unlocks,
  status:facts.connected[entry.id]?'connected':facts.skippedConnections.includes(entry.id)?'skipped':'pending',
 }));
 const phases:Record<OnboardingPhase,{complete:boolean}>={
  identify:{complete:identifyComplete(facts.profile)},
  learn:{complete:learnComplete(facts.profile)},
  connect:{complete:connections.every(c=>c.status!=='pending')},
  rules:{complete:facts.rulesDecision==='defaults'||AUTHORITY_QUESTIONS.every(q=>facts.explicitRuleActions.includes(q.action))},
  handoff:{complete:typeof facts.handoffAt==='string'&&facts.handoffAt.length>0},
 };
 const phase:ConductorPhase=ONBOARDING_PHASES.find(p=>!phases[p].complete)??'done';
 return {
  phase,complete:phase==='done',phases,connections,
  nextConnection:connections.find(c=>c.status==='pending')??null,
  missingVertical:missingVerticalSignal(facts.profile),
  progress:{completed:ONBOARDING_PHASES.filter(p=>phases[p].complete).length,total:ONBOARDING_PHASES.length},
 };
}

/* --------------------------- voice/chat copy --------------------------- */

/** The Connect phase prompt for the pending connection, in conversation. */
export function connectPhasePrompt(state:ConductorState):string|null{
 const next=state.nextConnection;
 if(!next)return null;
 return `Let's connect what matters. ${next.name} — ${next.unlocks}. Say "connect" and I will bring up the card here, or say "skip" to move on.`;
}

/** Tight skip parsing for a pending Connect prompt. Returns the connection the
 * owner means ('current' for a bare "skip"), or null — anything less clear
 * falls through to the normal conversation instead of being guessed. */
export function parseSkipConnection(text:string):OnboardingConnectionId|'current'|null{
 const t=text.trim().toLowerCase().replace(/[.!?]+$/,'');
 if(/^(skip|skip it|skip for now|not now|later|no thanks|pass|skip this one)$/.test(t))return 'current';
 const named=/^skip (?:the |my )?(calendar|phone|google(?: business(?: profile)?)?)$/.exec(t);
 if(named)return named[1]==='calendar'?'calendar':named[1]==='phone'?'phone':'google_business';
 return null;
}

/** A clear "connect it" for the pending Connect prompt. */
export function asksToConnectPending(text:string):boolean{
 const t=text.trim().toLowerCase().replace(/[.!?]+$/,'');
 return /^(yes|yeah|ok|okay|sure|connect|connect it|go ahead|let's do it|do it)$/.test(t)||/\bconnect\b/.test(t);
}

/* ----------------------------- hand-off ----------------------------- */

export interface HandoffSummary{
 greeting:string;
 knows:string[];
 connections:Array<{id:OnboardingConnectionId;label:string;note:string}>;
 rules:string[];
 firstWatch:string;
 text:string;
}

const CONNECTION_HANDOFF_NOTES:Record<OnboardingConnectionId,Record<OnboardingConnectionStatus,string>>={
 calendar:{
  connected:'Connected — I check it before booking, so no double-booking.',
  skipped:'Not connected — bookings stay drafts for you until you connect it.',
  pending:'Not connected yet — bookings stay drafts for you until you connect it.',
 },
 phone:{
  connected:'Connected — I can answer it and text back missed calls.',
  skipped:'Not connected — I cannot see or answer your calls until it is.',
  pending:'Not connected yet — I cannot see or answer your calls until it is.',
 },
 google_business:{
  connected:'Google account connected — Business Profile reads (reviews, hours) are not live yet.',
  skipped:'Not connected — fine for now; you can link it anytime.',
  pending:'Not connected yet — fine for now; you can link it anytime.',
 },
};

/** The first proactive thing The Mayor will watch for, from real state only:
 * a gap it honestly cannot cover, or the implemented proactive detectors. */
export function firstWatchLine(state:ConductorState):string{
 const byId=(id:OnboardingConnectionId)=>state.connections.find(c=>c.id===id);
 if(byId('phone')?.status!=='connected')
  return 'First thing I will watch for: anything your phone would have caught. It is not connected yet, so I cannot see missed calls — if that starts to matter, I will flag it here with a one-tap fix instead of pretending otherwise.';
 if(byId('calendar')?.status!=='connected')
  return 'First thing I will watch for: booking requests I cannot place without your calendar. Until it is connected, I will confirm every booking with you rather than guess at your availability.';
 return 'First thing I will watch for: slow days, lapsed regulars, and unanswered leads. I will bring you a draft before anything goes out — nothing is sent without your say-so unless you set that rule yourself.';
}

/** Pure hand-off summary: what The Mayor now knows, what is really connected,
 * the rules in plain language, and the first thing it will watch for. Built
 * only from confirmed facts — absent facts are omitted, never invented. */
export function buildHandoffSummary(facts:ConductorFacts,state:ConductorState):HandoffSummary{
 const profile=facts.profile;
 const name=assistantName(profile);
 const vertical=typeof profile.vertical==='string'&&profile.vertical!=='other'?profile.vertical as Exclude<Vertical,'other'>:null;
 const mode=vertical?MODE_LABELS[vertical]:null;
 const greeting=vertical
  ?`That is the setup done. I am ${name}, your Mayor — an AI assistant, set up in ${mode} mode for your business. I will always tell you what I have done on your behalf.`
  :`That is the setup done. I am ${name}, your Mayor — an AI assistant for your business. I will always tell you what I have done on your behalf.`;
 const knows:string[]=[];
 if(nonEmpty(profile.name)){
  const where=Array.isArray(profile.locations)&&profile.locations.find(v=>v.trim())?` — ${profile.locations.find(v=>v.trim())}`:'';
  const trade=nonEmpty(profile.industry)?profile.industry:vertical?verticalProfile(vertical as Vertical).label:'';
  knows.push(`${profile.name}${trade?` (${trade})`:''}${where}`);
 }
 if(nonEmpty(profile.verticalMappedFrom)&&vertical)
  knows.push(`No dedicated ${profile.verticalMappedFrom} mode exists yet, so I am using ${mode} mode — that gap is noted, not hidden.`);
 if(hasItems(profile.services))knows.push(`Services: ${(profile.services as string[]).filter(s=>s.trim()).slice(0,5).join(', ')}`);
 if(nonEmpty(profile.hours))knows.push(`Hours: ${(profile.hours as string).trim().slice(0,200)}`);
 if(Array.isArray(profile.staff))
  knows.push(profile.staff.some(s=>s.trim())?`Team: ${profile.staff.filter(s=>s.trim()).join(', ')}`:'You work alone — noted.');
 if(hasItems(profile.appointmentTypes))knows.push(`Typical appointment: ${(profile.appointmentTypes as string[]).find(s=>s.trim())}`);
 const connections=state.connections.map(c=>({id:c.id,label:c.name,
  note:c.id==='google_business'&&c.status==='connected'&&facts.gbpReviewsLive
   ?'Google account connected — I can read your Business Profile reviews and hours.'
   :CONNECTION_HANDOFF_NOTES[c.id][c.status]}));
 const tiersByAction=new Map(facts.tiers.map(t=>[t.action,t]));
 const rules=AUTHORITY_QUESTIONS.map(q=>{
  const entry=tiersByAction.get(q.action);
  const tier=entry?.tier??'draft';
  return `${ACTION_LABELS[q.action]}: ${TIER_LABELS[tier]}${entry?.explicit?'':' (default — change it anytime)'}`;
 });
 const firstWatch=firstWatchLine(state);
 const lines=[
  greeting,'',
  'What I know:',...knows.map(k=>`- ${k}`),'',
  'Connections:',...connections.map(c=>`- ${c.label}: ${c.note}`),'',
  'Your rules:',...rules.map(r=>`- ${r}`),'',
  firstWatch,
  'Talk to me like a person at the front desk. To change any of this, just say "change how I am set up".',
 ];
 return {greeting,knows,connections,rules,firstWatch,text:lines.join('\n')};
}

/* --------------------------- persistence --------------------------- */

type Db=Env['AGENT_DB'];

export interface StoredOnboardingDecisions{
 skippedConnections:OnboardingConnectionId[];
 rulesDecision:'defaults'|null;
 handoffAt:string|null;
 missingVertical:string|null;
 phase:ConductorPhase;
}

const EMPTY_DECISIONS:StoredOnboardingDecisions={skippedConnections:[],rulesDecision:null,handoffAt:null,missingVertical:null,phase:'identify'};

/** Tenant-scoped read of the stored decisions row. Corrupt or absent rows
 * degrade to empty decisions — derivation from ground truth still works. */
export async function readOnboardingDecisions(db:Db,tenantId:string):Promise<StoredOnboardingDecisions>{
 const row=await db.prepare('SELECT phase,skipped_connections,rules_decision,missing_vertical,handoff_at FROM mayor_onboarding_state WHERE tenant_id=?')
  .bind(tenantId).first<{phase:string;skipped_connections:string;rules_decision:string|null;missing_vertical:string|null;handoff_at:string|null}>();
 if(!row)return {...EMPTY_DECISIONS};
 let skipped:OnboardingConnectionId[]=[];
 try{
  const parsed=z.array(onboardingConnectionIdSchema).safeParse(JSON.parse(row.skipped_connections));
  if(parsed.success)skipped=[...new Set(parsed.data)];
 }catch{/* stored decisions are owner input; a bad row never breaks onboarding */}
 const phase=conductorPhaseSchema.safeParse(row.phase);
 return {
  skippedConnections:skipped,
  rulesDecision:row.rules_decision==='defaults'?'defaults':null,
  handoffAt:row.handoff_at??null,
  missingVertical:row.missing_vertical??null,
  phase:phase.success?phase.data:'identify',
 };
}

/** Tenant-scoped upsert of the decisions row (read-merge-write; onboarding
 * decisions are low-contention and every field merge is idempotent). */
export async function updateOnboardingDecisions(db:Db,tenantId:string,patch:Partial<StoredOnboardingDecisions>):Promise<StoredOnboardingDecisions>{
 const current=await readOnboardingDecisions(db,tenantId);
 const next:StoredOnboardingDecisions={...current,...patch,skippedConnections:[...new Set(patch.skippedConnections??current.skippedConnections)]};
 await db.prepare(`INSERT INTO mayor_onboarding_state(tenant_id,phase,skipped_connections,rules_decision,missing_vertical,handoff_at,updated_at)
  VALUES(?,?,?,?,?,?,?)
  ON CONFLICT(tenant_id) DO UPDATE SET phase=excluded.phase,skipped_connections=excluded.skipped_connections,
  rules_decision=excluded.rules_decision,missing_vertical=excluded.missing_vertical,handoff_at=excluded.handoff_at,updated_at=excluded.updated_at`)
  .bind(tenantId,next.phase,JSON.stringify(next.skippedConnections),next.rulesDecision,next.missingVertical,next.handoffAt,new Date().toISOString()).run();
 return next;
}

/* --------------------------- server layer --------------------------- */

/** Real connection states, derived from the same sources the connections hub
 * shows: a selected + available calendar, an authorized phone connection with
 * a number chosen, an authorized Google grant. Nothing else counts. */
export async function deriveConnectionFacts(env:Env,actor:Actor):Promise<Partial<Record<OnboardingConnectionId,boolean>>>{
 const [selection,phone,status]=await Promise.all([
  selectedCalendar(env,actor).catch(()=>null),
  phoneConnections(env,actor).catch(()=>null),
  connectionStatus(env,actor).catch(()=>null),
 ]);
 const google=(status as {builtIn?:Array<{provider:string;status:string}>}|null)?.builtIn?.find(p=>p.provider==='google');
 const phoneConnected=Boolean((phone as {connections?:Array<{status?:string;number?:string|null}>}|null)?.connections
  ?.some(c=>c.status==='authorized'&&typeof c.number==='string'&&c.number.length>0));
 return {calendar:selection?.available===true,phone:phoneConnected,google_business:google?.status==='connected'};
}

interface LoadedConductor{facts:ConductorFacts;state:ConductorState;decisions:StoredOnboardingDecisions}

async function loadConductor(env:Env,actor:Actor):Promise<LoadedConductor>{
 await requireMembership(env,actor,OPERATORS);
 const [memory,tiers,decisions,connected,gbpReviewsLive]=await Promise.all([
  readMemory(env,actor),
  listAuthorityTiers(env.AGENT_DB,actor.tenantId),
  readOnboardingDecisions(env.AGENT_DB,actor.tenantId),
  deriveConnectionFacts(env,actor),
  gbpReviewsCanSucceed(env,actor).catch(()=>false),
 ]);
 const factsExtra={gbpReviewsLive};
 const profile=memory.profile as Partial<Profile>;
 const vertical=typeof profile.vertical==='string'?profile.vertical as Vertical:'other';
 const facts:ConductorFacts={
  profile,tiers,connected,...factsExtra,
  explicitRuleActions:tiers.filter(t=>t.explicit).map(t=>t.action),
  skippedConnections:decisions.skippedConnections,
  rulesDecision:decisions.rulesDecision,
  handoffAt:decisions.handoffAt,
  priority:connectorPriorityFor(vertical),
 };
 const state=deriveConductorState(facts);
 // Persist the resume pointer + the missing-vertical signal when they move.
 if(decisions.phase!==state.phase||decisions.missingVertical!==state.missingVertical)
  await updateOnboardingDecisions(env.AGENT_DB,actor.tenantId,{phase:state.phase,missingVertical:state.missingVertical});
 return {facts,state,decisions};
}

/** Current conductor state for this tenant (owner/manager). Resumable: the
 * phase is derived from ground truth, so a returning owner lands exactly
 * where they left off. */
export async function getConductorState(env:Env,actor:Actor):Promise<ConductorState>{
 return (await loadConductor(env,actor)).state;
}

/** Record an owner's Connect-phase skip. Idempotent; a skip is a decision,
 * never a connection — the connection stays 'pending' in the hub until a
 * real grant exists, and shows as 'skipped' only inside onboarding. */
export async function skipOnboardingConnection(env:Env,actor:Actor,connection:OnboardingConnectionId):Promise<ConductorState>{
 await requireMembership(env,actor,OPERATORS);
 onboardingConnectionIdSchema.parse(connection);
 const decisions=await readOnboardingDecisions(env.AGENT_DB,actor.tenantId);
 await updateOnboardingDecisions(env.AGENT_DB,actor.tenantId,{skippedConnections:[...decisions.skippedConnections,connection]});
 return getConductorState(env,actor);
}

/** "Use the defaults" for the rules phase: tiers stay at the 'draft' default
 * (nothing is auto-anything); the decision is recorded so onboarding can move
 * on without pretending the owner answered each question. */
export async function useOnboardingDefaultRules(env:Env,actor:Actor):Promise<ConductorState>{
 await requireMembership(env,actor,OPERATORS);
 await updateOnboardingDecisions(env.AGENT_DB,actor.tenantId,{rulesDecision:'defaults'});
 return getConductorState(env,actor);
}

/** Deliver the hand-off: requires Identify→Rules complete (Connect may be a
 * mix of connected + skipped — both are decisions). Records handoff_at once;
 * repeat calls return the same summary without moving the timestamp. */
export async function completeOnboardingHandoff(env:Env,actor:Actor):Promise<{state:ConductorState;summary:HandoffSummary}>{
 const loaded=await loadConductor(env,actor);
 const {state}=loaded;
 if(state.phase!=='handoff'&&state.phase!=='done')
  throw new HttpError(409,'onboarding_incomplete','Onboarding is not ready for hand-off yet. Finish the earlier phases first.');
 if(!loaded.decisions.handoffAt){
  await updateOnboardingDecisions(env.AGENT_DB,actor.tenantId,{handoffAt:new Date().toISOString(),phase:'done'});
  const fresh=await loadConductor(env,actor);
  return {state:fresh.state,summary:buildHandoffSummary(fresh.facts,fresh.state)};
 }
 return {state,summary:buildHandoffSummary(loaded.facts,state)};
}
