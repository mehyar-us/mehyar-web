/**
 * engine/routes.ts — the engine's HTTP surface (Slice 2). Routes:
 *   POST /engine/turn            an owner turn through the 11-stage loop
 *   GET  /engine/desk            the engine's Desk intents (cards)
 *   POST /engine/scenarios/:id/rule   a probe ruling (button path)
 *   POST /engine/actions/:id/approve|dismiss|edit   card verbs
 *   POST /engine/grants/:id/revoke    the Grant card's revoke
 *   GET  /engine/grants          the Grant Book
 *   GET  /engine/audit           "what did you do" data
 *   POST /engine/belief          a Belief Card row edit (= a correction)
 *   GET  /engine/audience        the audience read (Phase B)
 * Every handler is tenant-bound by the route's actor; the store can
 * only read the actor's tenant. Membership: conversation roles may
 * talk and rule; revoking a rule and editing beliefs are operator
 * acts (owner/manager), the same bar as the calendar selection.
 * The audience route is the one deliberate exception to tenant
 * scoping: its data is the owner's portfolio intel across products
 * (campaign_intel.web_events), not any tenant's rows — so it sits
 * behind OPERATORS like belief, and never enters the Desk flow.
 * R1 fold (2026-10-22, ruled): OPERATORS membership alone no longer
 * admits — the route also requires the platform-operator allowlist
 * (MAYOR_AUDIT_OPERATOR_USER_IDS, the audit surface's pattern,
 * fail-closed when unset), because portfolio intel belongs to the
 * platform operator, not to any tenant's owner/manager.
 */
import {z} from 'zod';
import type {Actor,Env} from '../env';
import {HttpError,json,readJson} from '../http';
import {CHAT_ROLES,OPERATORS,requireMembership} from '../permissions';
import {selectedCalendar} from '../calendars';
import {applyActionVerb,applyScenarioRulingSurface,revokeGrantById,runOwnerTurn,type CalendarProbeResult,type EngineDeps} from './loop';
import {decideProviderFromEnv} from './decide';
import {audienceBaselineSeries,audienceSeries,clampAudienceWeeks} from './audience';
import {audienceStatIntent,buildEngineDeskIntents} from './surface';
import {getEngineState,listActionLog,listGrants} from './store';
import {applyOwnerCorrection} from './memory';
import {DEFAULT_COST_CEILING_MICROCENTS} from './cost';

/** "Connected" is a probe RESULT (§1.6): a selected calendar whose
 * authorization stamp still verifies against the live grant. A flag
 * or a past sign-in is never accepted as connected. */
async function defaultCalendarProbe(env: Env, actor: Actor): Promise<CalendarProbeResult> {
 try {
  const selection = await selectedCalendar(env, actor);
  if (!selection) return { connected: false, detail: 'No calendar has been chosen yet.' };
  if (!selection.available) return { connected: false, detail: `${selection.calendar.name} is selected, but its authorization no longer checks out — it needs a reconnect before I can trust it.` };
  return { connected: true, detail: `${selection.calendar.name} is connected and its authorization checks out.` };
 } catch {
  return { connected: false, detail: 'The calendar read did not come back, so I won\'t claim it is connected.' };
 }
}

export function engineDeps(env: Env): EngineDeps {
 return {
  db: env.AGENT_DB,
  decideProvider: decideProviderFromEnv(env as { ENGINE_DECIDE_URL?: string }),
  calendarProbe: (actor) => defaultCalendarProbe(env, actor),
 };
}

const BASE = /^\/api\/businesses\/([a-f0-9]{32})\/engine\/(.+)$/;

export async function handleEngineRequest(request: Request, env: Env, actor: Actor): Promise<Response | null> {
 const url = new URL(request.url);
 const match = url.pathname.match(BASE);
 if (!match || match[1] !== actor.tenantId) return null;
 const rest = match[2];
 const deps = engineDeps(env);

 if (rest === 'turn' && request.method === 'POST') {
  await requireMembership(env, actor, CHAT_ROLES);
  const input = z.object({ text: z.string().trim().min(1).max(4000), channel: z.enum(['owner_text', 'owner_voice']).optional(), idempotencyKey: z.string().min(1).max(200).optional() }).strict().parse(await readJson(request, 8192));
  return json(await runOwnerTurn(deps, actor, input));
 }

 if (rest === 'desk' && request.method === 'GET') {
  await requireMembership(env, actor, CHAT_ROLES);
  const state = await getEngineState(env.AGENT_DB, actor.tenantId, { costCeilingMicrocents: DEFAULT_COST_CEILING_MICROCENTS });
  const obs = state.onboarding as { currentScenarioId?: string };
  return json({ intents: await buildEngineDeskIntents(env.AGENT_DB, actor.tenantId, obs.currentScenarioId ?? null), mode: state.mode });
 }

 const scenarioRule = rest.match(/^scenarios\/([a-f0-9-]{36})\/rule$/);
 if (scenarioRule && request.method === 'POST') {
  await requireMembership(env, actor, CHAT_ROLES);
  const input = z.object({ allowed: z.boolean() }).strict().parse(await readJson(request, 1024));
  return json(await applyScenarioRulingSurface(deps, actor, scenarioRule[1], input.allowed ? 'allowed' : 'blocked'));
 }

 const actionVerb = rest.match(/^actions\/([a-f0-9-]{36})\/(approve|dismiss|edit)$/);
 if (actionVerb && request.method === 'POST') {
  await requireMembership(env, actor, CHAT_ROLES);
  const input = z.object({ text: z.string().trim().max(2000).optional() }).strict().parse(await readJson(request, 4096).catch(() => ({})));
  return json(await applyActionVerb(deps, actor, actionVerb[1], actionVerb[2] as 'approve' | 'dismiss' | 'edit', input.text));
 }

 const grantRevoke = rest.match(/^grants\/([a-f0-9-]{36})\/revoke$/);
 if (grantRevoke && request.method === 'POST') {
  await requireMembership(env, actor, OPERATORS);
  return json(await revokeGrantById(deps, actor, grantRevoke[1]));
 }

 if (rest === 'grants' && request.method === 'GET') {
  await requireMembership(env, actor, CHAT_ROLES);
  return json({ grants: await listGrants(env.AGENT_DB, actor.tenantId) });
 }

 if (rest === 'audit' && request.method === 'GET') {
  await requireMembership(env, actor, CHAT_ROLES);
  const person = url.searchParams.get('person') ?? undefined;
  return json({ rows: await listActionLog(env.AGENT_DB, actor.tenantId, { person, limit: 50 }) });
 }

 if (rest === 'audience' && request.method === 'GET') {
  await requireMembership(env, actor, OPERATORS);
  if (!(env.MAYOR_AUDIT_OPERATOR_USER_IDS ?? '').split(',').map(value => value.trim()).includes(actor.userId)) throw new HttpError(403, 'audience_operator_required', 'Your account does not manage audience reporting.');
  if (!env.AUDIENCE_DB) throw new HttpError(503, 'audience_unavailable', 'The audience store is not connected in this build.');
  const product = url.searchParams.get('product') ?? '*';
  const type = url.searchParams.get('type') ?? '*';
  const weeks = clampAudienceWeeks(url.searchParams.get('weeks'));
  const series = await audienceSeries(env.AUDIENCE_DB, { product, type, weeks });
  const body: Record<string, unknown> = { ...series, intents: [audienceStatIntent(series)] };
  if (url.searchParams.get('baseline') === '1') body.baseline = await audienceBaselineSeries(env.AUDIENCE_DB, { weeks });
  return json(body);
 }

 if (rest === 'belief' && request.method === 'POST') {
  await requireMembership(env, actor, OPERATORS);
  const input = z.object({ key: z.string().trim().min(1).max(120), value: z.string().trim().min(1).max(500) }).strict().parse(await readJson(request, 2048));
  const fact = await applyOwnerCorrection(env.AGENT_DB, { tenantId: actor.tenantId, key: input.key, value: input.value, quote: `Belief Card edit: ${input.key}` });
  return json({ fact: { key: input.key, value: input.value, version: fact.version } });
 }

 /* The BASE pattern matched this worker's /engine namespace, so an
  * unmatched subroute is a 404 here — never a fall-through into
  * another handler family. */
 throw new HttpError(404, 'engine_route_not_found', 'That engine route does not exist.');
}
