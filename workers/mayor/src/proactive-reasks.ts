import type {Env} from './env';
import {localDayKey,type ProactiveContext} from './proactive-detectors';
import type {SchedulingPolicy} from './scheduling-policy';

/** P7 — proactive day-one gaps: missing-connection re-asks + the hours check.
 *
 * The vision (docs/mayor-vision.md, Chief of Staff step 3): "Skip anything;
 * the agent re-asks later when the missing connection would have helped."
 * A re-ask is an OWNER-facing suggestion delivered through the existing
 * proactive surface (mayor_notifications via notifyOwners) — never a
 * customer-facing send, so authority tiers for customer sends do not apply
 * and nothing here can text or call a customer.
 *
 * Honesty rules, enforced by construction:
 *  - A re-ask fires ONLY when there is real evidence of the gap in the
 *    tenant's own rows (below) AND the connection is really missing per the
 *    same ground truth the onboarding conductor derives from (real grants /
 *    selections — never a stored claim). Copy is phrased from that evidence
 *    ("a missed call was logged here"), never from a capability The Mayor
 *    does not have ("I saw your phone ring" — it cannot, unconnected).
 *  - GBP hours-vs-profile comparison is NOT implemented: no live GBP read
 *    path exists (see onboarding-conductor.ts), so there is nothing honest
 *    to compare against. The hours check below is profile-side only; the
 *    GBP comparison lands when the GBP read path exists.
 *  - No calendar re-ask: in this system bookings (mayor_appointments /
 *    mayor_appointment_jobs) are created through a connected calendar by
 *    construction, so there is no honest scheduler-side evidence of work a
 *    missing calendar blocked. Add a check here when such evidence exists.
 *
 * Gating: every re-ask passes through the SAME surfaceGate as suggestion
 * cards (quiet hours 21:00–08:00 business-local, MAX_NUDGES_PER_DAY cap) and
 * logs a 'suggestion' nudge, so re-asks count against the daily cap.
 * De-nagging: per tenant + kind, at most once per REASK_COOLDOWN_DAYS, and
 * the dedupe key carries a monthly bucket so notifyOwners stays idempotent
 * inside the month even if two cycles race.
 */

export const REASK_COOLDOWN_DAYS=30;
export const REASK_COOLDOWN_MS=REASK_COOLDOWN_DAYS*86400000;
/** Evidence must be recent: a gap from months ago is not a day-one nudge. */
export const REASK_EVIDENCE_WINDOW_DAYS=30;
export const REASK_EVIDENCE_WINDOW_MS=REASK_EVIDENCE_WINDOW_DAYS*86400000;

export type ReaskKind='phone_connect_reask'|'profile_hours_missing';
export interface ReaskCandidate{kind:ReaskKind;dedupeKey:string}

/** Monthly-bucket dedupe key (same pattern as the briefing's day key):
 * notifyOwners inserts at most one row per (tenant, owner, key), so a
 * re-ask can structurally fire at most once per calendar month; the
 * created-at cooldown check below additionally prevents a month-boundary
 * double-fire inside REASK_COOLDOWN_DAYS. */
export function reaskDedupeKey(kind:ReaskKind,nowMs:number,timeZone:string):string{
 return `${kind}:${localDayKey(nowMs,timeZone).slice(0,7)}`;
}

/** True when a re-ask of this kind already fired inside the cooldown. Pure. */
export function withinReaskCooldown(lastFiredIso:string|null,nowMs:number):boolean{
 if(!lastFiredIso)return false;
 const last=Date.parse(lastFiredIso);
 return Number.isFinite(last)&&nowMs-last<REASK_COOLDOWN_MS;
}

/** Hours are "missing" when neither source of truth carries usable hours:
 * no free-text hours on the business profile AND no weekly hours in the
 * scheduling policy. A policy that exists with an EMPTY weeklyHours array
 * counts as missing — booking logic would treat the business as closed
 * every day. Profile text alone counts as present (the owner told us their
 * hours in their own words; free text is never parsed for "consistency",
 * and there is no GBP read to compare against — see header). Pure. */
export function hoursMissing(profileHours:unknown,policy:SchedulingPolicy|null):boolean{
 const textPresent=typeof profileHours==='string'&&profileHours.trim().length>0;
 const policyPresent=!!policy&&policy.weeklyHours.length>0;
 return !textPresent&&!policyPresent;
}

type Db=Env['AGENT_DB'];

/** Phone connection ground truth, tenant-scoped: an authorized phone
 * connection with a number actually selected — the same bar the onboarding
 * conductor's deriveConnectionFacts applies. The scheduler has no actor,
 * so this reads the tenant's rows directly, exactly like telnyxFromNumber. */
export async function tenantPhoneConnected(db:Db,tenantId:string):Promise<boolean>{
 const row=await db.prepare(`SELECT 1 AS ok FROM mayor_phone_connections
  WHERE tenant_id=? AND status='authorized' AND selected_number IS NOT NULL AND selected_number<>'' LIMIT 1`)
  .bind(tenantId).first<{ok:number}>();
 return !!row;
}

/** Real evidence for the phone re-ask: a missed call recorded for this
 * tenant inside the evidence window. Missed-call follow-up cards derive
 * from these same rows, so "a followup card exists / a missed call was
 * handled manually" is this evidence — phrased as a logged call, never as
 * a call The Mayor witnessed on an unconnected phone. */
export async function recentMissedCall(db:Db,tenantId:string,sinceIso:string):Promise<boolean>{
 const row=await db.prepare('SELECT 1 AS ok FROM mayor_missed_calls WHERE tenant_id=? AND occurred_at>=? LIMIT 1')
  .bind(tenantId,sinceIso).first<{ok:number}>();
 return !!row;
}

async function lastReaskAt(db:Db,tenantId:string,kind:ReaskKind):Promise<string|null>{
 const row=await db.prepare('SELECT MAX(created_at) AS last_at FROM mayor_notifications WHERE tenant_id=? AND kind=?')
  .bind(tenantId,kind).first<{last_at:string|null}>();
 return row?.last_at??null;
}

interface ProfileFacts{name:string|null;hours:unknown}
async function readProfileFacts(db:Db,tenantId:string):Promise<ProfileFacts>{
 const row=await db.prepare("SELECT value_json FROM mayor_memory WHERE tenant_id=? AND field='profile'")
  .bind(tenantId).first<{value_json:string}>();
 if(!row)return {name:null,hours:undefined};
 try{
  const profile=JSON.parse(row.value_json) as {name?:unknown;hours?:unknown};
  return {name:typeof profile.name==='string'&&profile.name.trim()?profile.name.trim():null,hours:profile.hours};
 }catch{return {name:null,hours:undefined};}
}

/** Evaluate the day-one re-ask checks for one tenant. Pure evaluation only:
 * no gating, no sending — runDayOneReasks applies the shared gates. A check
 * produces a candidate only when (evidence is real) AND (the connection /
 * fact is really missing) AND (the cooldown has expired). */
export async function evaluateDayOneReasks(env:Env,ctx:ProactiveContext):Promise<ReaskCandidate[]>{
 const db=env.AGENT_DB,since=new Date(ctx.nowMs-REASK_EVIDENCE_WINDOW_MS).toISOString();
 const candidates:ReaskCandidate[]=[];
 // Phone (items 1+2): a missed call was logged/handled while the phone is
 // not connected. When the phone IS connected the missed_call_followup
 // detector owns the path — no re-ask.
 if(!(await tenantPhoneConnected(db,ctx.tenantId))&&await recentMissedCall(db,ctx.tenantId,since))
  candidates.push({kind:'phone_connect_reask',dedupeKey:reaskDedupeKey('phone_connect_reask',ctx.nowMs,ctx.timeZone)});
 // Hours (item 3, profile-side only — no GBP read path exists): the tenant
 // has a named business but no usable hours anywhere. Tenants with no
 // profile yet get the onboarding nudge instead, not this one.
 const profile=await readProfileFacts(db,ctx.tenantId);
 if(profile.name&&hoursMissing(profile.hours,ctx.policy))
  candidates.push({kind:'profile_hours_missing',dedupeKey:reaskDedupeKey('profile_hours_missing',ctx.nowMs,ctx.timeZone)});
 const fresh:ReaskCandidate[]=[];
 for(const c of candidates)
  if(!withinReaskCooldown(await lastReaskAt(db,ctx.tenantId,c.kind),ctx.nowMs))fresh.push(c);
 return fresh;
}

/** The proactive surface, injected from proactive.ts so this module stays
 * free of import cycles: the REAL surfaceGate / notifyOwners / logNudge. */
export interface ReaskSurface{
 gate(env:Env,ctx:ProactiveContext):Promise<{ok:true}|{ok:false;reason:string}>;
 notify(env:Env,tenantId:string,kind:string,dedupeKey:string):Promise<void>;
 log(env:Env,tenantId:string,kind:'suggestion'|'briefing',dayKey:string):Promise<void>;
}

/** Fire the evaluated re-asks through the shared gates. Each candidate
 * re-checks the gate (the cap counts nudges logged moments earlier in the
 * same cycle) and logs a 'suggestion' nudge when it fires, so re-asks
 * count against MAX_NUDGES_PER_DAY exactly like suggestion cards. */
export async function runDayOneReasks(env:Env,ctx:ProactiveContext,surface:ReaskSurface):Promise<{fired:number;kinds:ReaskKind[]}>{
 const kinds:ReaskKind[]=[];
 for(const candidate of await evaluateDayOneReasks(env,ctx)){
  if(!(await surface.gate(env,ctx)).ok)continue;
  await surface.notify(env,ctx.tenantId,candidate.kind,candidate.dedupeKey);
  await surface.log(env,ctx.tenantId,'suggestion',localDayKey(ctx.nowMs,ctx.timeZone));
  kinds.push(candidate.kind);
 }
 return {fired:kinds.length,kinds};
}
